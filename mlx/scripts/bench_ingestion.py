#!/usr/bin/env python3
"""Ingestion micro-benchmarks. Run on an Apple Silicon Mac with the app closed.

Each section times one ingestion step on real data, then times a faster variant
of the same step. Nothing writes to your real databases: write tests go to an
empty temp DuckDB file, and the FTS test copies only chunk_id and formatted_text.

Usage (from the repo root):

    ~/.be-right-back/mlx-venv/bin/python mlx/scripts/bench_ingestion.py \
        --snapshot-db ~/.be-right-back/data/raw/<latest>/chat_snapshot.db

Sections: read, decode, stats_sql, chunk, embed, write, daily, fts. Pick some with
--only read,decode. The JSON summary goes to --out (default: stdout only).
"""

from __future__ import annotations

import argparse
import gc
import itertools
import json
import os
import random
import re
import shutil
import sqlite3
import statistics
import sys
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

_SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(_SRC))

from config.embedding import EmbeddingConfig  # noqa: E402
from data.loaders import (  # noqa: E402
    get_contact_ids_and_counts,
    group_by_contact,
    read_messages_for_contacts,
)
from data.storage import _aggregate_daily_messages  # noqa: E402

try:  # main before the Arrow write change
    from data.storage import write_chunks_bulk_parquet as write_chunks  # noqa: E402
except ImportError:
    from data.storage import write_chunks_bulk as write_chunks  # noqa: E402
from pipelines.embedding import create_chunks  # noqa: E402
from queries import sqlite as sqlite_queries  # noqa: E402
from utils import attributed_body as ab  # noqa: E402

RESULTS: dict[str, Any] = {}
_scratch_ids = itertools.count()


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def timed(fn: Callable[[], Any]) -> tuple[float, Any]:
    start = time.perf_counter()
    out = fn()
    return time.perf_counter() - start, out


# --------------------------------------------------------------------------
# Section: read
# --------------------------------------------------------------------------


def bench_read(snapshot_db: Path, max_contacts: int) -> list[dict]:
    """Time the batched SQLite read, with and without attributedBody decoding."""
    t_discover, contacts = timed(lambda: get_contact_ids_and_counts(snapshot_db))
    ids = [cid for cid, _ in contacts][:max_contacts]

    # Same batch boundaries as the pipeline: 10 for the top 50, then 50.
    batches: list[list[str]] = []
    pos = 0
    while pos < len(ids):
        size = 10 if pos < 50 else 50
        batches.append(ids[pos : pos + size])
        pos += size

    # Raw read: rows only, no decode. Shows SQL cost per batch.
    def raw_read() -> int:
        conn = sqlite3.connect(str(snapshot_db))
        rows = 0
        for batch in batches:
            q = sqlite_queries.build_messages_for_contacts_query(len(batch))
            for _ in conn.execute(q, batch):
                rows += 1
        conn.close()
        return rows

    t_raw, raw_rows = timed(raw_read)

    # Full read: what the pipeline does (decode + clean).
    messages: list[dict] = []

    def full_read() -> None:
        for batch in batches:
            messages.extend(read_messages_for_contacts(snapshot_db, batch))

    t_full, _ = timed(full_read)

    # One query for every contact. Shows the cost of re-running the CTE per batch.
    def single_query() -> int:
        conn = sqlite3.connect(str(snapshot_db))
        q = sqlite_queries.build_messages_for_contacts_query(len(ids))
        n = sum(1 for _ in conn.execute(q, ids))
        conn.close()
        return n

    t_single, _ = timed(single_query)

    RESULTS["read"] = {
        "contacts": len(ids),
        "batches": len(batches),
        "rows": raw_rows,
        "messages_kept": len(messages),
        "discover_s": round(t_discover, 2),
        "sql_only_batched_s": round(t_raw, 2),
        "sql_only_single_query_s": round(t_single, 2),
        "read_plus_decode_s": round(t_full, 2),
        "decode_share": round(1 - t_raw / t_full, 3) if t_full else None,
    }
    log(f"[read] {RESULTS['read']}")
    return messages


# --------------------------------------------------------------------------
# Section: decode
# --------------------------------------------------------------------------


