-- Collab server storage. The server runs this file on every start, so each
-- statement must be safe to repeat.
--
-- One row per saved room (playground, game, game-<id>). The ghosts room is
-- presence only and is never stored.

PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS rooms (
    -- Room name from the URL, such as `playground` or `game-42`.
    name TEXT PRIMARY KEY,
    -- The whole Yjs doc, encoded as one v1 update.
    state BLOB NOT NULL,
    -- Last save, in Unix seconds.
    updated_at INTEGER NOT NULL
);
