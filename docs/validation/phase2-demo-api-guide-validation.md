# Phase 2 Generic Hiring-Process Demo API Guide Validation

Date: 2026-06-05

Target repository: `/path/to/hiring-process-demo-api`

## Purpose

Validate the first Phase 2 Guide workflow against a generic hiring-process demo API. This is only a demo project used as a realistic AVT validation target.

This validation uses the built-in `static` Guide provider because no Guide API key was configured in the environment during this run. The provider adapter for OpenAI-compatible APIs is implemented, but was not exercised here.

## Commands run

```sh
uv run --project packages/analyzer avt guide-entrypoints \
  /path/to/hiring-process-demo-api \
  --out /tmp/avt-demo-api-guide.json

uv run --project packages/analyzer avt analyze \
  /path/to/hiring-process-demo-api \
  --guide /tmp/avt-demo-api-guide.json \
  --no-timestamp \
  --out /tmp/avt-demo-api-p2.json
```

## Results

Guide generation:

- Files scanned: 62
- Static Entry Points found: 55
- Provider: `static`
- Suggestions written: 10

Analyze with Guide:

- Entry Points found: 55
- Flows analyzed: 55
- Warnings: 8

Entry Point kinds after applying Guide:

- `web_route`: 51
- `framework_hook`: 3
- `cli_command`: 1

No duplicate manual flows were added because all static Guide suggestions were already discovered by deterministic analysis.

## Top static Guide suggestions

1. `app/api/endpoints/users.py:login_for_access_token`
2. `app/api/endpoints/application.py:toggle_application`
3. `app/api/endpoints/seed.py:run_seeder`
4. `app/api/endpoints/users.py:create_user`
5. `app/api/endpoints/users.py:delete_user`
6. `app/api/endpoints/users.py:update_user`
7. `app/api/endpoints/users.py:read_users_me`
8. `app/main.py:lifespan`
9. `app/main.py:log_requests`
10. `app/main.py:validation_exception_handler`

## Assessment

The static Guide baseline is useful enough to drive the viewer to important flows:

- authentication/session-related route: `login_for_access_token`
- non-CRUD route: `toggle_application`
- operational route: `run_seeder`
- current-user route: `read_users_me`
- application lifecycle/request hooks: `lifespan`, `log_requests`, `validation_exception_handler`

This is better than alphabetical ordering and gives a reasonable fallback when no LLM provider is configured.

## Remaining validation

- Run the `openai-compatible` provider with a real API key.
- Compare provider suggestions against static suggestions.
- Check whether LLM suggestions identify business-relevant flows that static ranking misses.
- Verify provider output remains valid and safe under malformed or surprising responses.
