# AVT Analyzer

Python package and CLI for generating AVT **Execution Flow Graph** JSON from local Python project directories.

The analyzer is CLI/library-first. A backend API can wrap it later without shelling out.

## Install / run in this monorepo

From the AVT repository root:

```sh
uv run --project packages/analyzer avt --help
uv run --project packages/analyzer avt analyze --help
```

Generate a graph file:

```sh
uv run --project packages/analyzer avt analyze . --out /tmp/avt-graph.json
```

Generate an output folder with all parsing results:

```sh
uv run --project packages/analyzer avt analyze --input /absolute/path/to/repo --output avt-output
```

Generate reproducible graph JSON:

```sh
uv run --project packages/analyzer avt analyze . --no-timestamp --out /tmp/avt-graph.json
```

Validate JSON:

```sh
python -m json.tool /tmp/avt-graph.json >/dev/null
```

## CLI reference

Command:

```sh
avt analyze [path] [options]
```

### Parameters and options

| Option | Required | Value | Default | Description |
| --- | --- | --- | --- | --- |
| `<path>` | conditionally | directory | none | Local project directory to analyze. Optional when `--input` is provided. |
| `--input` | conditionally | absolute path | none | Absolute project directory to analyze. Optional alternative to positional `<path>`. If both are provided, they must resolve to the same directory. |
| `--out` | no | path | `avt-graph.json` when `--output` is omitted | Output graph JSON file path. Parent directories are created automatically. Cannot be combined with `--output`. |
| `--output` | no | folder path | none | Output folder for all parsing results. Writes `graph.json`, `summary.json`, `warnings.json`, and `entrypoints.json`. Cannot be combined with `--out`. |
| `--entry` | no | `path.py:qualified.name` | none | Manual Entry Point. Can be repeated. Relative path is from analyzed project root. |
| `--list-entrypoints` | no | flag | false | Print discovered Entry Points and counts without writing graph JSON. |
| `--overlay` | no | path | `<project>/.avt/overlay.json` if present | Analysis Overlay path. Applies uncertain edge resolutions. |
| `--no-timestamp` | no | flag | false | Omit `metadata.generated_at` for reproducible output. |
| `--include-tests` | no | flag | false | Include tests in scanning. Tests are excluded by default. |
| `--max-depth` | no | integer | `6` | Maximum confirmed-call traversal depth from each Entry Point. |

## Usage examples

### Analyze a project to one graph file

```sh
uv run --project packages/analyzer avt analyze /path/to/project --out graph.json
```

If `--out` and `--output` are omitted, the analyzer writes `avt-graph.json` in the current directory.

### Analyze with `--input`

`--input` is an absolute-path alternative to the positional project path:

```sh
uv run --project packages/analyzer avt analyze --input /absolute/path/to/project --out graph.json
```

### Analyze to an output folder

Use `--output` when you want all parsing result files in one folder:

```sh
uv run --project packages/analyzer avt analyze --input /absolute/path/to/project --output avt-output
```

Output folder contents:

```text
avt-output/
  graph.json        Full Execution Flow Graph
  summary.json      Counts and high-level run summary
  warnings.json     Warning list only
  entrypoints.json  Entry Point list only
```

Rules:

- `--output` creates the folder if needed;
- `--output` cannot be combined with `--out`;
- `--ouput` is accepted as a typo-compatible alias, but `--output` is the documented spelling.

### List Entry Points

```sh
uv run --project packages/analyzer avt analyze /path/to/project --list-entrypoints
```

Output format is tab-separated rows followed by counts:

```text
cli_command	path/to/file.py:main	Called from if __name__ == '__main__'
Files scanned: 12
Entry Points found: 1
Warnings: 0
```

### Analyze one manual Entry Point

```sh
uv run --project packages/analyzer avt analyze /path/to/project \
  --entry src/app.py:main \
  --out graph.json
```

Manual Entry Point format:

```text
relative/path.py:qualified.name
```

Examples:

```text
app.py:main
src/server.py:create_app
src/controllers/users.py:UserController.list_users
```

### Analyze multiple manual Entry Points

```sh
uv run --project packages/analyzer avt analyze /path/to/project \
  --entry app.py:main \
  --entry cli.py:analyze_command \
  --out graph.json
```

### Include tests

```sh
uv run --project packages/analyzer avt analyze /path/to/project --include-tests
```

### Change traversal depth

```sh
uv run --project packages/analyzer avt analyze /path/to/project --max-depth 10
```

### Reproducible output

```sh
uv run --project packages/analyzer avt analyze /path/to/project \
  --no-timestamp \
  --out graph.json
```

With `--no-timestamp`, `metadata.generated_at` is omitted and deterministic ordering checks apply.

## Entry Point discovery

Supported Phase 1 Entry Point candidates:

- web route decorators using common Flask/FastAPI-style patterns:
  - `@app.route(...)`
  - `@app.get(...)`
  - `@router.post(...)`
  - Django REST Framework `@api_view(...)` and ViewSet `@action(...)`;
  - other common HTTP decorator names;
- CLI command decorators using Click/Typer-like patterns:
  - `@click.command()`
  - `@app.command()`
  - `@app.callback()`;
- `if __name__ == "__main__"` calls;
- executable script candidates:
  - shebang Python files;
  - `__main__.py`;
  - files under `scripts/`, `bin/`, or `tools/`;
- manual `--entry` values.

If no `--entry` is provided, all discovered Entry Points are analyzed within depth limits.

## Scanning defaults

The scanner includes Python files and excludes these by default:

