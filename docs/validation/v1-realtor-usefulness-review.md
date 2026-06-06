# V1 Usefulness Review: RealtorCareersAPI

Date: 2026-06-06

Target project: `/mnt/shared/Documents/Projects/RealtorCareersAPI`

Graph generated with:

```sh
uv run --project packages/analyzer avt analyze \
  /mnt/shared/Documents/Projects/RealtorCareersAPI \
  --no-timestamp \
  --out /tmp/avt-realtor-v1.json
python -m json.tool /tmp/avt-realtor-v1.json >/dev/null
```

## Summary

Observed counts:

- Files scanned: 62
- Entry Points: 55
- Flows: 55
- Nodes: 284
- Edges: 326
- Markers: 442
- Warnings: 8

## Viewer-ranked top flows

The viewer ranks Entry Points with a deterministic score based on flow size, Entry Point kind, route/action terms, mutating HTTP methods, and onboarding-relevant names such as auth/user/session/search/toggle.

Top 10 with current ranking:

| Rank | Score | Flow | Nodes | Edges | Useful? |
| --- | ---: | --- | ---: | ---: | --- |
| 1 | 129 | `POST /api/seed/seed` | 16 | 29 | Useful but likely too operational/demo-specific for default first flow. |
| 2 | 121 | `DELETE /api/users/{id}` | 10 | 11 | Useful; shows route -> service -> DB mutation. |
| 3 | 119 | `POST /api/users/token` | 9 | 9 | Very useful; auth/login flow should be top onboarding candidate. |
| 4 | 119 | `PUT /api/users/{id}` | 8 | 9 | Useful; user update flow. |
| 5 | 116 | `POST /api/users` | 6 | 6 | Useful; user creation and password/security helper. |
| 6 | 112 | `POST /api/applications/toggle` | 8 | 12 | Useful; non-CRUD domain action. |
| 7 | 103 | `framework_hook: lifespan` | 4 | 3 | Useful secondary; startup DB inspection. |
| 8 | 103 | `GET /api/users/me` | 8 | 8 | Very useful; current-user dependency/security path. |
| 9 | 101 | `GET /api/users/{id}` | 6 | 6 | Useful but routine CRUD. |
| 10 | 101 | `GET /api/users` | 6 | 6 | Useful but routine CRUD. |

## Good signs

- Top ranked flows are mostly web routes, not arbitrary helper functions.
- Auth/user/session-related routes rank highly.
- Mutating routes rank above simple reads.
- Domain action `/api/applications/toggle` ranks above most CRUD reads.
- Selected flows include endpoint, service/helper, DB/session, and security files.
- Route prefix composition is visible in labels such as `/api/users/token` and `/api/applications/toggle`.
- External Interaction evidence gives a quick sense of DB-touching code.

## Example useful paths

### `POST /api/users/token`

Touched files:

- `app/api/endpoints/users.py`
- `app/core/db.py`
- `app/core/security_utils.py`
- `app/security/security.py`
- `app/services/user.py`

External/DB evidence:

- `session.execute`
- `session.rollback`
- `sqlalchemy.select`

This is a strong onboarding flow because it crosses route, auth/security, user service, DB session dependency, and token creation.

### `POST /api/applications/toggle`

Touched files:

- `app/api/endpoints/application.py`
- `app/core/db.py`
- `app/services/application.py`

External/DB evidence:

- `session.commit`
- `session.delete`
- `session.execute`
- `session.rollback`
- `sqlalchemy.select`

This is a strong domain-specific flow because it is not generic CRUD naming and likely encodes product behavior.

### `POST /api/seed/seed`

Touched files:

- `app/api/endpoints/seed.py`
- `app/core/db.py`
- `app/security/security.py`
- `app/seeder/account_seeder.py`
- `app/seeder/region_seeder.py`
- `app/seeder/seed.py`
- `app/seeder/skill_seeder.py`
- `app/services/user.py`

This flow is rich, but should probably not be the default first onboarding flow because it is operational/demo setup rather than normal product behavior.

## Gaps found

1. **Seed route over-ranked.** It is useful, but default first flow should probably be auth/login, current user, or a domain action.
2. **Empty framework hooks over-ranked.** `log_requests` and `validation_exception_handler` can score high from kind alone despite zero edges. Framework hooks should only outrank routes when they have meaningful interactions/edges.
3. **Some External Interaction labels are noisy.** Example: `database: router.delete` appears because broad database heuristics treat a method name `delete` as DB-like even when it may be an API router decorator. This should be tightened.
4. **Ranking is viewer-only.** The graph file itself does not yet expose explicit usefulness metadata, so CLI/headless validation has to duplicate viewer scoring.

## V1 Recommendations

Before calling v1 useful:

1. Adjust top-flow ranking so normal product/auth/domain routes beat seed/admin/setup routes by default.
2. Penalize zero-edge framework hooks.
3. Add explicit rank/reason display in the viewer so users understand why a flow is first.
4. Tighten likely ORM External Interaction heuristics to reduce labels like `database: router.delete`.
5. Add a real-graph viewer smoke fixture so the standard Realtor-style graph cannot blank.

## Verdict

AVT is close to v1-useful for RealtorCareersAPI. The top 10 flows are mostly meaningful, but the default first flow should be improved before the v1 demo. The most useful initial flow today is likely `POST /api/users/token` or `POST /api/applications/toggle`, not `POST /api/seed/seed`.
