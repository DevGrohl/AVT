"""Phase 2 LLM Guide foundation.

This module intentionally keeps the first Guide slice provider-neutral and safe:
it builds a metadata-only project summary and validates structured Guide
suggestions before they can influence graph construction.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol, TypedDict

from avt_analyzer.entrypoints import DiscoveryResult, EntryPointCandidate
from avt_analyzer.schema import GraphWarning

GuideConfidence = Literal["high", "medium", "low"]
GUIDE_CONFIDENCES = {"high", "medium", "low"}
GUIDE_ENTRY_KINDS = {"web_route", "framework_hook", "cli_command", "script", "manual"}


class GuideSuggestion(TypedDict):
    entry: str
    kind: str
    confidence: GuideConfidence
    reason: str
    risk: str


class GuideOutput(TypedDict):
    suggested_entry_points: list[GuideSuggestion]
    project_observations: list[str]


class GuideProvider(Protocol):
    """Provider-neutral contract for Phase 2 Guide implementations."""

    name: str

    def suggest_entry_points(self, *, project_name: str, discovery: DiscoveryResult, safe_summary: dict[str, object]) -> GuideOutput:
        """Return structured Guide suggestions from safe project metadata."""


class StaticGuideProvider:
    """Deterministic metadata-only provider used for tests and offline baseline."""

    name = "static"

    def suggest_entry_points(self, *, project_name: str, discovery: DiscoveryResult, safe_summary: dict[str, object]) -> GuideOutput:
        return build_static_guide_output(project_name=project_name, discovery=discovery)


class OpenAICompatibleGuideProvider:
    """Minimal OpenAI-compatible chat-completions Guide provider."""

    name = "openai-compatible"

    def __init__(self, *, api_key: str, model: str, api_url: str) -> None:
        self.api_key = api_key
        self.model = model
        self.api_url = api_url

    def suggest_entry_points(self, *, project_name: str, discovery: DiscoveryResult, safe_summary: dict[str, object]) -> GuideOutput:
        prompt = build_guide_prompt(safe_summary)
        request_body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "You are AVT's LLM Guide. Return strict JSON only."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }
        request = urllib.request.Request(
            self.api_url,
            data=json.dumps(request_body).encode("utf-8"),
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                response_payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"Guide provider request failed: {exc}") from exc

        content = response_payload.get("choices", [{}])[0].get("message", {}).get("content")
        if not isinstance(content, str):
            raise RuntimeError("Guide provider response missing choices[0].message.content")
        try:
            guide_output = json.loads(content)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Guide provider returned non-JSON content: {exc}") from exc
        return normalize_guide_output(guide_output)


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


def make_guide_provider(*, provider_name: str, model: str | None = None, api_url: str | None = None, api_key: str | None = None) -> GuideProvider:
    if provider_name == "static":
        return StaticGuideProvider()
    if provider_name == "openai-compatible":
        resolved_key = api_key or os.environ.get("AVT_GUIDE_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not resolved_key:
            raise ValueError("openai-compatible Guide provider requires AVT_GUIDE_API_KEY or OPENAI_API_KEY")
        resolved_model = model or os.environ.get("AVT_GUIDE_MODEL") or "gpt-4o-mini"
        base_url = api_url or os.environ.get("AVT_GUIDE_API_URL") or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1/chat/completions"
        if base_url.rstrip("/").endswith("/v1"):
            base_url = f"{base_url.rstrip('/')}/chat/completions"
        return OpenAICompatibleGuideProvider(api_key=resolved_key, model=resolved_model, api_url=base_url)
    raise ValueError(f"Unknown Guide provider: {provider_name}")


def write_guide_file(path: Path, *, project_name: str, discovery: DiscoveryResult, provider: GuideProvider | None = None) -> None:
    safe_summary = build_safe_project_summary(project_name=project_name, discovery=discovery)
    guide_provider = provider or StaticGuideProvider()
    payload = {
        "provider": guide_provider.name,
        "safe_project_summary": safe_summary,
        "llm_prompt": build_guide_prompt(safe_summary),
        **guide_provider.suggest_entry_points(project_name=project_name, discovery=discovery, safe_summary=safe_summary),
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


def normalize_guide_output(value: object) -> GuideOutput:
    if not isinstance(value, dict):
        raise RuntimeError("Guide provider returned a non-object JSON value")
    suggestions = value.get("suggested_entry_points")
    observations = value.get("project_observations")
    if not isinstance(suggestions, list) or not isinstance(observations, list):
        raise RuntimeError("Guide provider JSON must include suggested_entry_points and project_observations lists")
    return {
        "suggested_entry_points": suggestions,  # validated later by load_guide_entries/analyze
        "project_observations": [item for item in observations if isinstance(item, str)],
    }


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
        schema_warnings = _validate_suggestion_shape(suggestion)
        if schema_warnings:
            warnings.extend(schema_warnings)
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


def _validate_suggestion_shape(suggestion: object) -> list[GraphWarning]:
    if not isinstance(suggestion, dict):
        return [{"code": "invalid_guide_suggestion", "message": "Guide suggestion must be an object"}]

    warnings: list[GraphWarning] = []
    entry = suggestion.get("entry")
    kind = suggestion.get("kind")
    confidence = suggestion.get("confidence")
    reason = suggestion.get("reason")
    risk = suggestion.get("risk")

    if not isinstance(entry, str):
        warnings.append({"code": "invalid_guide_suggestion", "message": "Guide suggestion missing string entry"})
    if not isinstance(kind, str) or kind not in GUIDE_ENTRY_KINDS:
        warnings.append({"code": "invalid_guide_suggestion", "message": f"Guide suggestion has invalid kind: {kind}"})
    if not isinstance(confidence, str) or confidence not in GUIDE_CONFIDENCES:
        warnings.append({"code": "invalid_guide_suggestion", "message": f"Guide suggestion has invalid confidence: {confidence}"})
    if not isinstance(reason, str) or not reason.strip():
        warnings.append({"code": "invalid_guide_suggestion", "message": "Guide suggestion missing non-empty reason"})
    if not isinstance(risk, str) or not risk.strip():
        warnings.append({"code": "invalid_guide_suggestion", "message": "Guide suggestion missing non-empty risk"})
    return warnings


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
    return sorted(entries, key=lambda entry: (-_entry_importance_score(entry), entry.function.relative_path, entry.function.qualified_name))


def _entry_importance_score(entry: EntryPointCandidate) -> int:
    name = entry.function.qualified_name.lower()
    path = entry.function.relative_path.lower()
    route = (entry.route_path or "").lower()
    methods = set(entry.http_methods)
    score = 0

    if entry.kind == "framework_hook":
        score += 100
    elif entry.kind == "web_route":
        score += 60
    elif entry.kind == "cli_command":
        score += 45
    elif entry.kind == "script":
        score += 35

    if any(token in name or token in path or token in route for token in ["auth", "login", "token", "user", "session", "current_user"]):
        score += 35
    if any(token in name or token in route for token in ["seed", "toggle", "search", "publish", "callback"]):
        score += 25
    if methods & {"POST", "PUT", "PATCH", "DELETE"}:
        score += 15
    if route and not any(crud in name for crud in ["get_", "create_", "update_", "delete_"]):
        score += 10
    return score


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
