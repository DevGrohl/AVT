# Generic Hiring-Process Demo API Validation

Date: 2026-06-05

Target repository: `/path/to/hiring-process-demo-api`

## Purpose

Use a generic hiring-process demo API as AVT's primary realistic Phase 1 validation target. This is only a demo project, but it is larger and more behavior-rich than Wiki-Flex, with FastAPI endpoints, service modules, SQLAlchemy/database calls, seeding code, authentication, and validators.

Wiki-Flex remains a small Django REST Framework regression case, not the main usefulness target.

## Commands run

```sh
uv run --project packages/analyzer avt analyze /path/to/hiring-process-demo-api --list-entrypoints --no-timestamp
uv run --project packages/analyzer avt analyze /path/to/hiring-process-demo-api --no-timestamp --out /tmp/avt-demo-api.json
python -m json.tool /tmp/avt-demo-api.json >/dev/null
```

## Results

- Files scanned: 62
- Entry Points found: 52 before framework hook discovery; 55 after framework hook discovery
- Flows analyzed: 52 before framework hook discovery; 55 after framework hook discovery
- Nodes: 281 before FastAPI dependency resolution; 282 after FastAPI dependency resolution
- Edges: 258 before FastAPI dependency resolution; 267 after explicit FastAPI dependency resolution; 323 after dependency alias resolution; 326 after framework hook discovery
- Markers: 417 before FastAPI dependency resolution; 432 after FastAPI dependency resolution; 442 after framework hook discovery
- Warnings: 8

Node kinds:

- class: 74
- function: 74
- module: 62
- method: 56
- external: 15

Edge kinds:

- external_interaction: 174 before FastAPI dependency resolution; 177 after FastAPI dependency resolution
- await: 77
- call: 7 before FastAPI dependency resolution; 13 after explicit FastAPI dependency resolution; 69 after dependency alias resolution

Certainty:

- confirmed: 258
- uncertain: 0
- rejected: 0

Top edge evidence reasons:

Initial top edge evidence reasons:

- database_method_call: 84
- database_call: 64
- type_hint_method_call: 49
- orm_method_call: 23
- self_method_call: 18
- imported_module_call: 12
- imported_function_call: 5
- filesystem_call: 3

After explicit FastAPI dependency resolution:

- database_method_call: 86
- database_call: 65
- type_hint_method_call: 50
- orm_method_call: 23
- self_method_call: 18
- imported_module_call: 12
- fastapi_dependency_call: 5
- imported_function_call: 5
- filesystem_call: 3

After FastAPI dependency alias resolution:

- database_method_call: 86
- database_call: 65
- fastapi_dependency_alias_call: 56
- type_hint_method_call: 50
- orm_method_call: 23
- self_method_call: 18
- imported_module_call: 12
- fastapi_dependency_call: 5
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

## Route context hardening

Validation showed that endpoint labels were less useful than they should be because a Developer could see the Python function name but not the decorator route method/path. AVT now includes best-effort web route metadata:

- `http_methods`, e.g. `["POST"]`
- `route_path`, e.g. `/api/positions`, `/api/positions/{id}`, `/api/applications/toggle`
- labels such as `POST /api/positions: app/api/endpoints/position.py:create_position`

For generic hiring-process demo API, all FastAPI decorator Entry Points now show method/path metadata in the graph and viewer. AVT composes common `APIRouter(prefix=...)` and `include_router(..., prefix=...)` prefixes, so route labels match the visible API surface more closely.

## FastAPI dependency resolution hardening

Validation showed that explicit FastAPI dependencies such as `Depends(get_current_active_user)` were part of the runtime Execution Flow but were not represented. AVT now emits `fastapi_dependency_call` edges for explicit dependency functions passed to `Depends(...)`, including `Annotated[..., Depends(...)]` annotations.

Observed dependency edges after the fix:

- `run_seeder -> get_session`
- `run_seeder -> get_current_active_user`
- `read_users_me -> get_current_active_user`
- `get_current_active_user -> get_current_user`
- `get_current_user -> get_session`

This makes authentication/session setup visible in protected endpoint flows.

AVT also resolves imported dependency aliases such as generic hiring-process demo API's `SessionDep = Annotated[AsyncSession, Depends(get_session)]`. This added 56 `fastapi_dependency_alias_call` edges, making database session setup visible across CRUD endpoint flows without requiring any target-project changes.

## Framework hook discovery

generic hiring-process demo API has important FastAPI behavior outside route functions:

- `lifespan` initializes the database connection during app startup.
- `validation_exception_handler` controls request validation error responses.
- `log_requests` wraps all HTTP requests as middleware.

AVT now discovers these as `framework_hook` Entry Points. generic hiring-process demo API gained 3 Entry Points/flows for these hooks, making request/application lifecycle behavior visible without changing the target project.

## Follow-up validation questions

- Do endpoint flows connect to enough service-layer behavior for common CRUD paths?
- Are database/session calls overrepresented compared to domain behavior?
- Should common FastAPI dependency calls be represented differently from meaningful Execution Flow calls?
- Should validation track a stable representative flow set, e.g. `create_position`, `toggle_application`, and `run_seeder`?

## Verdict

generic hiring-process demo API is the right primary validation target for AVT Phase 1. It produces a non-trivial graph with many Entry Points, confirmed service/method edges, External Interactions, and Flow Markers. Future usefulness hardening should start here before using smaller projects as regression cases.
