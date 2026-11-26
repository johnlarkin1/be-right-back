//! One room: a yrs Doc plus Awareness, and a broadcast channel to its sockets.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Instant;

use anyhow::{Result, bail};
use axum::body::Bytes;
use tokio::sync::broadcast;
use yrs::sync::{Awareness, Error, Message, MessageReader, SyncMessage};
use yrs::updates::decoder::{Decode, DecoderV1};
use yrs::updates::encoder::Encode;
use yrs::{ClientID, Doc, ReadTxn, StateVector, Transact, Update};

/// Message tag for ephemeral relay (game inputs, pings between players).
///
/// Frame layout: `[100][varUint length][payload]`. The server forwards the frame
/// to every other socket in the room. It never touches the doc.
pub const MSG_RELAY: u8 = 100;

/// Sender id for broadcasts that go to every socket, the sender included.
pub const EVERYONE: u64 = 0;

/// Room kinds, decided by the room name. The kind sets the persistence policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoomKind {
    Ghosts,
    Playground,
    Game,
}

impl RoomKind {
    /// Accepts `ghosts`, `playground`, `game`, and `game-<id>` with id in `[a-z0-9-]{1,32}`.
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "ghosts" => Some(Self::Ghosts),
            "playground" => Some(Self::Playground),
            "game" => Some(Self::Game),
            _ => {
                let id = name.strip_prefix("game-")?;
                let valid = (1..=32).contains(&id.len())
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
                valid.then_some(Self::Game)
            }
        }
    }

    /// Ghosts is presence only, so its doc is not stored.
    pub fn persistent(self) -> bool {
        self != Self::Ghosts
    }
}

#[derive(Clone)]
pub struct Outbound {
    pub from: u64,
    pub data: Bytes,
}

pub struct Room {
    pub name: String,
    pub kind: RoomKind,
    max_doc_bytes: usize,
    pub inner: Mutex<RoomInner>,
    tx: broadcast::Sender<Outbound>,
}

pub struct RoomInner {
    awareness: Awareness,
    pub sockets: usize,
    /// True when the doc changed since the last save. Stays false for ephemeral rooms.
    pub dirty: bool,
    pub last_change: Instant,
    /// When the room became dirty. Caps how long edits can keep postponing a save.
    pub dirty_since: Option<Instant>,
    pub empty_since: Option<Instant>,
    /// Doc size estimate: the last saved size plus every update applied since.
    pub doc_bytes: usize,
    /// Saves that failed in a row.
    pub save_failures: u32,
}

impl RoomInner {
    pub fn encode_state(&self) -> Vec<u8> {
        self.awareness
            .doc()
            .transact()
            .encode_state_as_update_v1(&StateVector::default())
    }
}

