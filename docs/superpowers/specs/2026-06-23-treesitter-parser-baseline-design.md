# Tree-sitter Parser Baseline Design

## Purpose

AVT needs a mature path toward broader language support without pretending it can already produce high-quality Execution Flows for every language. This slice adds a language-neutral parser seam and a controlled Tree-sitter baseline for JavaScript/TypeScript, Go, and Rust.

## Goals

- Keep existing Python analyzer behavior intact.
- Add Tree-sitter parsing for JavaScript, TypeScript, Go, and Rust through official grammar wheels.
- Normalize parser output into small, language-neutral facts before graph construction.
- Expose mixed-language code-map context through a new top-level `language_facts` array: files, language ids, definitions, imports, source locations, and parser warnings.
- Preserve `avt analyze` as the only analyzer command.

## Non-goals

- No full call graph for JavaScript/TypeScript, Go, or Rust.
- No route discovery outside Python.
- No framework-specific semantics for Express, Nest, Gin, Axum, Actix, or similar frameworks.
- No replacement of the current Python `ast` analyzer.
- No viewer redesign unless existing graph labels need small clarity fixes.
- No claim that AVT supports multi-language Execution Flows in this slice.

## Package choice

Use the official low-level Tree-sitter Python binding and grammar wheels:

- `tree-sitter`
- `tree-sitter-javascript`
- `tree-sitter-typescript`
- `tree-sitter-go`
- `tree-sitter-rust`

This keeps the dependency surface aligned with the backend trio instead of adding a broad language pack. The official binding exposes parser, node traversal, and query APIs directly, which fits AVT's need to own its normalized analyzer contract.

References:

- py-tree-sitter docs: https://tree-sitter.github.io/py-tree-sitter/
- tree-sitter PyPI package: https://pypi.org/project/tree-sitter/
- tree-sitter-language-pack comparison point: https://pypi.org/project/tree-sitter-language-pack/

## Architecture

Add a parser layer between file scanning and graph building.

### Parser registry

A small registry maps file extensions to parser adapters:

- `.py` stays on the existing Python `ast` path.
- `.js` and `.jsx` use JavaScript grammar.
- `.ts` uses TypeScript grammar.
- `.tsx` uses TSX grammar.
- `.go` uses Go grammar.
- `.rs` uses Rust grammar.

Unsupported files are ignored as today.

### Normalized parser facts

Tree-sitter adapters return normalized facts instead of graph nodes directly:

- file path
- language id
- definitions
- imports
- source locations
- warnings

`language_facts` is intentionally separate from Execution Flow nodes and edges. This avoids manufacturing flow semantics before AVT has language-specific call resolution.

Definitions cover the obvious top-level and nested declarations each grammar exposes reliably: functions, methods, classes/types/structs/interfaces where applicable. The first slice must prefer fewer correct facts over broad heuristics.

### Graph integration

The graph JSON includes non-Python parsed facts in `language_facts`. Execution Flow traversal remains Python-only until a later language-specific analyzer can resolve calls and framework entry points well enough to be useful.

## CLI behavior

`avt analyze` remains the single command.

Default behavior:

1. Scan the project once, respecting existing ignored directories and test inclusion rules.
2. Parse Python files through the current analyzer.
3. Parse supported JS/TS/Go/Rust files through Tree-sitter.
4. Emit graph output with Python flows plus supported non-Python `language_facts`.
5. Record warnings for parser failures and continue.

Manual Entry Points remain Python-only. If a user provides a non-Python manual entry, the analyzer must reject it with a clear warning instead of silently pretending it worked.

## Error handling

- Missing or failed Tree-sitter parser: warning, continue analysis.
- Syntax error or partial parse: warning tied to the file, keep any safe facts only if the adapter can identify them confidently.
- Unknown extension: ignore.
- Python parsing behavior: unchanged.

Warnings must not include source snippets or secret-looking literal values.

## Testing

Add focused tests with tiny fixture files for each new baseline language.

Required checks:

- Existing Python analyzer tests still pass.
- JS/TS/Go/Rust files are detected by language id.
- Basic definitions are extracted for each supported language.
- Basic imports are extracted where the language has static import syntax.
- Parser failure produces a warning and does not abort analysis.
- Python Execution Flow output does not regress when mixed-language files are present.

Do not test Tree-sitter grammar internals. Test AVT's normalized facts and failure behavior.

## Documentation

Update user-facing docs to describe this as a Tree-sitter code-map baseline, not broad multi-language Execution Flow support.

Required doc changes:

- README limitations/support section.
- Analyzer README CLI behavior section.
- Development verification commands if new focused tests or dependencies change setup.

## Acceptance criteria

- `avt analyze` works on Python-only projects as before.
- `avt analyze` works on mixed Python/JS/TS/Go/Rust repos without crashing.
- Graph output includes supported non-Python definition/import context in `language_facts`.
- Non-Python manual Entry Points fail clearly.
- Tree-sitter parser failures become warnings.
- Docs avoid overstating multi-language support.
