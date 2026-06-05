# Wiki-Flex DRF Validation

Date: 2026-06-05

Target repository: `/mnt/shared/Documents/Projects/wiki-flex`

## Why this target

Wiki-Flex is a small Django/Django REST Framework project. It is useful for checking whether AVT can find web-facing Execution Flows outside Flask/FastAPI decorator patterns.

## Commands run

Before the fix:

```sh
uv run --project packages/analyzer avt analyze /mnt/shared/Documents/Projects/wiki-flex --list-entrypoints --no-timestamp
uv run --project packages/analyzer avt analyze /mnt/shared/Documents/Projects/wiki-flex --no-timestamp --out /tmp/avt-wikiflex.json
```

After the fix:

```sh
uv run --project packages/analyzer avt analyze /mnt/shared/Documents/Projects/wiki-flex --list-entrypoints --no-timestamp
uv run --project packages/analyzer avt analyze /mnt/shared/Documents/Projects/wiki-flex --no-timestamp --out /tmp/avt-wikiflex.json
uv run --project packages/analyzer python -m unittest discover packages/analyzer/tests
```

## Initial result

- Files scanned: 20
- Entry Points found: 3
- Flows analyzed: 3
- Nodes: 87
- Edges: 0
- Markers: 1
- Warnings: 9

Discovered Entry Points were only `backend/main.py:main` and `backend/manage.py:main` script/CLI candidates. The useful Django REST API views were not discovered.

## Fix made

- Treat Django REST Framework `@api_view(...)` as a web route Entry Point decorator.
- Treat Django REST Framework ViewSet `@action(...)` methods as web route Entry Points.
- Emit likely ORM/database External Interactions for common unresolved ORM methods such as `.save()`, `.filter()`, `.select_related()`, and `.prefetch_related()`.

## Result after fix

- Files scanned: 20
- Entry Points found: 9
- Flows analyzed: 9
- Nodes: 90
- Edges: 5
- Markers: 14
- Warnings: 9

New web Entry Points:

- `backend/engine/views.py:PageViewSet.publish`
- `backend/engine/views.py:PageViewSet.published`
- `backend/engine/views.py:PageViewSet.search`
- `backend/engine/views.py:PageViewSet.unpublish`
- `backend/wiki_flex/auth_views.py:login_view`
- `backend/wiki_flex/auth_views.py:logout_view`

Useful flows with External Interactions:

- `PageViewSet.publish` -> likely ORM/database `.save()`
- `PageViewSet.unpublish` -> likely ORM/database `.save()`
- `PageViewSet.published` -> likely ORM/database `.filter()`
- `PageViewSet.search` -> likely ORM/database `.filter()` calls

Analyzer tests: 23 passed.

## Remaining gaps

- DRF router registrations such as `router.register(..., PageViewSet, ...)` are not yet interpreted as Entry Points for inherited ViewSet actions like list/create/retrieve/update/destroy.
- Django `urlpatterns = [path(...)]` references are not yet used directly for Entry Point discovery; decorated function views are discovered via decorators.
- ORM method detection is heuristic and should stay conservative as more frameworks are tested.

## Verdict

The validation found and fixed a concrete usefulness gap: AVT now finds Django REST Framework function/action Entry Points and shows likely ORM External Interactions for reachable action flows. Wiki-Flex output is still not complete Django routing support, but it is meaningfully more useful than the initial CLI-only graph.
