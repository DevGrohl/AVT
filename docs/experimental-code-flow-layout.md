# Experimental Code Flow Layout

The **Code flow paths** viewer layout is an experimental view for understanding one selected Entry Point as a process flow rather than as ownership hierarchy.

## Goal

Show what a selected Entry Point can do and why different paths exist:

- normal calls / next steps;
- External Interactions such as database calls;
- error or success outcomes when the analyzer can infer a safe logical trigger condition.

This is not intended to replace the v1 stable **Swimlane hierarchy** layout. It is an exploratory layout for reasoning about behavior paths inside one flow.

## Current shape

The current experimental layout is a compact top-down hierarchy:

- Entry/root node starts near the top.
- Normal function/method calls descend through the center/right.
- External Interactions attach as above-right clusters near their caller.
- Triggered Error/Success outcomes attach below their source.
- Error outcomes are biased left of the source; success outcomes are biased right.
- Module/class context is pushed below the behavior area to avoid blocking the process view.

This was chosen after screenshot feedback showed that a wide left-to-right mindmap became too horizontally spread and that external nodes could block the main flow.

## Trigger conditions

The analyzer now experimentally adds `trigger_condition` to `raise` and `return` Flow Markers when a safe nearest control-flow condition can be inferred.

Examples:

```json
{
  "kind": "raise",
  "trigger_condition": {
    "expression": "not account",
    "source": "if",
    "certainty": "confirmed"
  }
}
```

Supported trigger sources:

- `if` body: condition is true;
- `else` body: `not (<condition>)`;
- `except`: `except ExceptionType`;
- `loop`: loop iteration / while condition, currently uncertain.

Safe condition stringification supports common expressions:

- names: `user`;
- attributes: `current_user.is_active`;
- comparisons: `user is None`, `account.owner_id != current_user.id`;
- boolean/not: `not active`, `user and not user.active`;
- calls as names only: `is_admin(...)`;
- string literals redacted as `<string>`.

## Outcome nodes

Outcome nodes are viewer-only. They do not change analyzer graph facts.

They are created only in **Code flow paths** layout and only when `trigger_condition` exists:

- `raise` + trigger -> Error outcome node;
- `return` + trigger -> Success outcome node.

Outcome node examples:

- `Error when not account`;
- `Error when except ValueError`;
- `Success when not active`.

Clicking an outcome node opens an inspector showing:

- outcome type;
- trigger expression;
- trigger source/certainty;
- marker reason;
- file/line;
- source function.

## Design decisions

- Keep outcome nodes viewer-only until the model proves useful.
- Do not show generic outcome nodes without trigger conditions; they add noise.
- Prefer safe normalized expressions over raw source snippets.
- Keep v1 stable path protected: Swimlane hierarchy remains the default/stable layout.
- Treat Code Flow as an experiment; tune by screenshot/real-flow feedback.

## Known limitations

- Trigger conditions use nearest enclosing control-flow only, not full path predicates.
- Nested conditions are not composed into full boolean paths yet.
- `elif` handling is approximate because Python AST represents `elif` as nested `if` in `orelse`.
- Exception outcomes show exception type, not original cause details.
- Some expressions are intentionally simplified/redacted for output safety.
- Layout is heuristic and may still need manual drag/layout overlay adjustments.

## Validation commands

```sh
uv run --project packages/analyzer python -m unittest discover packages/analyzer/tests
cd apps/viewer && npm run smoke
scripts/smoke-v1-realtor-viewer.sh /tmp/avt-realtor-v1.json
```

On RealtorCareersAPI, the experiment produced trigger-conditioned outcome markers such as:

- `not account`;
- `not user`;
- `not loaded_position`;
- `except ValueError`;
- `except Exception`.
