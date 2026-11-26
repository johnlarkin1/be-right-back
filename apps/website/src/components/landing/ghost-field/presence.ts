/**
 * Shared cursors: joins the collab server's `ghosts` room and trades pointers
 * with everyone else on the homepage.
 *
 * Pointers travel as Yjs awareness, the protocol's presence channel. No doc
 * content is written. Positions are fractions of the hero (0..1), so visitors
 * with different screen sizes line up. The server (apps/collab) relays
 * awareness to the whole room and clears a visitor's state when they leave.
 */

/** Pointer as it travels: fractions of the hero, plus button state. */
interface WirePointer {
  x: number;
  y: number;
  a: boolean;
  s: boolean;
}

export interface Peer {
  id: number;
  x: number;
  y: number;
  attracting: boolean;
  spawning: boolean;
}

export interface Presence {
  /** Shares this visitor's pointer, in hero fractions. `null` hides it. */
  publish(pointer: { x: number; y: number; attracting: boolean; spawning: boolean } | null): void;
  /** Everyone else with a visible pointer, in hero fractions. */
  peers(): Peer[];
  /** Visitors in the room, this one included. 0 while not connected. */
  count(): number;
  leave(): void;
}

/** Most pointer updates per second this visitor sends. */
const SEND_HZ = 15;

/** The collab server's base URL, such as `wss://brb-collab.fly.dev`. Unset turns sharing off. */
export const COLLAB_URL = process.env.NEXT_PUBLIC_COLLAB_URL ?? "";

export async function joinGhostRoom(baseUrl: string): Promise<Presence> {
  // Loaded only when sharing is on, so single-player visitors never download Yjs.
  const [{ Doc }, { WebsocketProvider }] = await Promise.all([import("yjs"), import("y-websocket")]);
  const doc = new Doc();
  // The server serves rooms at /ws/<room>. disableBc keeps tabs from syncing over BroadcastChannel.
  const provider = new WebsocketProvider(`${baseUrl.replace(/\/$/, "")}/ws`, "ghosts", doc, {
    disableBc: true,
  });
  const awareness = provider.awareness;

  let pending: WirePointer | null = null;
  let lastSent: WirePointer | null = null;
  let dirty = false;
  const flush = () => {
    if (!dirty) return;
    dirty = false;
    lastSent = pending;
    awareness.setLocalStateField("p", pending);
  };
  const timer = window.setInterval(flush, 1000 / SEND_HZ);

  return {
    publish(pointer) {
      const next: WirePointer | null = pointer && {
        x: Math.round(pointer.x * 1000) / 1000,
        y: Math.round(pointer.y * 1000) / 1000,
        a: pointer.attracting,
        s: pointer.spawning,
      };
      const same =
        next === lastSent ||
        (next !== null &&
          lastSent !== null &&
          next.x === lastSent.x &&
          next.y === lastSent.y &&
          next.a === lastSent.a &&
          next.s === lastSent.s);
      pending = next;
      dirty = !same;
      // Button changes go out at once, so a click never waits for the next tick.
      if (dirty && (next?.a !== lastSent?.a || next?.s !== lastSent?.s)) flush();
    },
    peers() {
      const out: Peer[] = [];
      awareness.getStates().forEach((state, id) => {
        if (id === awareness.clientID) return;
        const p = (state as { p?: WirePointer | null }).p;
        // Peer state is untrusted. JSON can carry 1e400, which parses to Infinity.
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
        out.push({ id, x: clamp01(p.x), y: clamp01(p.y), attracting: p.a === true, spawning: p.s === true });
      });
      return out;
    },
    count() {
      return provider.wsconnected ? awareness.getStates().size : 0;
    },
    leave() {
      window.clearInterval(timer);
      awareness.setLocalState(null);
      provider.destroy();
      doc.destroy();
    },
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
