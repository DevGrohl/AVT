# Phase 2 LLM Guide Plan

Date: 2026-06-05

## Purpose

Phase 2 adds the LLM **Guide** to help identify likely Entry Points and important Execution Flows when static heuristics are insufficient. The AST analyzer remains the **Worker**: it performs deterministic parsing, graph construction, safety checks, and output generation.

The Guide must adapt to target projects without requiring target-project changes.

## Phase 2 Goals

1. Suggest likely Entry Points from project structure and safe metadata.
2. Explain why each suggested Entry Point matters.
3. Feed selected Entry Points back into the AST Worker through the existing manual Entry Point path.
4. Preserve deterministic, inspectable graph output after Entry Points are chosen.
5. Avoid sending source snippets or secrets unless an explicit later mode allows it.

## Non-goals

- No full-code upload by default.
- No Documentation Aid generation.
- No automatic source modification in target projects.
- No trusting LLM output without validation against the scanned project symbols.

## Inputs to the Guide

Default safe context:

- project name;
- sanitized file tree;
- discovered modules/classes/functions signatures;
- existing discovered Entry Points;
- framework evidence such as router declarations, decorators, and config filenames;
- warning counts and safe warning metadata.

Excluded by default:

- full source code;
- source snippets;
- literal config values;
- secret-looking strings;
- environment variable values.

## Output contract

The Guide returns structured JSON:

```json
{
  "suggested_entry_points": [
    {
      "entry": "relative/path.py:qualified.name",
      "kind": "web_route | framework_hook | cli_command | script | manual",
      "confidence": "high | medium | low",
      "reason": "Short human-readable reason",
      "risk": "What might be wrong or incomplete"
    }
  ],
  "project_observations": [
    "Short notes about architecture shape"
  ]
}
```

Every `entry` must be validated against the Worker symbol index before use. Invalid suggestions become warnings, not graph facts.

## CLI shape

Candidate command:

```sh
avt guide-entrypoints /path/to/project --out /tmp/avt-guide.json
avt analyze /path/to/project --guide /tmp/avt-guide.json --out /tmp/avt-graph.json
```

Alternative combined command after the contract stabilizes:

```sh
avt analyze /path/to/project --with-guide --out /tmp/avt-graph.json
```

## Implementation sequence

1. Add a provider-neutral `GuideProvider` interface. ✅ static baseline provider
2. Add a safe project-summary builder from existing scanner/discovery data. ✅
3. Add JSON schema validation for Guide responses. ✅ basic structural validation
4. Add `guide-entrypoints` CLI command that writes suggestions only. ✅ static baseline provider
5. Add analyzer support for validated Guide suggestions as manual Entry Points. ✅ invalid suggestions become warnings; duplicates are skipped
6. Show Guide suggestions and reasons in the viewer. ✅ guide JSON side panel
7. Validate on RealtorCareersAPI and compare against static discovery. ✅ initial static baseline

## Phase 2 Slice 1 Status

Implemented first foundation slice:

- `avt guide-entrypoints <path> --out guide.json`
- source-free `safe_project_summary`
- source-free `llm_prompt` with output contract instructions
- deterministic baseline `suggested_entry_points`
- `avt analyze --guide guide.json`
- validation against scanned symbols
- validation for required suggestion fields (`entry`, `kind`, `confidence`, `reason`, `risk`)
- invalid suggestions emitted as warnings
- already-discovered suggestions skipped to avoid duplicate flows

RealtorCareersAPI baseline:

- 62 files scanned
- 55 static Entry Points found
- 10 baseline Guide suggestions written
- applying the baseline Guide keeps 55 Entry Points/flows because all baseline suggestions are already statically discovered

## RealtorCareersAPI validation focus

Use RealtorCareersAPI as the primary Phase 2 target:

- Does the Guide identify route groups worth inspecting first?
- Does it call out framework hooks such as lifespan/middleware?
- Does it identify authentication/session flows as important?
- Does it avoid suggesting missing or invalid symbols?
- Are Guide suggestions useful beyond current static discovery?

## Acceptance criteria for first Phase 2 slice

- Guide suggestions can be generated without modifying target projects.
- Suggestions are stored as JSON and validated before graph use.
- Invalid suggestions are reported as warnings.
- RealtorCareersAPI guide output identifies at least three useful flows with reasons.
- Analyzer tests pass.
- Viewer build passes.
