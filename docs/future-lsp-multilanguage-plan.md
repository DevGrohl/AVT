# Future Plan: LSP-Assisted Multi-Language Support

AVT should eventually support more than Python, but it should not become a separate compiler for every language. The long-term direction is to keep AVT's graph model and viewer language-neutral, then use framework adapters plus Language Server Protocol (LSP) support to understand project symbols across languages.

## Vision

AVT becomes a framework-aware architecture graph builder that uses LSPs as language intelligence providers.

```text
Framework adapters discover meaning:
  routes, handlers, controllers, framework hooks, ORM/client usage

LSPs resolve language semantics:
  definitions, references, symbols, imports, types

AVT core normalizes output:
  Entry Points, nodes, edges, evidence, certainty, flows, overlays
```

The viewer should continue to consume the same AVT graph JSON regardless of source language.

## Why LSPs

LSPs can provide the cross-file symbol intelligence that is expensive to reimplement per language:

- go-to-definition;
- find references;
- document/workspace symbols;
- hover/type information where available;
- import and module resolution;
- symbol identity across files.

This is especially valuable for TypeScript, Java, Go, and C#, whose language servers are mature.

## What LSPs Do Not Replace

LSPs usually do not know AVT's architecture concepts directly. They do not reliably answer:

- what all HTTP routes are;
- which functions are meaningful Entry Points;
- whether a call is a framework hook;
- whether an operation is ORM/database access;
- whether a call is an external service interaction;
- which flows are useful for onboarding.

Those remain AVT/framework-adapter responsibilities.

## Target Architecture

```text
AVT Core
  - graph schema
  - flow builder
  - usefulness ranking
  - evidence/certainty model
  - Analysis Overlay
  - layout overlay contract
  - viewer

Language Services
  - Python: pyright/pylsp optional, current AST analyzer remains fallback
  - TypeScript/JavaScript: tsserver or typescript-language-server
  - Java: jdtls
  - Go: gopls
  - C#: Roslyn/OmniSharp

Framework Adapters
  - Python: FastAPI, Django, DRF
  - TypeScript/JavaScript: Express, NestJS, Next.js API routes
  - Java: Spring Boot
  - Go: net/http, Gin, Echo, Chi
  - C#: ASP.NET
```

## Pipeline

### 1. Detect project language and framework

Examples:

- `pyproject.toml`, `requirements.txt`, `*.py` -> Python;
- `package.json`, `tsconfig.json`, `*.ts`, `*.js` -> TypeScript/JavaScript;
- `pom.xml`, `build.gradle`, `*.java` -> Java;
- `go.mod`, `*.go` -> Go;
- `*.csproj`, `Program.cs` -> C#.

Framework detection should be explicit and reported to the user.

### 2. Start or connect to a language server

AVT should support a deep mode that starts/uses an LSP when available:

```sh
avt analyze ./repo --deep
```

Fast mode can remain AST/framework-pattern based:

```sh
avt analyze ./repo --fast
```

### 3. Build a symbol index

Use LSP requests such as:

- `textDocument/documentSymbol`;
- `workspace/symbol`;
- `textDocument/definition`;
- `textDocument/references`.

Normalize symbols into AVT identities:

```json
{
  "symbol_id": "typescript:src/users.ts:getUser",
  "name": "getUser",
  "kind": "function",
  "path": "src/users.ts",
  "range": { "start": { "line": 10, "character": 0 }, "end": { "line": 30, "character": 1 } },
  "language": "typescript"
}
```

### 4. Let framework adapters discover Entry Points

Example for Express:

```ts
router.get('/users/:id', getUser)
```

The Express adapter extracts:

- HTTP method: `GET`;
- route path: `/users/:id`;
- handler expression: `getUser`.

Then AVT asks the LSP for the definition of `getUser` and creates:

- an Entry Point;
- route/handler nodes;
- route -> handler edge with evidence.

### 5. Expand execution flow

Within a handler, AVT scans call expressions and asks the LSP where each call resolves.

