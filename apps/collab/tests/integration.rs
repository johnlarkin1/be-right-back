use std::net::SocketAddr;
use std::path::Path;
use std::time::Duration;

use collab::{Config, MSG_RELAY};
use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};
use yrs::sync::{Awareness, Message, SyncMessage};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Doc, GetString, ReadTxn, StateVector, Text, Transact, Update};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

const ORIGIN: &str = "http://localhost:3000";

struct Server {
    addr: SocketAddr,
    stop: oneshot::Sender<()>,
    task: JoinHandle<anyhow::Result<()>>,
}

impl Server {
    async fn start(db: &Path) -> Self {
        Self::start_with(Config {
            db_path: db.to_path_buf(),
            ..Config::default()
        })
        .await
    }

    async fn start_with(config: Config) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (stop, rx) = oneshot::channel();
        let task = tokio::spawn(collab::serve(config, listener, async {
            let _ = rx.await;
        }));
        Self { addr, stop, task }
    }

    async fn stop(self) {
        self.stop.send(()).unwrap();
        self.task.await.unwrap().unwrap();
    }

    async fn connect(&self, room: &str) -> Ws {
        let (ws, _) = connect_async(self.request(room, Some(ORIGIN))).await.expect("connect");
        ws
    }

    /// Returns the HTTP status of a refused upgrade.
    async fn refused(&self, room: &str, origin: Option<&str>) -> u16 {
        match connect_async(self.request(room, origin)).await {
            Err(tokio_tungstenite::tungstenite::Error::Http(resp)) => resp.status().as_u16(),
            other => panic!("expected refusal, got {:?}", other.map(|_| ())),
        }
    }

    fn request(&self, room: &str, origin: Option<&str>) -> tokio_tungstenite::tungstenite::handshake::client::Request {
        let mut req = format!("ws://{}/ws/{room}", self.addr).into_client_request().unwrap();
        if let Some(origin) = origin {
            req.headers_mut().insert("origin", origin.parse().unwrap());
        }
        req
    }
}

async fn send(ws: &mut Ws, msg: Message) {
    ws.send(WsMessage::Binary(msg.encode_v1().into())).await.unwrap();
}

/// Reads y-protocol messages until `pick` returns Some, or fails after 3 s.
async fn recv_until<T>(ws: &mut Ws, mut pick: impl FnMut(Message) -> Option<T>) -> T {
    let fut = async {
        while let Some(frame) = ws.next().await {
            if let WsMessage::Binary(data) = frame.unwrap() {
                let msg = Message::decode_v1(&data).unwrap();
                if let Some(v) = pick(msg) {
                    return v;
                }
            }
        }
        panic!("socket closed");
    };
    tokio::time::timeout(Duration::from_secs(3), fut)
        .await
        .expect("timed out")
}

/// Collects every y-protocol message that arrives within `window`.
async fn drain(ws: &mut Ws, window: Duration) -> Vec<Message> {
    let mut out = Vec::new();
    while let Ok(Some(Ok(frame))) = tokio::time::timeout(window, ws.next()).await {
        if let WsMessage::Binary(data) = frame {
            out.push(Message::decode_v1(&data).unwrap());
        }
    }
    out
}

fn text_update(s: &str) -> Vec<u8> {
    let doc = Doc::new();
    let text = doc.get_or_insert_text("t");
    text.push(&mut doc.transact_mut(), s);
    doc.transact().encode_state_as_update_v1(&StateVector::default())
}

fn text_of(update: &[u8]) -> String {
    let doc = Doc::new();
    let text = doc.get_or_insert_text("t");
    doc.transact_mut()
        .apply_update(Update::decode_v1(update).unwrap())
        .unwrap();
    text.get_string(&doc.transact())
}

/// Asks the server for its full doc state and returns the text.
async fn fetch_text(ws: &mut Ws) -> String {
    send(ws, Message::Sync(SyncMessage::SyncStep1(StateVector::default()))).await;
    let update = recv_until(ws, |m| match m {
        Message::Sync(SyncMessage::SyncStep2(u)) => Some(u),
        _ => None,
    })
    .await;
    text_of(&update)
}

#[tokio::test]
async fn doc_update_reaches_other_client() {
    let dir = tempfile::tempdir().unwrap();
    let server = Server::start(&dir.path().join("c.db")).await;
    let mut a = server.connect("game-sync").await;
    let mut b = server.connect("game-sync").await;
    drain(&mut b, Duration::from_millis(100)).await;

    send(&mut a, Message::Sync(SyncMessage::Update(text_update("hello")))).await;
    let update = recv_until(&mut b, |m| match m {
        Message::Sync(SyncMessage::Update(u)) => Some(u),
        _ => None,
    })
    .await;
    assert_eq!(text_of(&update), "hello");
    server.stop().await;
}

