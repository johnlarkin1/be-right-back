# collab

A WebSocket server for shared state on the marketing site. It speaks the y-websocket protocol. Browser clients use `y-websocket` and `y-protocols/awareness` unchanged.

Each room holds one in-memory yrs doc and one awareness instance. The server opens a room on the first connection. It closes the room when the last socket leaves and a grace period passes.

## Run locally

```bash
cd apps/collab
cargo run
```

The server listens on `0.0.0.0:8787`. To check it, run `curl localhost:8787/healthz`.

To run the tests and linters:

```bash
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

This crate has its own Cargo workspace. The root workspace excludes it because the root crates need macOS.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `COLLAB_ADDR` | `0.0.0.0:8787` | Listen address. |
| `COLLAB_DB_PATH` | `./collab.db` | SQLite file for room state. The tables are in `schema.sql`. |
| `COLLAB_ALLOWED_ORIGINS` | see below | Comma-separated `Origin` allow list. |
| `COLLAB_DISABLED` | unset | `1` refuses new sockets with 503. |
| `COLLAB_MAX_MESSAGE_BYTES` | `65536` | Largest frame and message. |
| `COLLAB_RATE_PER_SEC` | `30` | Token refill rate per socket. |
| `COLLAB_RATE_BURST` | `60` | Token bucket size per socket. |
| `COLLAB_MAX_SOCKETS_PER_ROOM` | `100` | Sockets per room. |
| `COLLAB_MAX_SOCKETS` | `1000` | Sockets on the server. |
| `COLLAB_MAX_ROOMS` | `200` | Open rooms on the server. |
| `COLLAB_PING_SECS` | `20` | Ping interval. |
| `COLLAB_IDLE_SECS` | `60` | The server closes a socket after this long with no frames. |
| `COLLAB_PERSIST_DEBOUNCE_MS` | `2000` | Save delay after the last doc change. |
| `COLLAB_PERSIST_MAX_WAIT_SECS` | `10` | Longest a changed room waits for a save while edits keep coming. |
| `COLLAB_ROOM_GRACE_SECS` | `30` | Time an empty room stays open. |
| `COLLAB_MAX_DOC_BYTES` | `1048576` | Largest doc a saved room may hold. An edit past it closes the socket with 1007. |
| `COLLAB_MAX_STORED_ROOMS` | `500` | Most rooms in SQLite. Past it, a new saved room gets 503. |
| `COLLAB_STORED_ROOM_TTL_DAYS` | `30` | The server deletes `game-<id>` rooms not saved for this long. |
| `RUST_LOG` | `collab=info` | Log filter. |

The default origins are `https://berightback.xyz`, `https://www.berightback.xyz`, `http://localhost:3000`, and `https://be-right-back-*-johnlarkin1s-projects.vercel.app` (Vercel previews). The team suffix matters: anyone can name a Vercel project `be-right-back-<x>`. A pattern can hold one `*`. The `*` matches `[a-z0-9-]+`, so it cannot cross a dot. `*` alone allows any origin. The server refuses a request with no `Origin` header. Edit the Vercel pattern if the project or team name changes.

The server refuses a socket with 404 for an unknown room and with 403 for a bad origin. It sends 503 when a limit is hit or when `COLLAB_DISABLED=1`. A socket that goes over its rate limit gets close code 1008. A frame must hold one message, as y-websocket sends them; a frame with more gets 1007. A send that stalls for 10 s closes the socket.

## Protocol

Connect to `/ws/<room>`. Valid rooms:

| Room | Stored |
| --- | --- |
| `ghosts` | No. Presence only. |
| `playground` | Yes. |
| `game`, `game-<id>` (`id` is `[a-z0-9-]{1,32}`) | Yes. |

A stored room saves its doc as one v1 update. The save runs 2 s after the last change, when the room closes, and on SIGTERM.

Message tags:

| Tag | Meaning |
| --- | --- |
| `0` | Sync (step 1, step 2, update). |
| `1` | Awareness. The server echoes it to every socket, the sender included. |
| `2` | Auth. The server ignores it. |
| `3` | Awareness query. |
| `100` | Relay. The server forwards it to every other socket in the room. It never touches the doc. |

A relay frame is `[100][varUint length][payload]`. Use it for ephemeral data such as game inputs. The server closes a socket that sends any other unknown tag.

Browser client:

```js
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const doc = new Y.Doc();
// The provider appends the room name to the URL.
const provider = new WebsocketProvider('ws://localhost:8787/ws', 'playground', doc);
provider.awareness.setLocalStateField('cursor', { x: 10, y: 20 });

// Relay: send ephemeral bytes to the other sockets.
const MSG_RELAY = 100;
provider.messageHandlers[MSG_RELAY] = (_encoder, decoder) => {
  const payload = decoding.readVarUint8Array(decoder);
  console.log('relay', payload);
};
function relay(payload) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_RELAY);
  encoding.writeVarUint8Array(encoder, payload);
  provider.ws?.send(encoding.toUint8Array(encoder));
}
```

The relay handler returns no reply, so the provider sends nothing back.

## Deploy to Fly.io

The app runs on one `shared-cpu-1x` machine with 256 MB and a 1 GB volume at `/data`. It costs about $2-3 a month. Fly builds the image on its own builders, so nothing compiles on your laptop.

### First deploy

You need a Fly account with a card on file, and Homebrew. From `apps/collab`, run:

```bash
./scripts/deploy-fly.sh
```

The script does five things. Each step skips what already exists, so you can run it again.

1. Installs `flyctl` with Homebrew if it is missing.
2. Runs `fly auth login` if you are not logged in. This opens a browser, where you can sign up.
3. Creates the app `brb-collab` in your personal org.
4. Creates the `collab_data` volume in `iad`.
5. Runs `fly deploy --remote-only --ha=false`, then checks `/healthz`.

App names are global on Fly. If `brb-collab` is taken, run `FLY_APP=<other-name> ./scripts/deploy-fly.sh` and use that name in the URL below.

Keep one machine. Rooms live in that machine's memory, so a second machine would split visitors into two rooms. That is why the script passes `--ha=false`.

### Connect the website

In Vercel, open the project, then Settings > Environment Variables. Add `NEXT_PUBLIC_COLLAB_URL` with the value `wss://brb-collab.fly.dev` for Production and Preview. Then redeploy: Next.js reads `NEXT_PUBLIC_` values at build time.

To check it, open the site in two browsers. Each should show "2 people here", and each pointer should push the other browser's ghosts.

### Later deploys

To ship a change to the server, run `fly deploy --remote-only` from `apps/collab`. To read logs, run `fly logs`. To check the room and socket counts, open `https://brb-collab.fly.dev/healthz`.

To turn off new connections, run `fly secrets set COLLAB_DISABLED=1`. Fly restarts the machine with the new value. Existing rooms save on SIGTERM.
