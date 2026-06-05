"""Command line interface for AVT analyzer."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from avt_analyzer import __version__
from avt_analyzer.entrypoints import discover_entry_points
from avt_analyzer.graph import build_discovery_graph
from avt_analyzer.scanner import scan_python_project


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="avt", description="AVT project analysis tools")
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze = subparsers.add_parser("analyze", help="Analyze a local project directory")
    analyze.add_argument("path", type=Path, help="Project directory to analyze")
    analyze.add_argument("--out", type=Path, default=Path("avt-graph.json"), help="Output graph JSON path")
    analyze.add_argument("--entry", action="append", default=[], help="Manual Entry Point: path.py:qualified.name")
    analyze.add_argument("--list-entrypoints", action="store_true", help="List discovered Entry Points without writing graph")
    analyze.add_argument("--overlay", type=Path, help="Analysis Overlay path; defaults to <project>/.avt/overlay.json if present")
    analyze.add_argument("--no-timestamp", action="store_true", help="Omit generated timestamp for reproducible output")
    analyze.add_argument("--include-tests", action="store_true", help="Include tests in scanning")
    analyze.add_argument("--max-depth", type=int, default=6, help="Maximum call traversal depth")
    analyze.set_defaults(func=analyze_command)

    return parser


def analyze_command(args: argparse.Namespace) -> int:
    project_path = args.path.resolve()
    if not project_path.exists():
        print(f"error: path does not exist: {args.path}", file=sys.stderr)
        return 2
    if not project_path.is_dir():
        print(f"error: path is not a directory: {args.path}", file=sys.stderr)
        return 2

    overlay = args.overlay
    if overlay is None:
        candidate = project_path / ".avt" / "overlay.json"
        overlay = candidate if candidate.exists() else None

    scan = scan_python_project(project_path, include_tests=args.include_tests)
    discovery = discover_entry_points(scan, manual_entries=args.entry)
    graph = build_discovery_graph(
        project_name=project_path.name,
        analyzer_version=__version__,
        discovery=discovery,
        include_timestamp=not args.no_timestamp,
    )
    graph["warnings"] = [*scan.warnings, *graph["warnings"]]

    if args.list_entrypoints:
        for entry in graph["entry_points"]:
            location = entry["evidence"]["location"]
            print(f"{entry['kind']}\t{location['path']}:{entry['node_id'].rsplit(':', 1)[-1]}\t{entry['evidence']['reason']['label']}")
        print(f"Files scanned: {len(scan.files)}")
        print(f"Entry Points found: {len(graph['entry_points'])}")
        print(f"Warnings: {len(graph['warnings'])}")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(graph, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(f"Files scanned: {len(scan.files)}")
    print(f"Entry Points found: {len(graph['entry_points'])}")
    print(f"Flows analyzed: {len(graph['flows'])}")
    print(f"Warnings: {len(graph['warnings'])}")
    print(f"Graph written: {args.out}")
    if overlay is not None:
        print(f"Overlay applied: {overlay}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
