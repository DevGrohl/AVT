"""Phase 2 LLM Guide foundation.

This module intentionally keeps the first Guide slice provider-neutral and safe:
it builds a metadata-only project summary and validates structured Guide
suggestions before they can influence graph construction.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, TypedDict

from avt_analyzer.entrypoints import DiscoveryResult, EntryPointCandidate
from avt_analyzer.schema import GraphWarning

GuideConfidence = Literal["high", "medium", "low"]


class GuideSuggestion(TypedDict):
    entry: str
    kind: str
    confidence: GuideConfidence
    reason: str
    risk: str


class GuideOutput(TypedDict):
    suggested_entry_points: list[GuideSuggestion]
    project_observations: list[str]


@dataclass(frozen=True)
class GuideValidationResult:
    entries: tuple[str, ...]
    warnings: tuple[GraphWarning, ...]


def build_safe_project_summary(*, project_name: str, discovery: DiscoveryResult) -> dict[str, object]:
    """Build source-free project context suitable for a future Guide provider."""

    entry_counts: dict[str, int] = {}
    for entry in discovery.entry_points:
        entry_counts[entry.kind] = entry_counts.get(entry.kind, 0) + 1

    return {
        "project_name": project_name,
        "modules": [module.relative_path for module in discovery.modules],
        "classes": [
            {
                "path": cls.relative_path,
                "qualified_name": cls.qualified_name,
                "name": cls.name,
            }
            for cls in discovery.classes
        ],
        "functions": [
            {
                "path": fn.relative_path,
                "qualified_name": fn.qualified_name,
                "kind": fn.node_kind,
                "signature": fn.signature,
                "type_hints": fn.type_hints,
            }
            for fn in discovery.functions
        ],
        "discovered_entry_points": [_entry_point_summary(entry) for entry in discovery.entry_points],
        "entry_point_counts": dict(sorted(entry_counts.items())),
    }


def build_static_guide_output(*, project_name: str, discovery: DiscoveryResult) -> GuideOutput:
    """Return deterministic baseline suggestions until an LLM provider is wired in."""

    suggestions: list[GuideSuggestion] = []
    for entry in _rank_entry_points(discovery.entry_points)[:10]:
        suggestions.append(
            {
                "entry": _entry_ref(entry),
                "kind": entry.kind,
                "confidence": "high",
                "reason": _suggestion_reason(entry),
                "risk": "Static ranking may not match the Developer's current investigation goal.",
            }
        )

    return {
        "suggested_entry_points": suggestions,
        "project_observations": [
            f"Project {project_name} has {len(discovery.modules)} Python modules and {len(discovery.entry_points)} discovered Entry Points.",
            "Suggestions are generated from safe metadata only; no source snippets or literal values are included.",
        ],
    }


def write_guide_file(path: Path, *, project_name: str, discovery: DiscoveryResult) -> None:
    safe_summary = build_safe_project_summary(project_name=project_name, discovery=discovery)
    payload = {
        "safe_project_summary": safe_summary,
        "llm_prompt": build_guide_prompt(safe_summary),
        **build_static_guide_output(project_name=project_name, discovery=discovery),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def build_guide_prompt(safe_summary: dict[str, object]) -> str:
    """Build a source-free prompt for a future LLM Guide provider."""

    return "\n".join(
        [
            "You are the AVT LLM Guide.",
            "Your job is to recommend useful Entry Points for a Developer trying to understand this Python project.",
            "Use only the safe metadata below. Do not invent files, functions, or source facts.",
            "Return strict JSON with keys: suggested_entry_points and project_observations.",
            "Each suggested_entry_points item must include: entry, kind, confidence, reason, risk.",
            "entry must use format relative/path.py:qualified.name and must refer to a symbol in the metadata.",
            "confidence must be one of: high, medium, low.",
            "Prefer Entry Points that explain application lifecycle, user-facing behavior, authentication/session setup, and non-trivial business flows.",
            "",
            "SAFE PROJECT METADATA JSON:",
            json.dumps(safe_summary, indent=2, sort_keys=True),
        ]
    )


def load_guide_entries(path: Path, discovery: DiscoveryResult) -> GuideValidationResult:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return GuideValidationResult((), ({"code": "invalid_guide_file", "message": f"Could not read Guide file {path}: {exc}"},))

    suggestions = raw.get("suggested_entry_points") if isinstance(raw, dict) else None
    if not isinstance(suggestions, list):
        return GuideValidationResult((), ({"code": "invalid_guide_file", "message": f"Guide file missing suggested_entry_points list: {path}"},))

    valid_refs = {(fn.relative_path, fn.qualified_name) for fn in discovery.functions}
    discovered_refs = {_entry_ref(entry) for entry in discovery.entry_points}
    entries: list[str] = []
    warnings: list[GraphWarning] = []
    seen: set[str] = set()

    for suggestion in suggestions:
        if not isinstance(suggestion, dict) or not isinstance(suggestion.get("entry"), str):
            warnings.append({"code": "invalid_guide_suggestion", "message": "Guide suggestion missing string entry"})
            continue
        entry = suggestion["entry"]
        try:
            relative_path, qualified_name = entry.split(":", 1)
        except ValueError:
            warnings.append({"code": "invalid_guide_suggestion", "message": f"Guide Entry Point must be path.py:qualified.name: {entry}"})
            continue
        if (relative_path, qualified_name) not in valid_refs:
            warnings.append({"code": "guide_entry_not_found", "message": f"Guide Entry Point not found in scanned symbols: {entry}"})
            continue
        if entry in discovered_refs:
            continue
        if entry not in seen:
            entries.append(entry)
            seen.add(entry)

    return GuideValidationResult(tuple(entries), tuple(warnings))


def _entry_point_summary(entry: EntryPointCandidate) -> dict[str, object]:
    summary: dict[str, object] = {
        "entry": _entry_ref(entry),
        "kind": entry.kind,
        "reason": entry.evidence["reason"]["label"],
    }
    if entry.route_path is not None:
        summary["route_path"] = entry.route_path
    if entry.http_methods:
        summary["http_methods"] = list(entry.http_methods)
    return summary


def _entry_ref(entry: EntryPointCandidate) -> str:
    return f"{entry.function.relative_path}:{entry.function.qualified_name}"


def _rank_entry_points(entries: tuple[EntryPointCandidate, ...]) -> list[EntryPointCandidate]:
    kind_rank = {"framework_hook": 0, "web_route": 1, "cli_command": 2, "script": 3, "manual": 4}
    return sorted(entries, key=lambda entry: (kind_rank.get(entry.kind, 9), entry.function.relative_path, entry.function.qualified_name))


def _suggestion_reason(entry: EntryPointCandidate) -> str:
    if entry.kind == "framework_hook":
        return "Framework hook shapes application or request lifecycle behavior."
    if entry.kind == "web_route":
        route = f" {'/'.join(entry.http_methods)} {entry.route_path}" if entry.route_path else ""
        return f"Web route{route} is a user-facing behavior Entry Point."
    if entry.kind == "cli_command":
        return "CLI command can start a behavior flow from the command line."
    if entry.kind == "script":
        return "Executable script can start a standalone behavior flow."
    return "Manual Entry Point candidate from Guide output."
