//! y-websocket collaboration server: rooms of yrs docs over WebSockets.

mod config;
mod room;
mod socket;
mod store;

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Result;
use axum::extract::ws::rejection::WebSocketUpgradeRejection;
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use tokio::net::TcpListener;
use tokio::sync::watch;

pub use config::Config;
pub use room::{MSG_RELAY, RoomKind};

use room::Room;
use store::Store;

pub struct AppState {
    config: Config,
    store: Store,
    rooms: Mutex<HashMap<String, Arc<Room>>>,
    sockets: AtomicUsize,
    next_conn: AtomicU64,
    shutdown: watch::Sender<bool>,
}

/// Holds one socket slot in a room. Dropping it frees the slot.
pub struct JoinGuard {
    app: Arc<AppState>,
    room: Arc<Room>,
}

impl Drop for JoinGuard {
    fn drop(&mut self) {
        let mut inner = self.room.inner.lock().unwrap();
        inner.sockets -= 1;
        if inner.sockets == 0 {
            inner.empty_since = Some(Instant::now());
        }
        self.app.sockets.fetch_sub(1, Ordering::Relaxed);
    }
}

/// Failed saves in a row before the server drops a room's unsaved edits so the room can close.
const MAX_SAVE_FAILURES: u32 = 5;

impl AppState {
    /// Takes a socket slot in a room, opening the room first when needed.
    ///
    /// SQLite reads run on the blocking pool with no lock held, so a slow disk never stalls
    /// other joins or `/healthz`.
    async fn join(self: &Arc<Self>, name: &str, kind: RoomKind) -> Result<JoinGuard, StatusCode> {
        let open = self.rooms.lock().unwrap().contains_key(name);
        // Ghosts never stores state, so it never needs the database.
        let state = if open || !kind.persistent() {
            None
        } else {
            let app = self.clone();
            let room = name.to_string();
            let loaded = tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
                Ok(match app.store.load(&room)? {
                    Some(state) => Some(state),
                    None if app.store.count()? >= app.config.max_stored_rooms => {
                        anyhow::bail!("stored room limit reached")
                    }
                    None => None,
                })
            })
            .await;
            match loaded {
                Ok(Ok(state)) => state,
                Ok(Err(e)) => {
                    tracing::warn!(room = name, error = %e, "room load refused");
                    return Err(StatusCode::SERVICE_UNAVAILABLE);
                }
                Err(e) => {
                    tracing::error!(room = name, error = %e, "room load panicked");
                    return Err(StatusCode::INTERNAL_SERVER_ERROR);
                }
            }
        };

        let mut rooms = self.rooms.lock().unwrap();
        if self.sockets.load(Ordering::Relaxed) >= self.config.max_sockets {
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
        let room = match rooms.get(name) {
            // Another join may have opened the room while this one loaded. Its copy wins.
            Some(room) => room.clone(),
            None => {
                // Ghosts keeps a slot past the cap, so the homepage works when other rooms fill it.
                if kind != RoomKind::Ghosts && rooms.len() >= self.config.max_rooms {
                    return Err(StatusCode::SERVICE_UNAVAILABLE);
                }
                let room = Room::new(name, kind, state.as_deref(), self.config.max_doc_bytes).map_err(|e| {
                    tracing::error!(room = name, error = %e, "room open failed");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
                tracing::info!(room = name, "room opened");
                let room = Arc::new(room);
                rooms.insert(name.to_string(), room.clone());
                room
            }
        };
        let mut inner = room.inner.lock().unwrap();
        if inner.sockets >= self.config.max_sockets_per_room {
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
        inner.sockets += 1;
        inner.empty_since = None;
        drop(inner);
        drop(rooms);
        self.sockets.fetch_add(1, Ordering::Relaxed);
        Ok(JoinGuard {
            app: self.clone(),
            room,
        })
    }

    /// Saves dirty persistent rooms that are due, and closes rooms empty past the grace period.
    /// A room is due once edits pause for `persist_debounce`, or once it has been dirty for
    /// `persist_max_wait`. `force` saves every dirty room now.
    ///
    /// The rooms lock covers only the encode. SQLite writes run after it drops. A dirty room
    /// stays open until a later sweep finds it saved, so a room never reopens from stale state.
    fn sweep(&self, force: bool) {
        let now = Instant::now();
        let mut pending = Vec::new();
        {
            let mut rooms = self.rooms.lock().unwrap();
            rooms.retain(|name, room| {
                let mut inner = room.inner.lock().unwrap();
                let idle = inner.sockets == 0 && inner.empty_since.is_some_and(|t| now - t >= self.config.room_grace);
                let due = force
                    || idle
                    || now - inner.last_change >= self.config.persist_debounce
                    || inner
                        .dirty_since
                        .is_some_and(|t| now - t >= self.config.persist_max_wait);
                if inner.dirty && due {
                    inner.dirty = false;
                    inner.dirty_since = None;
                    let state = inner.encode_state();
                    inner.doc_bytes = state.len();
                    pending.push((name.clone(), room.clone(), state));
                    return true;
                }
                let close = idle && !inner.dirty;
                if close {
                    tracing::info!(room = %name, "room closed");
                }
                !close
            });
        }
        for (name, room, state) in pending {
            let result = self.store.save(&name, &state);
            let mut inner = room.inner.lock().unwrap();
            match result {
                Ok(()) => {
                    inner.save_failures = 0;
                    tracing::debug!(room = %name, bytes = state.len(), "room saved");
                }
                Err(e) => {
                    inner.save_failures += 1;
                    if inner.save_failures >= MAX_SAVE_FAILURES {
                        // Give up, so a full disk cannot pin rooms open and fill max_rooms.
                        tracing::error!(room = %name, error = %e, "room save failed; dropping unsaved edits");
                        inner.save_failures = 0;
                    } else {
                        tracing::error!(room = %name, error = %e, "room save failed");
                        inner.dirty = true;
                        inner.dirty_since.get_or_insert(now);
                    }
                }
            }
        }
    }

    /// Deletes stored `game-<id>` rooms past their TTL.
    fn prune(&self) {
        match self.store.prune(self.config.stored_room_ttl) {
            Ok(0) => {}
            Ok(n) => tracing::info!(rows = n, "pruned old game rooms"),
            Err(e) => tracing::error!(error = %e, "prune failed"),
        }
    }
}

pub fn router(app: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/ws/{room}", get(ws_handler))
        .with_state(app)
}

async fn healthz(State(app): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let rooms = app.rooms.lock().unwrap().len();
    Json(serde_json::json!({
        "ok": true,
        "disabled": app.config.disabled,
        "rooms": rooms,
        "sockets": app.sockets.load(Ordering::Relaxed),
    }))
}

async fn ws_handler(
    State(app): State<Arc<AppState>>,
    Path(name): Path<String>,
    headers: HeaderMap,
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Response {
    let Some(kind) = RoomKind::parse(&name) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if app.config.disabled {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()).unwrap_or("");
    if !app.config.origin_allowed(origin) {
        tracing::info!(room = %name, origin, "origin refused");
        return StatusCode::FORBIDDEN.into_response();
    }
    let ws = match ws {
        Ok(ws) => ws,
        Err(rejection) => return rejection.into_response(),
    };
    let guard = match app.join(&name, kind).await {
        Ok(guard) => guard,
        Err(status) => {
            tracing::warn!(room = %name, %status, "join refused");
            return status.into_response();
        }
    };
    let max = app.config.max_message_bytes;
    ws.max_message_size(max)
        .max_frame_size(max)
        .on_upgrade(move |socket| socket::run(socket, guard))
}

/// How often the janitor deletes expired game rooms.
const PRUNE_EVERY: Duration = Duration::from_secs(60 * 60);

/// Serves until `shutdown` resolves, then closes sockets and saves every dirty room.
pub async fn serve(
    config: Config,
    listener: TcpListener,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<()> {
    let store = Store::open(&config.db_path)?;
    let tick = (config.persist_debounce / 4).clamp(Duration::from_millis(50), Duration::from_secs(1));
    let app = Arc::new(AppState {
        config,
        store,
        rooms: Mutex::default(),
        sockets: AtomicUsize::new(0),
        next_conn: AtomicU64::new(1),
        shutdown: watch::channel(false).0,
    });

    // The janitor stops on the shutdown signal, between sweeps. serve() awaits it below, so a
    // janitor sweep never runs alongside the final one.
    let janitor = {
        let app = app.clone();
        let mut stop = app.shutdown.subscribe();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tick);
            let mut last_prune: Option<Instant> = None;
            loop {
                tokio::select! {
                    _ = interval.tick() => {}
                    _ = stop.wait_for(|stop| *stop) => break,
                }
                let prune = last_prune.is_none_or(|t| t.elapsed() >= PRUNE_EVERY);
                if prune {
                    last_prune = Some(Instant::now());
                }
                let app = app.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if prune {
                        app.prune();
                    }
                    app.sweep(false);
                })
                .await;
            }
        })
    };

    let stop = {
        let app = app.clone();
        async move {
            shutdown.await;
            tracing::info!("shutting down");
            app.shutdown.send_replace(true);
        }
    };
    axum::serve(listener, router(app.clone()))
        .with_graceful_shutdown(stop)
        .await?;
    let _ = janitor.await;

    // Sockets close on the shutdown signal. Give them a moment to finish their last frames.
    let deadline = Instant::now() + Duration::from_secs(5);
    while app.sockets.load(Ordering::Relaxed) > 0 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let final_app = app.clone();
    tokio::task::spawn_blocking(move || final_app.sweep(true)).await?;
    tracing::info!("all rooms saved");
    Ok(())
}
