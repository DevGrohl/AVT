# Code-Flow-First Viewer Design

## Purpose

AVT's current default graph is too relationship-first. Sibling calls often render at the same visual rank, so users cannot quickly tell what happens first, what happens next, and what escapes the entry point. This slice changes the viewer's primary mental model from reachability to code flow.

## Goals

- Make AVT answer: "what happens, in what order, inside this entry point?"
- Use one primary visual grammar across Python, JavaScript, and Rust.
- Make monolithic entry functions such as `main()` still legible even when helper-call depth is shallow.
- Keep alternate layouts available as fallback/reference views.
- Improve non-Python usefulness without pretending AVT already has full multi-language call-graph depth.

## Non-goals

- No promise of perfect whole-program execution order.
- No requirement to infer every statement as its own node.
- No removal of fallback layouts in this slice.
- No fake semantic parity when analyzer facts are absent.
- No repository-wide architecture map as the default mental model.

## User problem

Today, many flows flatten into sibling nodes. A user can see that `main()` reaches four calls, but not the intended order. Rust/JS/CLI flows become especially weak because the current graph emphasizes relationship breadth over procedural sequence.

## Product direction

AVT should be code-flow-first by default.

- The primary view becomes a procedural story of one entry point.
- Other layouts remain available, but they become fallback/reference views rather than the main product story.
- Relationship richness is secondary to step readability.

## Core visual grammar

### Entry point container

- Each selected entry point gets one large enclosing container.
- The container title shows the entry point label, kind, and identifying path details.
- Steps that belong to the execution stay inside this container.

### Ordered internal steps

- Internal steps render as an ordered top-to-bottom sequence.
- Arrows communicate execution order, not only generic reachability.
- Sibling calls should not sit at the same visual rank unless they are intentionally parallel or analyzer evidence cannot distinguish order.

### Step types

The primary step vocabulary is:

- function/method call steps;
- control steps: branch, loop, return, error exit;
- external interaction steps: database, filesystem, network, library/service boundaries.

This makes large `main()` functions useful even when few helper functions exist.

### Boundary rule

- Internal app-code steps stay inside the entry-point container.
- External interactions sit outside the container and connect from the step that triggers them.
- The boundary should help a user separate "our code" from "things this code touches".

### Cross-language rule

- The same shapes, colors, and positions mean the same thing across Python, JS, and Rust.
- If one language has weaker analyzer data, the diagram becomes sparser, not semantically different.
- Cross-language consistency matters more than squeezing every language into a different visual model.

## Fallback behavior

- Code-flow-first becomes the default layout.
- Alternate layouts remain switchable for comparison and debugging.
- If analyzer data is partial, still render the best known ordered steps.
- If AVT cannot build a meaningful sequence, fall back to a minimal container with the best-known internal/external steps instead of blanking out.

## Why this helps non-Python earlier

This design reduces the dependency on perfect call-graph depth for usefulness.

- Python still benefits most because analyzer facts are richer.
- JS and Rust become more legible earlier because sequence, control steps, and external interactions can still tell a story.
- The visual product no longer depends on every language producing the same deep reachability graph.

## Interaction

- Entry point selection stays as the main user action.
- Default selected view opens in code-flow-first mode.
- Users can switch to alternate layouts when they need relationship/reference context.
- The viewer should make it visually obvious what step comes first, next, and outside the entry-point boundary.

## Testing

Required checks:

- A simple entry point with four ordered calls no longer renders as same-rank sibling fanout in the default view.
- A monolithic `main()` case can show control/external steps even when helper-call count is low.
- External interactions render outside the entry-point boundary.
- Fallback layouts still work, but code-flow-first is the default.
- Cross-language examples use the same visual grammar.

## Documentation

Update viewer docs to state:

- code-flow-first is the default diagram;
- alternate layouts remain available as fallback/reference views;
- the default view optimizes for step order inside one entry point;
- cross-language support uses the same visual grammar, even when analyzer depth differs.

## Acceptance criteria

- Default selected view is code-flow-first.
- Ordered steps are visually readable inside one entry point.
- External interactions clearly sit outside the entry-point boundary.
- Monolithic entry functions are more legible than today.
- Alternate layouts remain available.
- Docs explain the new primary mental model without overstating analyzer certainty.