- Project symbol -> call edge.
- Known external library/client -> External Interaction edge.
- ORM/database client -> data/ORM marker or External Interaction node.
- Unknown/dynamic target -> uncertain edge with evidence.

## Evidence and Certainty

Every LSP-assisted edge must keep evidence:

```json
{
  "certainty": "confirmed",
  "evidence": {
    "reason": {
      "code": "lsp_definition_resolved_call",
      "label": "Call target resolved by language server definition lookup"
    },
    "location": {
      "path": "src/routes/users.ts",
      "line": 12
    }
  }
}
```

If the LSP is missing, times out, or returns ambiguous results, AVT should degrade gracefully and mark edges uncertain rather than failing the whole analysis.

## CLI Concepts

Future commands/options:

```sh
avt analyze ./repo --language auto
avt analyze ./repo --languages python,typescript
avt analyze ./repo --fast
avt analyze ./repo --deep
avt languages
avt doctor ./repo
```

`avt doctor` should report detected support and environment readiness:

```text
Detected:
- TypeScript: high confidence
- Express: medium confidence
- Prisma: high confidence

Language server:
- typescript-language-server: available

Project dependencies:
- node_modules: missing

Coverage:
- routes: supported
- call graph: partial
- ORM interactions: supported for Prisma
```

## First Multi-Language Milestone

The recommended first non-Python milestone is experimental TypeScript/JavaScript Express support.

Scope:

- detect `package.json` and TypeScript/JavaScript files;
- detect Express route registrations:
  - `app.get/post/put/delete(...)`;
  - `router.get/post/put/delete(...)`;
- resolve route handlers using TypeScript LSP;
- create route -> handler flows;
- expand same-project function calls using LSP definitions where possible;
- detect common External Interactions:
  - `fetch`;
  - `axios`;
  - `prisma`;
  - `typeorm`;
  - `sequelize`;
  - `mongoose`;
- add a fixture Express app and tests;
- render through the existing viewer without viewer changes.

Future framework packs can then add NestJS, Next.js API routes, Spring Boot, Go HTTP frameworks, and ASP.NET.

## Implementation Tasks

1. Define a `LanguageService` abstraction.
2. Define an `LspClient` wrapper with timeout/error handling.
3. Add language/framework detection results to analyzer metadata.
4. Add `avt doctor` for language server/dependency readiness.
5. Refactor Python analysis behind the same adapter boundary without regressing current FastAPI/DRF support.
6. Add TypeScript/JavaScript analyzer skeleton.
7. Add Express route discovery.
8. Add LSP-assisted handler resolution.
9. Add LSP-assisted project-call expansion.
10. Add JS/TS External Interaction detection.
11. Add a small Express fixture app.
12. Add tests for detector, routes, symbol resolution, graph contract, and viewer smoke.
13. Document support as experimental until validated on realistic projects.

## Risks

- LSP startup can be slow, especially for Java.
- LSPs often require project dependencies to be installed.
- LSP protocol is position-based; AVT still needs parsers or syntax queries to identify interesting positions.
- Dynamic frameworks and dependency injection can still require framework-specific logic.
- Broad language support can dilute usefulness if added before one framework path is strong.

## Non-Goals for Early Multi-Language Work

- Perfect whole-program call graphs.
- Full support for every framework in a language.
- Replacing deterministic graph facts with LLM guesses.
- Making the viewer language-specific.
- Modifying target projects to make analysis work.

## Success Criteria

Experimental TypeScript/Express support is useful when:

- AVT detects an Express project automatically;
- the top Entry Points are actual HTTP routes;
- route handlers resolve across files using LSP;
- at least one service/helper call is shown in the flow;
- common external/DB clients are marked;
- failures degrade to uncertain evidence instead of crashing;
- the same viewer renders the graph without custom TS-specific UI.

## Strategic Principle

Add languages through narrow, useful framework slices:

```text
one language + one framework + one onboarding workflow
```

Do not chase broad syntax support before AVT is useful for a real project in that ecosystem.