#[tokio::test]
async fn awareness_reaches_other_client() {
    let dir = tempfile::tempdir().unwrap();
    let server = Server::start(&dir.path().join("c.db")).await;
    let mut a = server.connect("ghosts").await;
    let mut b = server.connect("ghosts").await;

    let mut local = Awareness::new(Doc::new());
    local.set_local_state_raw(r#"{"cursor":[1,2]}"#);
    let id = local.client_id();
    send(&mut a, Message::Awareness(local.update().unwrap())).await;

    let json = recv_until(&mut b, |m| match m {
        Message::Awareness(u) => u.clients.get(&id).map(|e| e.json.to_string()),
        _ => None,
    })
    .await;
    assert_eq!(json, r#"{"cursor":[1,2]}"#);

    // When A leaves, B learns that A's state is gone.
    // B may see A's state twice (in its hello and in the broadcast), so wait for the removal.
    a.close(None).await.unwrap();
    recv_until(&mut b, |m| match m {
        Message::Awareness(u) => u.clients.get(&id).is_some_and(|e| &*e.json == "null").then_some(()),
        _ => None,
    })
    .await;
    server.stop().await;
}

#[tokio::test]
async fn relay_reaches_others_but_not_sender() {
    let dir = tempfile::tempdir().unwrap();
    let server = Server::start(&dir.path().join("c.db")).await;
    let mut a = server.connect("game").await;
    let mut b = server.connect("game").await;
    drain(&mut a, Duration::from_millis(100)).await;

    send(&mut a, Message::Custom(MSG_RELAY, b"jump".to_vec())).await;
    let payload = recv_until(&mut b, |m| match m {
        Message::Custom(MSG_RELAY, p) => Some(p),
        _ => None,
    })
    .await;
    assert_eq!(payload, b"jump");

    let echoed = drain(&mut a, Duration::from_millis(300)).await;
    assert!(
        !echoed.iter().any(|m| matches!(m, Message::Custom(MSG_RELAY, _))),
        "sender got its own relay"
    );
    // The relay never touches the doc.
    assert_eq!(fetch_text(&mut b).await, "");
    server.stop().await;
}

#[tokio::test]
async fn bad_room_and_origin_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let server = Server::start(&dir.path().join("c.db")).await;
    assert_eq!(server.refused("lobby", Some(ORIGIN)).await, 404);
    assert_eq!(server.refused("game-UPPER", Some(ORIGIN)).await, 404);
    assert_eq!(server.refused("playground", Some("https://evil.example")).await, 403);
    assert_eq!(
        server
            .refused("playground", Some("https://be-right-back-x.evil.example"))
            .await,
        403
    );
    assert_eq!(server.refused("playground", None).await, 403);
    server.stop().await;
}

#[tokio::test]
async fn playground_persists_across_restart_and_ghosts_do_not() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("c.db");

    let server = Server::start(&db).await;
    let mut a = server.connect("playground").await;
    let mut g = server.connect("ghosts").await;
    send(&mut a, Message::Sync(SyncMessage::Update(text_update("kept")))).await;
    send(&mut g, Message::Sync(SyncMessage::Update(text_update("gone")))).await;
    // A round trip proves the server applied the update before shutdown.
    assert_eq!(fetch_text(&mut a).await, "kept");
    assert_eq!(fetch_text(&mut g).await, "gone");
    server.stop().await;

    let server = Server::start(&db).await;
    let mut b = server.connect("playground").await;
    assert_eq!(fetch_text(&mut b).await, "kept");
    let mut g = server.connect("ghosts").await;
    assert_eq!(fetch_text(&mut g).await, "");
    server.stop().await;
}

#[tokio::test]
async fn healthz_reports_counts() {
    let dir = tempfile::tempdir().unwrap();
    let server = Server::start(&dir.path().join("c.db")).await;
    let _a = server.connect("playground").await;

    let mut stream = TcpStream::connect(server.addr).await.unwrap();
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut body = String::new();
    stream.read_to_string(&mut body).await.unwrap();
    assert!(body.starts_with("HTTP/1.1 200"), "{body}");
    assert!(body.contains(r#""rooms":1"#), "{body}");
    assert!(body.contains(r#""sockets":1"#), "{body}");
    server.stop().await;
}

/// Waits for the server's close frame and returns its code.
async fn close_code(ws: &mut Ws) -> u16 {
    let fut = async {
        while let Some(frame) = ws.next().await {
            if let Ok(WsMessage::Close(Some(close))) = frame {
                return u16::from(close.code);
            }
        }
        panic!("socket ended with no close frame");
    };
    tokio::time::timeout(Duration::from_secs(3), fut)
        .await
        .expect("timed out")
}

#[tokio::test]
async fn frame_with_two_messages_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let server = Server::start(&dir.path().join("c.db")).await;
    let mut a = server.connect("ghosts").await;
    // Two relay messages packed in one frame would slip past the per-frame rate limit.
    let mut packed = Message::Custom(MSG_RELAY, vec![1]).encode_v1();
    packed.extend(Message::Custom(MSG_RELAY, vec![2]).encode_v1());
    a.send(WsMessage::Binary(packed.into())).await.unwrap();
    assert_eq!(close_code(&mut a).await, 1007);
    server.stop().await;
}

#[tokio::test]
async fn edit_past_doc_limit_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let server = Server::start_with(Config {
        db_path: dir.path().join("c.db"),
        max_doc_bytes: 200,
        ..Config::default()
    })
    .await;
    let mut a = server.connect("playground").await;
    send(
        &mut a,
        Message::Sync(SyncMessage::Update(text_update(&"x".repeat(500)))),
    )
    .await;
    assert_eq!(close_code(&mut a).await, 1007);
    let mut b = server.connect("playground").await;
    assert_eq!(fetch_text(&mut b).await, "");
    server.stop().await;
}

#[tokio::test]
async fn new_saved_rooms_stop_at_the_stored_limit() {
    let dir = tempfile::tempdir().unwrap();
    let config = Config {
        db_path: dir.path().join("c.db"),
        max_stored_rooms: 1,
        ..Config::default()
    };
    let server = Server::start_with(config.clone()).await;
    let mut a = server.connect("playground").await;
    send(&mut a, Message::Sync(SyncMessage::Update(text_update("kept")))).await;
    assert_eq!(fetch_text(&mut a).await, "kept");
    server.stop().await;

    let server = Server::start_with(config).await;
    assert_eq!(server.refused("game-new", Some(ORIGIN)).await, 503);
    // Stored rooms still open, and ghosts never touches the store.
    let mut b = server.connect("playground").await;
    assert_eq!(fetch_text(&mut b).await, "kept");
    let _g = server.connect("ghosts").await;
    server.stop().await;
}
