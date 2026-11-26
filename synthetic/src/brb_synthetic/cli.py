"""Command line entry point: ``brb-synthetic build | install | verify | uninstall``."""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

from brb_synthetic.build import build_corpus, write_sidecars
from brb_synthetic.install import install, uninstall
from brb_synthetic.verify import VerificationError, verify
from brb_synthetic.world import WorldLoadError, load_world

DEFAULT_WORLD = Path(__file__).resolve().parents[2] / "world"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "build"
DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_TARGET = 8000


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="brb-synthetic", description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_parser = subparsers.add_parser("build", help="build chat.db + AddressBook from world/")
    build_parser.add_argument("--world", type=Path, default=DEFAULT_WORLD)
    build_parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    build_parser.add_argument(
        "--anchor",
        default="today",
        help="date that day_offset 0 means: 'today' or YYYY-MM-DD. Use a fixed "
        "date for reproducible eval fixtures, 'today' for a fresh-looking demo.",
    )
    build_parser.add_argument("--target", type=int, default=DEFAULT_TARGET)
    build_parser.add_argument("--seed", type=int, default=20260726)
    build_parser.add_argument("--timezone", default=None)
    build_parser.add_argument("--schema", default="sequoia", choices=["sonoma", "sequoia", "tahoe"])
    build_parser.add_argument(
        "--install", action="store_true", help="install into the snapshot dir after building"
    )

    install_parser = subparsers.add_parser("install", help="copy a build into the snapshot dir")
    install_parser.add_argument("--built", type=Path, default=DEFAULT_OUTPUT)
    install_parser.add_argument(
        "--keep-existing",
        action="store_true",
        help="keep previously installed synthetic snapshots instead of replacing them",
    )

    verify_parser = subparsers.add_parser("verify", help="run the app's real SQL against a build")
    verify_parser.add_argument("--built", type=Path, default=DEFAULT_OUTPUT)
    verify_parser.add_argument("--repo-root", type=Path, default=DEFAULT_REPO_ROOT)

    subparsers.add_parser("uninstall", help="remove installed synthetic snapshots")

    args = parser.parse_args(argv)

    try:
        if args.command == "build":
            return _cmd_build(args)
        if args.command == "install":
            return _cmd_install(args)
        if args.command == "verify":
            return _cmd_verify(args)
        if args.command == "uninstall":
            return _cmd_uninstall()
    except (WorldLoadError, VerificationError, FileNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def _cmd_build(args: argparse.Namespace) -> int:
    world = load_world(args.world)
    anchor = datetime.now() if args.anchor == "today" else datetime.fromisoformat(args.anchor)

    report = build_corpus(
        world,
        args.output,
        anchor=anchor,
        total_target=args.target,
        seed=args.seed,
        timezone=args.timezone,
        schema_version=args.schema,
    )
    write_sidecars(report, args.output)

    span_days = (report.latest_unix - report.earliest_unix) // 86400
    print(f"built {report.message_count:,} messages into {args.output}")
    print(
        f"  {report.authored_count:,} authored (gold spine) + "
        f"{report.filler_count:,} filler across {report.contact_count} contacts "
        f"and {report.group_count} groups"
    )
    print(f"  spanning {span_days} days, anchored {report.anchor.date()} ({report.timezone})")
    print(f"  {len(report.resolved_gold)} gold queries -> gold.resolved.jsonl")

    if args.install:
        return _install_and_report(args.output, keep_existing=False)
    return 0


def _cmd_install(args: argparse.Namespace) -> int:
    return _install_and_report(args.built, keep_existing=args.keep_existing)


def _install_and_report(built: Path, *, keep_existing: bool) -> int:
    report = install(built, replace_synthetic=not keep_existing)
    print(f"installed to {report.snapshot_dir}")
    for path in report.replaced:
        print(f"  replaced previous synthetic snapshot {path.name}")
    if report.real_snapshots_left_alone:
        names = ", ".join(path.name for path in report.real_snapshots_left_alone)
        print(f"  left {len(report.real_snapshots_left_alone)} real snapshot(s) in place: {names}")
        print(
            "  note: the app reads the NEWEST snapshot, and MAX_SNAPSHOTS=1 means a "
            "re-snapshot will delete this one. Run `uninstall` to restore real data."
        )
    return 0


def _cmd_verify(args: argparse.Namespace) -> int:
    from brb_synthetic.build import ADDRESSBOOK_SNAPSHOT_FILENAME, CHAT_SNAPSHOT_FILENAME

    report = verify(
        args.built / CHAT_SNAPSHOT_FILENAME,
        args.repo_root,
        args.built / ADDRESSBOOK_SNAPSHOT_FILENAME,
    )
    print(f"the app's contact query returns {len(report.contacts)} contacts:")
    for row in report.contacts:
        print(f"  {row.identifier:<26} {row.message_count:>6,} messages")
    print(f"total 1:1 messages: {report.total_p2p_messages:,}")
    print(f"group-only messages correctly excluded from 1:1: {report.group_only_messages:,}")
    print(
        f"sampled conversation {report.sampled_contact}: "
        f"{report.sampled_message_count:,} messages, all with text"
    )
    print(f"ROWID order matches date order: {report.rowid_order_is_chronological}")
    print(
        f"AddressBook resolves display names for "
        f"{report.resolvable_display_names}/{len(report.contacts)} contacts"
    )
    if not report.ok:
        print("verification FAILED", file=sys.stderr)
        return 1
    print("verification passed")
    return 0


def _cmd_uninstall() -> int:
    removed = uninstall()
    if not removed:
        print("no synthetic snapshots installed")
    for path in removed:
        print(f"removed {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