impl Room {
    /// Creates the room from its stored state, if it has one.
    pub fn new(name: &str, kind: RoomKind, state: Option<&[u8]>, max_doc_bytes: usize) -> Result<Self> {
        let doc = Doc::new();
        let doc_bytes = state.map_or(0, <[u8]>::len);
        if let Some(state) = state {
            doc.transact_mut().apply_update(Update::decode_v1(state)?)?;
            tracing::info!(room = name, bytes = doc_bytes, "room state loaded");
        }
        let (tx, _) = broadcast::channel(256);
        Ok(Self {
            name: name.to_string(),
            kind,
            max_doc_bytes,
            inner: Mutex::new(RoomInner {
                awareness: Awareness::new(doc),
                sockets: 0,
                dirty: false,
                last_change: Instant::now(),
                dirty_since: None,
                empty_since: Some(Instant::now()),
                doc_bytes,
                save_failures: 0,
            }),
            tx,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Outbound> {
        self.tx.subscribe()
    }

    /// The frames a new socket gets first: sync step 1, then awareness if anyone is present.
    /// y-websocket clients read one message per frame, so each message is its own frame.
    pub fn hello(&self) -> Result<Vec<Bytes>, Error> {
        let inner = self.inner.lock().unwrap();
        let sv = inner.awareness.doc().transact().state_vector();
        let mut frames = vec![frame(Message::Sync(SyncMessage::SyncStep1(sv)))];
        let update = inner.awareness.update()?;
        if !update.clients.is_empty() {
            frames.push(frame(Message::Awareness(update)));
        }
        Ok(frames)
    }

    /// Handles one inbound frame and returns the reply for the sender, if any.
    /// `owned` collects the awareness client ids this socket announced.
    ///
    /// A frame must hold exactly one message, as y-websocket clients send them. The rate
    /// limit counts frames, so a frame packed with messages would bypass it.
    pub fn handle(&self, conn: u64, data: &[u8], owned: &mut HashSet<ClientID>) -> Result<Option<Bytes>> {
        let mut decoder = DecoderV1::from(data);
        let mut reader = MessageReader::new(&mut decoder);
        let Some(msg) = reader.next() else {
            bail!("empty frame");
        };
        let msg = msg?;
        if reader.next().is_some() {
            bail!("more than one message in a frame");
        }
        let mut inner = self.inner.lock().unwrap();
        let mut reply = None;
        match msg {
            Message::Sync(SyncMessage::SyncStep1(sv)) => {
                let diff = inner.awareness.doc().transact().encode_state_as_update_v1(&sv);
                reply = Some(frame(Message::Sync(SyncMessage::SyncStep2(diff))));
            }
            Message::Sync(SyncMessage::SyncStep2(update) | SyncMessage::Update(update)) => {
                if self.kind.persistent() && inner.doc_bytes + update.len() > self.max_doc_bytes {
                    bail!("doc would pass {} bytes", self.max_doc_bytes);
                }
                let decoded = Update::decode_v1(&update)?;
                inner.awareness.doc().transact_mut().apply_update(decoded)?;
                if self.kind.persistent() {
                    let now = Instant::now();
                    inner.doc_bytes += update.len();
                    inner.dirty = true;
                    inner.last_change = now;
                    inner.dirty_since.get_or_insert(now);
                }
                self.send(conn, Message::Sync(SyncMessage::Update(update)));
            }
            Message::Awareness(update) => {
                for (id, entry) in &update.clients {
                    if &*entry.json == "null" {
                        owned.remove(id);
                    } else {
                        owned.insert(*id);
                    }
                }
                inner.awareness.apply_update(update.clone())?;
                // Echo to the sender too, like y-websocket. Clients use it as a liveness signal.
                self.send(EVERYONE, Message::Awareness(update));
            }
            Message::AwarenessQuery => {
                let update = inner.awareness.update()?;
                reply = Some(frame(Message::Awareness(update)));
            }
            Message::Auth(_) => {}
            Message::Custom(MSG_RELAY, payload) => {
                self.send(conn, Message::Custom(MSG_RELAY, payload));
            }
            Message::Custom(tag, _) => return Err(Error::Unsupported(tag).into()),
        }
        Ok(reply)
    }

    /// Clears the awareness states a closing socket owned and tells the others.
    pub fn leave(&self, owned: HashSet<ClientID>) {
        if owned.is_empty() {
            return;
        }
        let mut inner = self.inner.lock().unwrap();
        for id in &owned {
            inner.awareness.remove_state(*id);
        }
        match inner.awareness.update_with_clients(owned) {
            Ok(update) => self.send(EVERYONE, Message::Awareness(update)),
            Err(e) => tracing::warn!(room = %self.name, error = %e, "awareness cleanup failed"),
        }
    }

    fn send(&self, from: u64, msg: Message) {
        // An error only means no socket is listening.
        let _ = self.tx.send(Outbound { from, data: frame(msg) });
    }
}

fn frame(msg: Message) -> Bytes {
    Bytes::from(msg.encode_v1())
}

#[cfg(test)]
mod tests {
    use super::RoomKind;

    #[test]
    fn room_names() {
        assert_eq!(RoomKind::parse("ghosts"), Some(RoomKind::Ghosts));
        assert_eq!(RoomKind::parse("playground"), Some(RoomKind::Playground));
        assert_eq!(RoomKind::parse("game"), Some(RoomKind::Game));
        assert_eq!(RoomKind::parse("game-abc-12"), Some(RoomKind::Game));
        assert_eq!(RoomKind::parse("game-"), None);
        assert_eq!(RoomKind::parse("game-ABC"), None);
        assert_eq!(RoomKind::parse(&format!("game-{}", "a".repeat(33))), None);
        assert_eq!(RoomKind::parse("lobby"), None);
    }
}