def fast_typedstream_text(blob: bytes) -> str | None:
    """Pull the NSString payload out of a 'streamtyped' attributedBody blob.

    The archive stores the plain text right after the NSString class marker:
    b"NSString" + 5 bytes of class info + a length prefix + UTF-8 bytes.
    A length byte of 0x81 means a 2-byte little-endian length follows; 0x82
    means a 4-byte length follows.
    """
    i = blob.find(b"NSString")
    if i < 0:
        return None
    p = i + 8 + 5
    if p >= len(blob):
        return None
    tag = blob[p]
    if tag == 0x81:
        n = int.from_bytes(blob[p + 1 : p + 3], "little")
        p += 3
    elif tag == 0x82:
        n = int.from_bytes(blob[p + 1 : p + 5], "little")
        p += 5
    else:
        n = tag
        p += 1
    raw = blob[p : p + n]
    if len(raw) != n:
        return None
    return raw.decode("utf-8", "replace")


def _is_streamtyped(blob: bytes) -> bool:
    """NSArchiver blobs start with b"\\x04\\x0bstreamtyped", so the tag sits at offset 2."""
    return blob[2:13] == b"streamtyped"


def decode_foundation(blob: bytes) -> str | None:
    """The Foundation-only decoder main ships: secure keyed, legacy keyed, then NSUnarchiver."""
    text = (
        ab._try_keyed_unarchiver_secure(blob)
        or ab._try_keyed_unarchiver_legacy(blob)
        or ab._try_nsunarchiver(blob)
        or ""
    )
    return ab._append_blob_urls(text, blob) or None


def decode_dispatch(blob: bytes) -> str | None:
    """Foundation only, but pick the unarchiver from the magic bytes."""
    if _is_streamtyped(blob):
        text = ab._try_nsunarchiver(blob) or ""
    else:
        text = ab._try_keyed_unarchiver_secure(blob) or ab._try_keyed_unarchiver_legacy(blob) or ""
    return ab._append_blob_urls(text, blob) or None


# Use the production byte parser when this checkout has it.
_parse = getattr(ab, "extract_streamtyped_text", None) or fast_typedstream_text


def decode_fast(blob: bytes) -> str | None:
    """Byte parser for streamtyped, Foundation for everything else."""
    if _is_streamtyped(blob):
        text = _parse(blob)
        if not text:
            text = ab._try_nsunarchiver(blob) or ""
        return ab._append_blob_urls(text, blob) or None
    return decode_foundation(blob)


def bench_decode(snapshot_db: Path, sample: int) -> None:
    conn = sqlite3.connect(str(snapshot_db))
    total, text_null = conn.execute(
        "SELECT COUNT(*), SUM(CASE WHEN (text IS NULL OR text = '') "
        "AND attributedBody IS NOT NULL THEN 1 ELSE 0 END) FROM message"
    ).fetchone()
    blobs = [
        bytes(r[0])
        for r in conn.execute(
            "SELECT attributedBody FROM message WHERE attributedBody IS NOT NULL "
            "AND (text IS NULL OR text = '') ORDER BY random() LIMIT ?",
            (sample,),
        )
    ]
    conn.close()
    if not blobs:
        RESULTS["decode"] = {"skipped": "no attributedBody-only rows"}
        return

    formats = {"streamtyped": 0, "bplist": 0, "other": 0}
    for b in blobs:
        if _is_streamtyped(b):
            formats["streamtyped"] += 1
        elif b[:8] == b"bplist00":
            formats["bplist"] += 1
        else:
            formats["other"] += 1

    t_cur, cur = timed(lambda: [decode_foundation(b) for b in blobs])
    t_dis, dis = timed(lambda: [decode_dispatch(b) for b in blobs])
    t_fast, fast = timed(lambda: [decode_fast(b) for b in blobs])

    def agree(a: list, b: list) -> float:
        same = sum(1 for x, y in zip(a, b) if (x or "").strip() == (y or "").strip())
        return round(same / len(a), 4)

    mismatches = [
        {"current": (c or "")[:80], "fast": (f or "")[:80]}
        for c, f in zip(cur, fast)
        if (c or "").strip() != (f or "").strip()
    ][:5]

    n = len(blobs)
    RESULTS["decode"] = {
        "messages_total": total,
        "attributed_body_only": text_null,
        "sample": n,
        "formats": formats,
        "byte_parser_hits": sum(1 for b in blobs if _is_streamtyped(b) and _parse(b)),
        "current_us_per_blob": round(t_cur / n * 1e6, 1),
        "dispatch_us_per_blob": round(t_dis / n * 1e6, 1),
        "fast_us_per_blob": round(t_fast / n * 1e6, 1),
        "dispatch_agreement": agree(cur, dis),
        "fast_agreement": agree(cur, fast),
        "fast_mismatch_examples": mismatches,
        "projected_current_s_all_rows": round(t_cur / n * (text_null or 0), 1),
        "projected_fast_s_all_rows": round(t_fast / n * (text_null or 0), 1),
    }
    log(f"[decode] {json.dumps(RESULTS['decode'], ensure_ascii=False)}")


