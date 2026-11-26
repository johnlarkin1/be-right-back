"""Proving the built database is actually consumable by this repo.

A synthetic corpus that *looks* like ``chat.db`` but trips one of the app's CTEs
is worse than no corpus -- it fails at ingest time, far from the cause. So rather
than reimplement the queries here (where they would drift), we extract them from
``crates/messages-db/src/db/query_strs.rs`` and run the real thing.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

#: Relative to the repo root.
QUERY_STRS_PATH = Path("crates/messages-db/src/db/query_strs.rs")

#: ``pub const NAME: &str = r#"..."#;``
_CONST_RE = re.compile(
    r'pub const (?P<name>[A-Z0-9_]+):\s*&str\s*=\s*r#"(?P<sql>.*?)"#;',
    re.DOTALL,
)

#: Columns this repo's queries reference. Missing any of them means the schema
#: flavour is wrong, and the failure would otherwise surface as an opaque
#: "no such column" during ingestion.
REQUIRED_MESSAGE_COLUMNS = frozenset(
    {
        "ROWID",
        "guid",
        "text",
        "attributedBody",
        "handle_id",
        "service",
        "date",
        "is_from_me",
        "item_type",
        "is_system_message",
        "associated_message_guid",
        "associated_message_type",
        "cache_roomnames",
    }
)
REQUIRED_CHAT_COLUMNS = frozenset({"ROWID", "guid", "chat_identifier", "room_name", "display_name"})
REQUIRED_HANDLE_COLUMNS = frozenset({"ROWID", "id", "service", "person_centric_id"})


class VerificationError(RuntimeError):
    """The built database would not work with the app."""


@dataclass
class ContactRow:
    identifier: str
    message_count: int
    earliest: int
    latest: int


@dataclass
class VerifyReport:
    contacts: list[ContactRow]
    total_p2p_messages: int
    group_only_messages: int
    sampled_contact: str
    sampled_message_count: int
    rowid_order_is_chronological: bool
    resolvable_display_names: int

    @property
    def ok(self) -> bool:
        return (
            bool(self.contacts)
            and self.rowid_order_is_chronological
            and self.resolvable_display_names == len(self.contacts)
        )


def load_queries(repo_root: Path) -> dict[str, str]:
    """Extract the SQL constants from the Rust source."""
    path = repo_root / QUERY_STRS_PATH
    if not path.exists():
        raise VerificationError(
            f"cannot find {path}. Pass --repo-root pointing at the brb checkout so "
            "verification can use the app's real SQL instead of a copy."
        )
    queries = {
        match.group("name"): match.group("sql")
        for match in _CONST_RE.finditer(path.read_text(encoding="utf-8"))
    }
    if "LIST_ALL_CONTACTS_WITH_MIN_MESSAGES" not in queries:
        raise VerificationError(
            f"{path} parsed but did not yield the expected constants; the file format changed"
        )
    return queries


def verify(chat_db: Path, repo_root: Path, addressbook_db: Path | None = None) -> VerifyReport:
    """Run the app's queries against ``chat_db`` and report what they return."""
    if not chat_db.exists():
        raise VerificationError(f"no database at {chat_db}")

    queries = load_queries(repo_root)
    connection = sqlite3.connect(f"file:{chat_db}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        _check_columns(connection)
        contacts = _run_contacts_query(connection, queries)
        sampled, sampled_count = _run_messages_query(connection, queries, contacts)
        return VerifyReport(
            contacts=contacts,
            total_p2p_messages=sum(row.message_count for row in contacts),
            group_only_messages=_count_group_messages(connection),
            sampled_contact=sampled,
            sampled_message_count=sampled_count,
            rowid_order_is_chronological=_check_rowid_ordering(connection),
            resolvable_display_names=_count_display_names(addressbook_db, queries, contacts),
        )
    finally:
        connection.close()


def _count_display_names(
    addressbook_db: Path | None,
    queries: dict[str, str],
    contacts: list[ContactRow],
) -> int:
    """How many contacts the AddressBook can put a name to.

    Without this the demo shows raw phone numbers everywhere, which is the most
    visible possible way for a synthetic corpus to look wrong.
    """
    if addressbook_db is None or not addressbook_db.exists():
        return 0

    connection = sqlite3.connect(f"file:{addressbook_db}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        known: set[str] = set()
        for query_name, column in (
            ("BUILD_PHONE_LOOKUP", "ZFULLNUMBER"),
            ("BUILD_EMAIL_LOOKUP", "ZADDRESS"),
        ):
            for row in connection.execute(queries[query_name]).fetchall():
                if row["ZFIRSTNAME"] and row[column]:
                    known.add(row[column])
    finally:
        connection.close()

    return sum(1 for contact in contacts if contact.identifier in known)


def _check_columns(connection: sqlite3.Connection) -> None:
    expectations = {
        "message": REQUIRED_MESSAGE_COLUMNS,
        "chat": REQUIRED_CHAT_COLUMNS,
        "handle": REQUIRED_HANDLE_COLUMNS,
    }
    for table, required in expectations.items():
        rows = connection.execute(f"PRAGMA table_info({table})").fetchall()
        if not rows:
            raise VerificationError(f"table '{table}' is missing entirely")
        present = {row["name"] for row in rows}
        missing = sorted(required - present)
        if missing:
            raise VerificationError(f"table '{table}' is missing columns: {missing}")

    for table in ("chat_message_join", "chat_handle_join"):
        if not connection.execute(f"PRAGMA table_info({table})").fetchall():
            raise VerificationError(f"join table '{table}' is missing entirely")


def _run_contacts_query(
    connection: sqlite3.Connection, queries: dict[str, str]
) -> list[ContactRow]:
    sql = queries["LIST_ALL_CONTACTS_WITH_MIN_MESSAGES"]
    rows = connection.execute(sql, (1,)).fetchall()
    if not rows:
        raise VerificationError(
            "the app's contact query returned zero rows. The most likely cause is a chat "
            "GUID that trips the p2p filter (room_name IS NULL AND guid NOT LIKE '%;chat%')."
        )
    return [
        ContactRow(
            identifier=row["id"],
            message_count=row["message_count"],
            earliest=row["earliest_message"],
            latest=row["latest_message"],
        )
        for row in rows
    ]


def _run_messages_query(
    connection: sqlite3.Connection,
    queries: dict[str, str],
    contacts: list[ContactRow],
) -> tuple[str, int]:
    target = contacts[0].identifier
    rows = connection.execute(queries["GET_MESSAGES_FOR_CONTACT"], (target,)).fetchall()
    if not rows:
        raise VerificationError(f"the app's message query returned nothing for {target}")
    if any(row["text"] is None for row in rows):
        raise VerificationError(
            f"{target} has messages with NULL text; the app would need attributedBody decoding"
        )
    return target, len(rows)


def _count_group_messages(connection: sqlite3.Connection) -> int:
    """Messages that live only in group chats, which 1:1 queries must exclude."""
    row = connection.execute(
        """
        SELECT COUNT(DISTINCT cmj.message_id) AS n
        FROM chat_message_join cmj
        JOIN chat ch ON ch.ROWID = cmj.chat_id
        WHERE ch.guid LIKE '%;chat%' OR ch.room_name IS NOT NULL
        """
    ).fetchone()
    return int(row["n"])


def _check_rowid_ordering(connection: sqlite3.Connection) -> bool:
    """Confirm ROWID order matches date order, as in a real chat.db.

    The chunker sorts by ``date ASC, ROWID ASC`` and the eval plan treats ROWIDs
    as stable gold keys, so a corpus where the two disagree would behave subtly
    differently from a real one.
    """
    row = connection.execute(
        """
        SELECT COUNT(*) AS inversions
        FROM (
          SELECT date, LAG(date) OVER (ORDER BY ROWID) AS previous_date
          FROM message
        )
        WHERE previous_date IS NOT NULL AND date < previous_date
        """
    ).fetchone()
    return int(row["inversions"]) == 0
