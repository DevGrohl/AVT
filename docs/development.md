# Development Notes

## Prerequisites

- Python 3.11+
- `uv`
- Node.js and npm for the future viewer/spikes

## Analyzer

Run the analyzer CLI from the repo root:

```sh
uv run --project packages/analyzer avt --help
uv run --project packages/analyzer avt analyze . --no-timestamp --out /tmp/avt-graph.json
```

The analyzer is CLI/library-first. Keep core analysis code reusable so a future API wrapper can call it without shelling out.

## Analyzer verification

```sh
uv run --project packages/analyzer python -m unittest discover packages/analyzer/tests
uv run --project packages/analyzer avt analyze . --no-timestamp --out /tmp/avt-graph.json
python -m json.tool /tmp/avt-graph.json >/dev/null
uv run --project packages/analyzer avt analyze . --list-entrypoints --no-timestamp
```

## Task tracking

Pi task tracking writes local state under `.pi/tasks/`. This is local agent/session state and should not be committed.

## Documentation rules

- Keep `CONTEXT.md` as glossary/domain language only; no implementation details.
- Put implementation plans in `docs/restart-plan.md` or focused docs under `docs/`.
- Use ADRs sparingly for hard-to-reverse, surprising trade-off decisions.