- test directories/files unless `--include-tests` is passed:
  - `tests/`, `test/`, `test_*.py`, `*_test.py`;
- migrations;
- common generated/cache/vendor directories:
  - `.git`, `.hg`, `.venv`, `.tox`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `__pycache__`, `node_modules`, `dist`, `build`, `site-packages`, `vendor`.

Files are scanned in deterministic relative-path order.

## Call and flow analysis

The analyzer currently detects:

- same-module function calls;
- imported local function calls;
- package/source-root imports for common layouts:
  - `src/package/...`
  - `packages/*/src/package/...`;
- `self.method()` calls in the current class;
- directly instantiated local method calls:
  - `svc = Service(); svc.run()`;
- type-hint-based method calls for locals and parameters:
  - `svc: Service; svc.run()`;
  - `def route(service: Service = Depends()): service.run()`;
- simple argparse dispatch:
  - `parser.set_defaults(func=handler)`;
  - `args.func(args)`;
- explicit FastAPI dependency calls:
  - `Depends(get_current_user)`;
  - `Annotated[User, Depends(get_current_user)]`;
- `await` edges;
- ambiguous unqualified calls as Uncertain Edges;
- ambiguous type-based method dispatch as Uncertain Edges.

Traversal follows confirmed local calls up to `--max-depth`. Uncertain Edges are emitted but not traversed.

## External Interactions

The analyzer emits External Interaction nodes/edges for meaningful calls outside the local code path:

- filesystem:
  - `open(...)`;
  - path-like methods such as `.exists()`, `.mkdir()`, `.read_text()`, `.write_text()`;
  - `shutil.*`;
- subprocess/shell:
  - `subprocess.*`;
  - `os.system(...)`, `os.popen(...)`;
- HTTP/network:
  - `requests.*`, `httpx.*`, `urllib.request.*`, `aiohttp.*`;
  - `.get()`, `.post()`, etc. when passed a literal `http://` or `https://` URL;
- database-ish calls:
  - `sqlite3.*`, `psycopg2.*`, `pymysql.*`, `mysql.connector.*`, `sqlalchemy.*`;
  - methods such as `.execute()`, `.query()`, `.commit()`, `.rollback()`, `.connect()`;
  - likely ORM methods such as `.save()`, `.filter()`, `.select_related()`, and `.prefetch_related()`.

## Flow Markers

Reachable functions can receive Flow Markers for static behavior evidence:

- `async` — async function;
- `conditional` — `if`, conditional expression, or `match`;
- `loop` — `for`, `async for`, or `while`;
- `raise` — `raise` statement;
- `return` — `return` statement.

## Graph output

Top-level JSON keys:

```json
{
  "metadata": {},
  "entry_points": [],
  "flows": [],
  "nodes": [],
  "edges": [],
  "markers": [],
  "warnings": []
}
```

Important conventions:

- paths are relative to the analyzed project;
- no source snippets or full source code are embedded;
- output ordering is deterministic;
- `--no-timestamp` omits generated timestamps;
- node IDs and edge IDs are stable for the same source and options;
- graph contract fixtures live under `packages/analyzer/tests/fixtures/`.

## Warnings

Warnings may be emitted for:

- read/decode/parse errors;
- invalid manual Entry Point values;
- missing manual Entry Point targets;
- invalid overlay files or overlay references;
- output-safety findings.

Warnings include safe messages and locations when available.

## Analysis Overlay

Overlay files let Developers confirm or reject Uncertain Edges without changing source code.

Default location:

```text
<project>/.avt/overlay.json
```

Explicit location:

```sh
uv run --project packages/analyzer avt analyze /path/to/project --overlay /path/to/overlay.json
```

Overlay shape:

```json
{
  "edge_resolutions": [
    {"edge_id": "edge:...", "certainty": "confirmed"},
    {"edge_id": "edge:...", "certainty": "rejected"}
  ]
}
```

Rules:

- only `confirmed` and `rejected` are accepted overlay certainties;
- overlay resolutions apply only to existing uncertain edges;
- invalid overlay entries become warnings;
- rejected edges remain in graph output with `certainty: "rejected"` so the viewer can filter them.

## Safety behavior

AVT is not a security scanner. Safety scanning protects graph output:

- secret-looking literal values are redacted from warnings;
- environment variable names may be emitted, values are not;
- docstrings are skipped;
- warnings include source locations, not raw secret values;
- graph JSON does not embed source snippets.

Warning examples:

```text
secret_literal_redacted
Environment variable referenced: DATABASE_URL
```

## Limitations

Current Phase 1 limitations:

- static AST analysis only;
- no full Python import/runtime semantics;
- no full control-flow graph;
- dynamic dispatch is limited to implemented patterns;
- third-party calls are not traversed;
- inherited/override relationships are not fully modeled yet;
- External Interaction detection is heuristic;
- Analysis Overlay editing is not available in the CLI.

## Development verification

Run analyzer tests:

```sh
uv run --project packages/analyzer python -m unittest discover packages/analyzer/tests
```

Run the analyzer on this repo:

```sh
uv run --project packages/analyzer avt analyze . --no-timestamp --out /tmp/avt-self-graph.json
python -m json.tool /tmp/avt-self-graph.json >/dev/null
```

Run a real manual Entry Point validation:

```sh
uv run --project packages/analyzer avt analyze . \
  --entry packages/analyzer/src/avt_analyzer/cli.py:analyze_command \
  --no-timestamp \
  --out /tmp/avt-self-analyze-command-graph.json
```
