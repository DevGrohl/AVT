# AVT v1 Onboarding Demo and Acceptance Criteria

AVT v1 should make one workflow useful and reliable:

> Open an unfamiliar Python API/backend repository, identify the important execution flows, inspect route/service/database/external interactions, and correct uncertain edges without modifying the target project.

The primary validation target is `/mnt/shared/Documents/Projects/RealtorCareersAPI`. `wiki-flex` remains a small Django/DRF regression target, not the main usefulness benchmark.

## V1 Scope

### Supported well enough for v1

- Python backend/API projects.
- FastAPI route discovery and router prefix composition.
- FastAPI dependencies, including common `Annotated[..., Depends(...)]` aliases.
- FastAPI framework hooks such as lifespan, middleware, and exception handlers.
- Django/DRF route/action discovery for regression coverage.
- Static function/method call traversal with certainty annotations.
- Likely ORM/database interactions.
- Likely external interactions.
- Flow usefulness ranking.
- Static/local viewer exploration.
- Analysis Overlay corrections for uncertain edges.
- Layout Overlay persistence for manual presentation edits.

### Explicit non-goals for v1

- Broad multi-language support.
- Perfect whole-program call graph accuracy.
- Automatic architecture truth from LLMs.
- Modifying target projects.
- Source-code upload or backend service dependency.
- Resizable hierarchy containers.
- Polishing every layout variant equally.

## Demo Workflow

From the AVT repo root:

```sh
uv run --project packages/analyzer avt analyze \
  /mnt/shared/Documents/Projects/RealtorCareersAPI \
  --no-timestamp \
  --out /tmp/avt-realtor-v1.json

python -m json.tool /tmp/avt-realtor-v1.json >/dev/null

cd apps/viewer
npm install
npm run dev
```

Open the printed viewer URL, then load `/tmp/avt-realtor-v1.json` with **Load graph JSON**.

## Expected User Outcome

Within a few minutes, a developer should be able to answer:

1. What are the main HTTP/API Entry Points?
2. Which flows are likely most important to inspect first?
3. What modules/classes/functions are touched by a selected flow?
4. Where do database/ORM or external interactions appear?
5. Which edges are uncertain and need human confirmation?
6. Can false-positive uncertain edges be confirmed/rejected without changing source?

## Binary Acceptance Criteria

V1 is accepted when all criteria are true.

### Analyzer criteria

- [ ] RealtorCareersAPI analysis completes without modifying the target repo.
- [ ] Generated graph JSON is valid JSON.
- [ ] Graph contains at least one FastAPI route Entry Point.
- [ ] Graph contains composed route paths including router prefixes.
- [ ] Graph contains at least one FastAPI dependency-flow edge when dependencies are present.
- [ ] Graph contains at least one framework hook Entry Point when hooks are present.
- [ ] Graph contains likely ORM/database External Interaction evidence when present.
- [ ] Graph contains deterministic flow usefulness ranking metadata or ordering.

### Viewer criteria

- [ ] Viewer production build passes.
- [ ] Viewer smoke test passes against a realistic graph.
- [ ] Default selected flow is useful, not arbitrary noise.
- [ ] Selected flow renders visible React Flow nodes and edges.
- [ ] Node/edge details remain secondary/collapsed enough to keep the graph primary.
- [ ] Guide suggestions can be loaded and filtered.
- [ ] Layout Overlay can export/import manual positions.
- [ ] Analysis Overlay can export confirmed/rejected uncertain edges.

### Documentation criteria

- [ ] README quickstart explains the v1 workflow.
- [ ] V1 demo commands are copy/paste runnable from the AVT repo root.
- [ ] Supported frameworks and limitations are clear.
- [ ] Overlay round-trip is documented.
- [ ] Future multi-language/LSP plan is linked but not presented as v1 functionality.

### Usefulness criteria

- [ ] Top 5 RealtorCareersAPI flows include meaningful onboarding candidates.
- [ ] At least one top flow demonstrates route -> service/helper -> ORM/external/context interaction.
- [ ] A human can inspect a selected top flow and name the likely source files to read next.
- [ ] False positives can be corrected via overlay instead of source changes.

## Anti-Criteria

V1 is not accepted if:

- the viewer can blank out while loading the standard v1 graph;
- a v1 workflow requires editing RealtorCareersAPI source code;
- the graph is dominated by low-value helper functions instead of Entry Points;
- LLM Guide output is required to get useful baseline results;
- a visual experiment such as resizing can break the default graph path.

## Validation Commands

```sh
# Analyzer tests
uv run --project packages/analyzer python -m unittest discover packages/analyzer/tests

# RealtorCareersAPI graph
uv run --project packages/analyzer avt analyze \
  /mnt/shared/Documents/Projects/RealtorCareersAPI \
  --no-timestamp \
  --out /tmp/avt-realtor-v1.json
python -m json.tool /tmp/avt-realtor-v1.json >/dev/null

# Viewer smoke
cd apps/viewer
npm run smoke
```

## Decision

Do v1 before broader language work. Multi-language support should follow the future LSP-assisted plan after AVT is demonstrably useful for the Python/FastAPI/DRF onboarding workflow.