# --------------------------------------------------------------------------
# Section: stats_sql
# --------------------------------------------------------------------------

_QUERY_STRS = _SRC.parent.parent / "crates" / "messages-db" / "src" / "db" / "query_strs.rs"


def _rust_query(name: str) -> str:
    """Read a SQL constant straight from query_strs.rs, so the timing uses the real query."""
    m = re.search(rf'pub const {name}: &str = r#"(.*?)"#;', _QUERY_STRS.read_text(), re.S)
    if not m:
        raise SystemExit(f"{name} not found in {_QUERY_STRS}")
    return m.group(1)


def bench_stats_sql(snapshot_db: Path, sample: int) -> None:
    """Time the per-contact query the Rust stats loop runs once per contact.

    Rows are fetched but not decoded, so this isolates SQL cost. The total is
    projected to every contact, as the stats loop visits all of them.
    """
    query = _rust_query("GET_MESSAGES_FOR_CONTACT")
    conn = sqlite3.connect(f"file:{snapshot_db}?mode=ro", uri=True)
    contacts = [
        r[0] for r in conn.execute(_rust_query("LIST_ALL_CONTACTS_WITH_MIN_MESSAGES"), (1,))
    ]
    plan = [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + query, (contacts[0],))]

    rng = random.Random(0)
    picked = rng.sample(contacts, min(sample, len(contacts)))
    per_contact = []
    rows = 0
    for cid in picked:
        t, n = timed(lambda cid=cid: sum(1 for _ in conn.execute(query, (cid,))))
        per_contact.append(t)
        rows += n
    conn.close()

    total = sum(per_contact)
    RESULTS["stats_sql"] = {
        "contacts_total": len(contacts),
        "contacts_timed": len(picked),
        "rows": rows,
        "seconds_timed": round(total, 2),
        "median_ms_per_contact": round(sorted(per_contact)[len(per_contact) // 2] * 1000, 1),
        "max_ms_per_contact": round(max(per_contact) * 1000, 1),
        "projected_s_all_contacts": round(total / len(picked) * len(contacts), 1),
        "query_plan": plan,
    }
    log(f"[stats_sql] {json.dumps(RESULTS['stats_sql'])}")


# --------------------------------------------------------------------------
# Section: chunk
# --------------------------------------------------------------------------


def bench_chunk(messages: list[dict], cfg: EmbeddingConfig) -> list[dict]:
    groups = group_by_contact(messages)

    def run() -> list[dict]:
        out: list[dict] = []
        for cid, msgs in groups.items():
            out.extend(
                create_chunks(
                    msgs,
                    cfg.chunk_window_size,
                    cfg.chunk_stride,
                    cfg.min_chunk_chars,
                    contact_name=cid,
                )
            )
        return out

    t, chunks = timed(run)
    RESULTS["chunk"] = {"messages": len(messages), "chunks": len(chunks), "seconds": round(t, 2)}
    log(f"[chunk] {RESULTS['chunk']}")
    return chunks


# --------------------------------------------------------------------------
# Section: embed
# --------------------------------------------------------------------------


def bench_embed(
    chunks: list[dict],
    cfg: EmbeddingConfig,
    n: int,
    batch_sizes: list[int],
    variants: list[str],
    repeats: int,
):
    import mlx.core as mx
    import numpy as np

    from ml.embeddings import (
        embed_batch_mlx,
        load_embedding_model,
        mean_pooling,
        normalize_embeddings,
    )

    model, tokenizer = load_embedding_model(cfg)
    rng = random.Random(0)
    sample = rng.sample(chunks, min(n, len(chunks)))
    sample.sort(key=lambda c: len(c["text"]))
    texts = [c["text"] for c in sample]
    prefix = cfg.prefix_document

    def tokenize(batch: list[str]):
        return tokenizer._tokenizer(
            [prefix + t for t in batch],
            return_tensors="mlx",
            padding=True,
            truncation=True,
            max_length=512,
        )

    def forward(inputs):
        out = model(inputs["input_ids"], attention_mask=inputs["attention_mask"])
        if getattr(out, "text_embeds", None) is not None:
            return out.text_embeds
        return normalize_embeddings(mean_pooling(out, inputs["attention_mask"]))

    def current(bs: int) -> np.ndarray:
        # Same as the pipeline: embed_batch_mlx + the 10ms yield per micro-batch.
        parts = []
        for i in range(0, len(texts), bs):
            parts.append(embed_batch_mlx(model, tokenizer, texts[i : i + bs], prefix=prefix))
            time.sleep(0.01)
        return np.vstack(parts)

    def lean(bs: int) -> np.ndarray:
        # No per-batch clear_cache and no sleeps. The 512MB cache limit still caps growth.
        parts = []
        for i in range(0, len(texts), bs):
            e = forward(tokenize(texts[i : i + bs]))
            mx.eval(e)
            parts.append(np.array(e))
        return np.vstack(parts)

    def pipelined(bs: int) -> np.ndarray:
        # Tokenize batch N+1 on the CPU while the GPU runs batch N.
        parts = []
        pending = None
        for i in range(0, len(texts), bs):
            e = forward(tokenize(texts[i : i + bs]))
            mx.async_eval(e)
            if pending is not None:
                parts.append(np.array(pending))
            pending = e
        if pending is not None:
            parts.append(np.array(pending))
        return np.vstack(parts)

    # Warm-up compiles kernels so the first variant isn't penalized.
    lean(min(batch_sizes))

    fns = {"current": current, "lean": lean, "pipelined": pipelined}
    rows = []
    ref = None
    # Each repeat walks every (batch size, variant) pair, starting one pair later
    # than the last repeat. Slow drift on a busy Mac then hits every pair.
    pairs = [(bs, name) for bs in batch_sizes for name in variants]
    for rep in range(repeats):
        shift = rep % len(pairs)
        for bs, name in pairs[shift:] + pairs[:shift]:
            fn = fns[name]
            gc.collect()
            mx.reset_peak_memory()
            t, emb = timed(lambda fn=fn, bs=bs: fn(bs))
            peak_mb = mx.get_peak_memory() / 2**20
            if ref is None:
                ref = emb
            # NaN rows come from the known MLX batch bug; compare only finite rows.
            finite = np.isfinite(emb).all(axis=1) & np.isfinite(ref).all(axis=1)
            max_diff = float(np.abs(emb[finite] - ref[finite]).max()) if finite.any() else 0.0
            nan_rows = int((~np.isfinite(emb).all(axis=1)).sum())
            rows.append(
                {
                    "repeat": rep,
                    "variant": name,
                    "batch_size": bs,
                    "chunks_per_s": round(len(texts) / t, 1),
                    "peak_metal_mb": round(peak_mb),
                    "max_abs_diff_vs_first": round(max_diff, 6),
                    "nan_rows": nan_rows,
                }
            )
            log(f"[embed] {rows[-1]}")

    summary = []
    for bs in batch_sizes:
        for name in variants:
            rates = sorted(
                r["chunks_per_s"] for r in rows if r["batch_size"] == bs and r["variant"] == name
            )
            summary.append(
                {
                    "variant": name,
                    "batch_size": bs,
                    "median_chunks_per_s": statistics.median(rates),
                    "min": rates[0],
                    "max": rates[-1],
                }
            )
            log(f"[embed summary] {summary[-1]}")
    RESULTS["embed"] = {"chunks": len(texts), "runs": rows, "summary": summary}
    for c, e in zip(sample, ref):
        c["embedding_np"] = e
    model = tokenizer = None  # free the model before the write section
    mx.clear_cache()
    return sample


# --------------------------------------------------------------------------
# Section: write
# --------------------------------------------------------------------------


_SCHEMA_SQL = _SRC.parent.parent / "crates" / "ingestion" / "sql" / "duckdb_schema.sql"


def _scratch_db(real_db: Path, workdir: Path):
    """An empty DuckDB file with the ingestion schema, plus its connection.

    It does not copy brb.duckdb, so it needs almost no disk. VSS-only
    statements are skipped; the benchmark never builds a vector index.
    """
    import duckdb

    dst = workdir / f"bench_{next(_scratch_ids)}.duckdb"
    conn = duckdb.connect(str(dst))
    for stmt in _SCHEMA_SQL.read_text().split(";"):
        if stmt.strip() and "HNSW" not in stmt and "vss" not in stmt.lower():
            conn.execute(stmt)
    conn.execute("SET memory_limit='4GB'")
    conn.execute("SET threads=2")
    return dst, conn


def bench_write(embedded: list[dict], real_db: Path, workdir: Path) -> None:
    import numpy as np

    from data.storage import is_valid_embedding

    _, conn = _scratch_db(real_db, workdir)

    def current() -> None:
        conn.execute("TRUNCATE message_chunks")
        chunks = []
        for c in embedded:
            d = {k: v for k, v in c.items() if k != "embedding_np"}
            d["embedding"] = np.nan_to_num(c["embedding_np"])
            if hasattr(storage, "_write_parquet_to_duckdb"):
                d["embedding"] = d["embedding"].tolist()  # what main passes today
            chunks.append(d)
        valid = [c for c in chunks if is_valid_embedding(c["embedding"])]
        for i in range(0, len(valid), 2000):
            write_chunks(conn, valid[i : i + 2000], 0, i)

    def arrow_direct() -> None:
        # Same rows and columns. Two changes: embeddings stay numpy rows (no
        # tolist(), no per-float Python check), and the Arrow table goes straight
        # into DuckDB in memory instead of through a temp Parquet file.

        def insert_from_arrow(conn_, table, target):
            conn_.register("bench_tbl", table)
            try:
                conn_.execute(f"INSERT INTO {target} SELECT * FROM bench_tbl")
            finally:
                conn_.unregister("bench_tbl")
            return table.num_rows

        conn.execute("TRUNCATE message_chunks")
        mat = np.nan_to_num(np.vstack([c["embedding_np"] for c in embedded])).astype(np.float32)
        ok = np.isfinite(mat).all(axis=1)
        chunks = []
        for c, row, good in zip(embedded, mat, ok):
            if good:
                d = {k: v for k, v in c.items() if k != "embedding_np"}
                d["embedding"] = row
                chunks.append(d)
        original = storage._write_parquet_to_duckdb
        storage._write_parquet_to_duckdb = insert_from_arrow
        try:
            for i in range(0, len(chunks), 2000):
                storage.write_chunks_bulk_parquet(conn, chunks[i : i + 2000], 0, i)
        finally:
            storage._write_parquet_to_duckdb = original

    import data.storage as storage

    n = len(embedded)
    t_cur, _ = timed(current)
    RESULTS["write"] = {"chunks": n, "current_chunks_per_s": round(n / t_cur)}
    # The Arrow variant only applies to code that still writes through Parquet.
    if hasattr(storage, "_write_parquet_to_duckdb"):
        t_arrow, _ = timed(arrow_direct)
        RESULTS["write"]["arrow_direct_chunks_per_s"] = round(n / t_arrow)
    log(f"[write] {RESULTS['write']}")
    conn.close()


# --------------------------------------------------------------------------
# Section: daily
# --------------------------------------------------------------------------


def bench_daily(messages: list[dict], real_db: Path, workdir: Path) -> None:
    import pyarrow as pa

    _, conn = _scratch_db(real_db, workdir)
    rows = _aggregate_daily_messages(messages)

    def executemany() -> None:
        conn.execute("TRUNCATE daily_messages")
        conn.executemany(
            "INSERT INTO daily_messages (date, contact_id, is_from_me, message_count) VALUES (?, ?, ?, ?)",
            rows,
        )

    def arrow() -> None:
        conn.execute("TRUNCATE daily_messages")
        cols = list(zip(*rows)) if rows else [[], [], [], []]
        tbl = pa.table(
            {
                "date": cols[0],
                "contact_id": cols[1],
                "is_from_me": cols[2],
                "message_count": cols[3],
            }
        )
        conn.register("d", tbl)
        conn.execute(
            "INSERT INTO daily_messages (date, contact_id, is_from_me, message_count) "
            "SELECT CAST(date AS DATE), contact_id, is_from_me, message_count FROM d"
        )
        conn.unregister("d")

    t_em, _ = timed(executemany)
    t_ar, _ = timed(arrow)
    RESULTS["daily"] = {
        "rows": len(rows),
        "executemany_s": round(t_em, 2),
        "arrow_s": round(t_ar, 3),
    }
    log(f"[daily] {RESULTS['daily']}")
    conn.close()


# --------------------------------------------------------------------------
# Section: fts
# --------------------------------------------------------------------------


def bench_fts(real_db: Path, workdir: Path) -> None:
    """Rebuild the FTS index on a full copy of your real chunks, at 2 threads and at all cores."""
    import duckdb

    runs = []
    for threads in (2, os.cpu_count() or 8):
        # Copy only the two columns the FTS index reads, not the embeddings.
        dst = workdir / f"fts_{threads}.duckdb"
        conn = duckdb.connect(str(dst))
        conn.execute("SET memory_limit='4GB'")
        conn.execute(f"SET threads={threads}")
        conn.execute("INSTALL fts")
        conn.execute("LOAD fts")
        conn.execute(f"ATTACH '{real_db}' AS src (READ_ONLY)")
        conn.execute(
            "CREATE TABLE message_chunks AS SELECT chunk_id, formatted_text FROM src.message_chunks"
        )
        conn.execute("DETACH src")
        n = conn.execute("SELECT COUNT(*) FROM message_chunks").fetchone()[0]
        try:
            conn.execute("PRAGMA drop_fts_index('message_chunks')")
        except duckdb.Error:
            pass
        t, _ = timed(
            lambda conn=conn: conn.execute(
                "PRAGMA create_fts_index('message_chunks', 'chunk_id', 'formatted_text', "
                "stemmer='english', stopwords='english')"
            )
        )
        t_ckpt, _ = timed(lambda conn=conn: conn.execute("CHECKPOINT"))
        runs.append(
            {
                "threads": threads,
                "chunks": n,
                "build_s": round(t, 1),
                "checkpoint_s": round(t_ckpt, 1),
            }
        )
        log(f"[fts] {runs[-1]}")
        conn.close()
        dst.unlink(missing_ok=True)
    RESULTS["fts"] = runs


# --------------------------------------------------------------------------


def main() -> None:
    home = Path.home() / ".be-right-back"
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--snapshot-db", type=Path, required=True)
    p.add_argument("--duckdb", type=Path, default=home / "data/db/brb.duckdb")
    p.add_argument("--only", default="read,decode,stats_sql,chunk,embed,write,daily,fts")
    p.add_argument(
        "--max-contacts", type=int, default=100, help="contacts to read (heaviest first)"
    )
    p.add_argument("--decode-sample", type=int, default=20000)
    p.add_argument("--stats-contacts", type=int, default=200, help="contacts to time in stats_sql")
    p.add_argument("--embed-chunks", type=int, default=4096)
    p.add_argument("--batch-sizes", default="64,128,256")
    p.add_argument("--embed-variants", default="current,lean,pipelined")
    p.add_argument("--repeats", type=int, default=1, help="embed runs per (batch, variant)")
    p.add_argument("--out", type=Path)
    a = p.parse_args()

    sections = set(a.only.split(","))
    cfg = EmbeddingConfig()
    RESULTS["machine"] = {"cpu_count": os.cpu_count(), "default_batch_size": cfg.batch_size}
    workdir = Path(tempfile.mkdtemp(prefix="brb_bench_"))
    try:
        messages: list[dict] = []
        if sections & {"read", "chunk", "embed", "write", "daily"}:
            messages = bench_read(a.snapshot_db, a.max_contacts)
        if "decode" in sections:
            bench_decode(a.snapshot_db, a.decode_sample)
        if "stats_sql" in sections:
            bench_stats_sql(a.snapshot_db, a.stats_contacts)
        chunks: list[dict] = []
        if sections & {"chunk", "embed", "write"}:
            chunks = bench_chunk(messages, cfg)
        embedded: list[dict] = []
        if sections & {"embed", "write"}:
            sizes = [int(x) for x in a.batch_sizes.split(",")]
            variants = a.embed_variants.split(",")
            embedded = bench_embed(chunks, cfg, a.embed_chunks, sizes, variants, a.repeats)
        if "write" in sections:
            bench_write(embedded, a.duckdb, workdir)
        if "daily" in sections:
            bench_daily(messages, a.duckdb, workdir)
        if "fts" in sections:
            bench_fts(a.duckdb, workdir)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    text = json.dumps(RESULTS, indent=2, ensure_ascii=False, default=str)
    print(text)
    if a.out:
        a.out.write_text(text)


if __name__ == "__main__":
    main()
