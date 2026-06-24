# Code-Map Render Design

## Purpose

AVT now exposes non-Python files through `language_facts`, but the viewer still treats them as second-class data: selectable, yet shown only as a text dump. This slice adds a real code-map render for a selected file without pretending AVT has non-Python Execution Flow analysis.

## Goals

- Keep existing Python Entry Point and grouped Execution Flow rendering unchanged.
- Render a selected `language_facts` file as a file-centered code map on the main canvas.
- Use only facts already present in analyzer output: file path, language, definitions, imports, warnings.
- Make the main panel visually useful the first time a user selects a Rust/JS/TS code-map file.
- Keep the distinction between Execution Flow and code map explicit in copy and behavior.

## Non-goals

- No non-Python call graph.
- No Rust/JS/TS route discovery or entry-point inference.
- No fake flow edges or pseudo-behavior semantics.
- No nested ownership inference between definitions in this slice.
- No repository-wide code-map graph.
- No analyzer schema expansion beyond the already-approved `language_facts` facts.

## User problem

Today, selecting a code-map file shows counts and a text list of definitions/imports, but leaves the main canvas empty. The user expects a map render and instead sees a blank area plus text. This makes code-map support feel broken or incomplete even when AVT has the data.

## Architecture

Add a dedicated viewer mode for `code_map` selections.

### Selection model

The selector continues to mix:

- Entry Points
- Entry Point groups
- Code-map file options

Selection behavior changes only in the main panel:

- `entry` and `group` selections keep current Execution Flow behavior.
- `code_map` selections switch to a dedicated code-map canvas and supporting details.

### View-model split

Keep Execution Flow and code map rendering separate.

- Execution Flow continues to use the current flow-model builder.
- Code map gets its own lightweight view-model builder for React Flow.

This avoids manufacturing fake flow nodes/edges from `language_facts`.

## Code-map render behavior

For one selected code-map file, render a file-centered graph.

### Root node

- One central root node for the selected file.
- Label: file path, for example `src/main.rs`.
- Subtitle or badge: language label, for example `Rust`.

### Definition nodes

- One node per extracted definition.
- Each connects directly to the file root.
- Flat layout in this slice, even if future analyzer facts gain qualified nesting.
- Node label: definition name.
- Secondary text: definition kind and source line.

### Import nodes

- One node per extracted import.
- Each connects directly to the file root.
- Import nodes are visually smaller/lighter than definition nodes so definitions remain the main signal.
- Node label: imported module/path.
- Secondary text: source line.

### Warnings

- Warnings stay in the side/details panel, not as graph nodes.
- If there are no definitions and no imports, show a clear empty state instead of a blank canvas:
  - `No code-map facts to render for this file.`

## Layout

The first render should optimize for readability, not algorithm novelty.

- File node centered.
- Definition nodes arranged around the file as the primary first ring.
- Import nodes arranged as secondary leaves, smaller and visually de-emphasized.
- The graph should remain legible for files with moderate import counts.
- Do not add collapsible import clustering in this slice.

## Viewer copy

User-facing wording must stay explicit:

- Code-map selections are not Execution Flows.
- Main panel header changes from Execution Flow wording to code-map wording when a code-map file is selected.
- Supporting hint should say that this view is built from Tree-sitter definitions/imports and does not represent behavior flow.

## Interaction

- Selecting a code-map file from the existing dropdown immediately swaps the main panel into code-map mode.
- Clicking code-map nodes can reuse the existing inspector pattern if convenient, but this slice does not require new deep inspector behavior if the side summary already exposes the needed facts.
- Existing overlay/export flow behavior remains Execution Flow-specific unless a code-map equivalent falls out almost free. Do not design for that now.

## Testing

Required checks:

- A viewer-level test that code-map selections create selectable file-map options.
- A viewer-level test that a selected Rust file produces a file-centered render model with:
  - one file root node;
  - definition nodes;
  - import nodes.
- Existing viewer build still passes.
- Existing Execution Flow selection behavior remains intact.
- Smoke with a real generated HunterCake graph to confirm selecting a Rust file renders a map, not only text.

## Documentation

Update viewer docs to explain:

- code-map file selections exist in the shared dropdown;
- code-map mode renders a file-centered map;
- non-Python code-map render is structural only, not behavior flow.

## Acceptance criteria

- Selecting a Python Entry Point or Entry Point group still shows the current Execution Flow graph.
- Selecting a code-map file shows a rendered file-centered map on the main canvas.
- The rendered code map uses only existing `language_facts` data.
- The file is visually central; definitions are primary; imports are secondary leaves.
- The main panel no longer looks blank for a code-map selection.
- Docs do not overstate this as Rust/JS/TS flow analysis.
