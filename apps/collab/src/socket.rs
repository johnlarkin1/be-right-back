//! The per-socket loop: inbound frames, room broadcasts, keepalive, shutdown.

use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use axum::extract::ws::{CloseFrame, Message, WebSocket, close_code};
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast::error::RecvError;
use tracing::Instrument;
use yrs::ClientID;

use crate::JoinGuard;

/// Longest one send may take. A peer that stops reading would otherwise stall this
/// socket's loop, so it would never see its idle timeout, lag, or shutdown.
const SEND_TIMEOUT: Duration = Duration::from_secs(10);

type Sink = SplitSink<WebSocket, Message>;

/// Sends one frame. Returns false when the send fails or takes longer than `SEND_TIMEOUT`.
async fn send(sink: &mut Sink, msg: Message) -> bool {
    matches!(tokio::time::timeout(SEND_TIMEOUT, sink.send(msg)).await, Ok(Ok(())))
}

/// Token bucket: `rate` tokens per second, up to `burst`.
struct TokenBucket {
    tokens: f64,
    rate: f64,
    burst: f64,
    last: Instant,
}

impl TokenBucket {
    fn new(rate: f64, burst: f64) -> Self {
        Self {
            tokens: burst,
            rate,
            burst,
            last: Instant::now(),
        }
    }

    fn take(&mut self) -> bool {
        let now = Instant::now();
        let refill = (now - self.last).as_secs_f64() * self.rate;
        self.tokens = (self.tokens + refill).min(self.burst);
        self.last = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

pub async fn run(socket: WebSocket, guard: JoinGuard) {
    let conn = guard.app.next_conn.fetch_add(1, Ordering::Relaxed);
    let span = tracing::info_span!("socket", room = %guard.room.name, conn);
    let room = guard.room.clone();
    let owned = serve(socket, &guard, conn).instrument(span).await;
    room.leave(owned);
    drop(guard);
}

/// Runs the socket until it closes. Returns the awareness client ids it owned.
async fn serve(socket: WebSocket, guard: &JoinGuard, conn: u64) -> HashSet<ClientID> {
    let (app, room) = (&guard.app, &guard.room);
    tracing::info!("socket opened");

    // Subscribe before the hello so no update slips between the two.
    let mut rx = room.subscribe();
    let mut shutdown = app.shutdown.subscribe();
    let (mut sink, mut stream) = socket.split();
    let mut owned = HashSet::new();
    let mut bucket = TokenBucket::new(app.config.rate_per_sec, app.config.rate_burst);
    let mut ping = tokio::time::interval(app.config.ping_interval);
    ping.tick().await;
    let mut last_seen = Instant::now();

    let close = |code, reason: &'static str| {
        Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        }))
    };

    let frames = match room.hello() {
        Ok(frames) => frames,
        Err(e) => {
            tracing::error!(error = %e, "hello failed");
            return owned;
        }
    };
    for f in frames {
        if !send(&mut sink, Message::Binary(f)).await {
            return owned;
        }
    }

    let reason = loop {
        tokio::select! {
            msg = stream.next() => {
                last_seen = Instant::now();
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        if !bucket.take() {
                            send(&mut sink, close(close_code::POLICY, "rate limit")).await;
                            break "rate limit";
                        }
                        match room.handle(conn, &data, &mut owned) {
                            Ok(Some(reply)) => {
                                if !send(&mut sink, Message::Binary(reply)).await {
                                    break "send failed";
                                }
                            }
                            Ok(None) => {}
                            Err(e) => {
                                tracing::warn!(error = %e, "bad message");
                                send(&mut sink, close(close_code::INVALID, "bad message")).await;
                                break "bad message";
                            }
                        }
                    }
                    Some(Ok(Message::Text(_))) => {
                        send(&mut sink, close(close_code::UNSUPPORTED, "binary only")).await;
                        break "text frame";
                    }
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                    Some(Ok(Message::Close(_))) | None => break "client closed",
                    Some(Err(e)) => {
                        tracing::debug!(error = %e, "socket error");
                        break "socket error";
                    }
                }
            }
            out = rx.recv() => match out {
                Ok(out) if out.from == conn => {}
                Ok(out) => {
                    if !send(&mut sink, Message::Binary(out.data)).await {
                        break "send failed";
                    }
                }
                // A lagging socket missed updates. Closing makes the client reconnect and resync.
                Err(RecvError::Lagged(n)) => {
                    tracing::warn!(missed = n, "socket lagged");
                    send(&mut sink, close(close_code::AGAIN, "lagged")).await;
                    break "lagged";
                }
                Err(RecvError::Closed) => break "room closed",
            },
            _ = ping.tick() => {
                if last_seen.elapsed() >= app.config.idle_timeout {
                    send(&mut sink, close(close_code::AWAY, "idle")).await;
                    break "idle";
                }
                if !send(&mut sink, Message::Ping(Default::default())).await {
                    break "send failed";
                }
            }
            _ = async { shutdown.wait_for(|stop| *stop).await.is_ok() } => {
                send(&mut sink, close(close_code::RESTART, "server restart")).await;
                break "shutdown";
            }
        }
    };

    tracing::info!(reason, "socket closed");
    owned
}
