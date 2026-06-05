"""Command line interface for AVT analyzer."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from avt_analyzer import __version__
from avt_analyzer.entrypoints import discover_entry_points
from avt_analyzer.graph import build_discovery_graph
from avt_analyzer.overlay import apply_overlay, load_overlay
from avt_analyzer.safety import scan_safety
from avt_analyzer.scanner import scan_python_project


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="avt", description="AVT project analysis tools")
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze = subparsers.add_parser("analyze", help="Analyze a local project directory")
    analyze.add_argument("path", type=Path, nargs="?", help="Project directory to analyze")
    analyze.add_argument("--input", type=Path, help="Absolute project directory to analyze; alternative to positional path")
    analyze.add_argument("--out", type=Path, help="Output graph JSON path; defaults to avt-graph.json when --output is omitted")
    analyze.add_argument("--output", "--ouput", dest="output", type=Path, help="Output folder for graph.json, summary.json, warnings.json, and entrypoints.json")
    analyze.add_argument("--entry", action="append", default=[], help="Manual Entry Point: path.py:qualified.name")
    analyze.add_argument("--list-entrypoints", action="store_true", help="List discovered Entry Points without writing graph")
    analyze.add_argument("--overlay", type=Path, help="Analysis Overlay path; defaults to <project>/.avt/overlay.json if present")
    analyze.add_argument("--no-timestamp", action="store_true", help="Omit generated timestamp for reproducible output")
    analyze.add_argument("--include-tests", action="store_true", help="Include tests in scanning")
    analyze.add_argument("--max-depth", type=int, default=6, help="Maximum call traversal depth")
    analyze.set_defaults(func=analyze_command)

    return parser


def analyze_command(args: argparse.Namespace) -> int:
    project_path = _resolve_project_path(args)
    if project_path is None:
        return 2

    if args.out is not None and args.output is not None:
        print("error: --out and --output cannot be used together", file=sys.stderr)
        return 2

    if not project_path.exists():
        print(f"error: path does not exist: {project_path}", file=sys.stderr)
        return 2
    if not project_path.is_dir():
        print(f"error: path is not a directory: {project_path}", file=sys.stderr)
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
        max_depth=args.max_depth,
    )
    graph["warnings"] = [*scan.warnings, *scan_safety(scan), *graph["warnings"]]
    if overlay is not None:
        apply_overlay(graph, load_overlay(overlay))

    if args.list_entrypoints:
        for entry in graph["entry_points"]:
            location = entry["evidence"]["location"]
            print(f"{entry['kind']}\t{location['path']}:{entry['node_id'].rsplit(':', 1)[-1]}\t{entry['evidence']['reason']['label']}")
        print(f"Files scanned: {len(scan.files)}")
        print(f"Entry Points found: {len(graph['entry_points'])}")
        print(f"Warnings: {len(graph['warnings'])}")
        return 0

    summary = _build_summary(scan_files=len(scan.files), graph=graph, overlay=overlay)
    if args.output is not None:
        written = _write_output_folder(args.output, graph, summary)
        graph_path = written / "graph.json"
    else:
        graph_path = args.out or Path("avt-graph.json")
        graph_path.parent.mkdir(parents=True, exist_ok=True)
        graph_path.write_text(json.dumps(graph, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(f"Files scanned: {summary['files_scanned']}")
    print(f"Entry Points found: {summary['entry_points_found']}")
    print(f"Flows analyzed: {summary['flows_analyzed']}")
    print(f"Warnings: {summary['warnings']}")
    print(f"Graph written: {graph_path}")
    if args.output is not None:
        print(f"Output folder: {args.output}")
    if overlay is not None:
        print(f"Overlay applied: {overlay}")
    return 0


def _resolve_project_path(args: argparse.Namespace) -> Path | None:
    positional = args.path.resolve() if args.path is not None else None
    input_path = args.input

    if input_path is not None and not input_path.is_absolute():
        print(f"error: --input must be an absolute path: {input_path}", file=sys.stderr)
        return None

    resolved_input = input_path.resolve() if input_path is not None else None
    if positional is None and resolved_input is None:
        print("error: provide a project path or --input /absolute/path/to/repo", file=sys.stderr)
        return None

    if positional is not None and resolved_input is not None and positional != resolved_input:
        print("error: positional path and --input refer to different directories", file=sys.stderr)
        return None

    return resolved_input or positional


def _build_summary(*, scan_files: int, graph: dict, overlay: Path | None) -> dict[str, object]:
    summary: dict[str, object] = {
        "files_scanned": scan_files,
        "entry_points_found": len(graph["entry_points"]),
        "flows_analyzed": len(graph["flows"]),
        "nodes": len(graph["nodes"]),
        "edges": len(graph["edges"]),
        "markers": len(graph["markers"]),
        "warnings": len(graph["warnings"]),
    }
    if overlay is not None:
        summary["overlay_applied"] = str(overlay)
    return summary


def _write_output_folder(output: Path, graph: dict, summary: dict[str, object]) -> Path:
    output.mkdir(parents=True, exist_ok=True)
    (output / "graph.json").write_text(json.dumps(graph, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (output / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (output / "warnings.json").write_text(json.dumps(graph["warnings"], indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (output / "entrypoints.json").write_text(json.dumps(graph["entry_points"], indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return output


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
