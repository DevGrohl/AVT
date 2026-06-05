# RealtorCareersAPI Validation

Date: 2026-06-05

Target repository: `/mnt/shared/Documents/Projects/RealtorCareersAPI`

## Purpose

Use RealtorCareersAPI as AVT's primary realistic Phase 1 validation target. It is larger and more behavior-rich than Wiki-Flex, with FastAPI endpoints, service modules, SQLAlchemy/database calls, seeding code, authentication, and validators.

Wiki-Flex remains a small Django REST Framework regression case, not the main usefulness target.

## Commands run

```sh
uv run --project packages/analyzer avt analyze /mnt/shared/Documents/Projects/RealtorCareersAPI --list-entrypoints --no-timestamp
uv run --project packages/analyzer avt analyze /mnt/shared/Documents/Projects/RealtorCareersAPI --no-timestamp --out /tmp/avt-realtor.json
python -m json.tool /tmp/avt-realtor.json >/dev/null
```

## Results

- Files scanned: 62
- Entry Points found: 52
- Flows analyzed: 52
- Nodes: 281
- Edges: 258
- Markers: 417
- Warnings: 8

Node kinds:

- class: 74
- function: 74
- module: 62
- method: 56
- external: 15

Edge kinds:

- external_interaction: 174
- await: 77
- call: 7

Certainty:

- confirmed: 258
- uncertain: 0
- rejected: 0

Top edge evidence reasons:

- database_method_call: 84
- database_call: 64
- type_hint_method_call: 49
- orm_method_call: 23
- self_method_call: 18
- imported_module_call: 12
- imported_function_call: 5
- filesystem_call: 3

## Sample useful flow

Top flow: `web_route: app/api/endpoints/seed.py:run_seeder`

Observed path includes:

- `run_seeder -> seeder`
- `seeder -> seed_accounts`
- `seeder -> seed_regions`
- `seeder -> seed_skills`
- database External Interactions via `session.query`, `session.commit`, and `.delete()`
- filesystem External Interactions via `open(...)` in seed file loading

Assessment: this is a useful Execution Flow. A Developer can see the seed endpoint routes into seed orchestration, then into specific seeders, with database and filesystem interactions visible.

## Warnings

Warnings were output-safety warnings only:

- environment variable references for database config and seeding flags;
- one secret-looking literal redaction for `SECRET_KEY`.

No source values were emitted.

## Follow-up validation questions

- Do endpoint flows connect to enough service-layer behavior for common CRUD paths?
- Are database/session calls overrepresented compared to domain behavior?
- Should common FastAPI dependency calls be represented differently from meaningful Execution Flow calls?
- Should validation track a stable representative flow set, e.g. `create_position`, `toggle_application`, and `run_seeder`?

## Verdict

RealtorCareersAPI is the right primary validation target for AVT Phase 1. It produces a non-trivial graph with many Entry Points, confirmed service/method edges, External Interactions, and Flow Markers. Future usefulness hardening should start here before using smaller projects as regression cases.
