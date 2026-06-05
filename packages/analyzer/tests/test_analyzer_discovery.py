from __future__ import annotations

import json
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from avt_analyzer.entrypoints import discover_entry_points
from avt_analyzer.scanner import scan_python_project


class AnalyzerDiscoveryTests(unittest.TestCase):
    def test_scanner_excludes_tests_and_migrations_by_default(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text("def main():\n    pass\n", encoding="utf-8")
            (root / "tests").mkdir()
            (root / "tests" / "test_app.py").write_text("def test_main():\n    pass\n", encoding="utf-8")
            (root / "migrations").mkdir()
            (root / "migrations" / "001_init.py").write_text("def upgrade():\n    pass\n", encoding="utf-8")

            default_scan = scan_python_project(root)
            include_tests_scan = scan_python_project(root, include_tests=True)

        self.assertEqual([file.relative_path for file in default_scan.files], ["app.py"])
        self.assertEqual([file.relative_path for file in include_tests_scan.files], ["app.py", "tests/test_app.py"])

    def test_discovers_web_cli_script_and_manual_entry_points(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    @app.get('/items')
                    def list_items() -> list[str]:
                        return []

                    @click.command()
                    def cli(verbose: bool = False):
                        pass

                    def main():
                        cli()

                    if __name__ == "__main__":
                        main()
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "scripts").mkdir()
            (root / "scripts" / "tool.py").write_text("def main():\n    pass\n", encoding="utf-8")

            scan = scan_python_project(root)
            discovery = discover_entry_points(scan, manual_entries=["app.py:list_items"])

        entries = {(entry.kind, entry.function.relative_path, entry.function.qualified_name) for entry in discovery.entry_points}
        list_items = next(entry for entry in discovery.entry_points if entry.kind == "web_route" and entry.function.qualified_name == "list_items")
        self.assertIn(("web_route", "app.py", "list_items"), entries)
        self.assertEqual(list_items.route_path, "/items")
        self.assertEqual(list_items.http_methods, ("GET",))
        self.assertIn("GET /items", list_items.label)
        self.assertIn(("cli_command", "app.py", "cli"), entries)
        self.assertIn(("cli_command", "app.py", "main"), entries)
        self.assertIn(("script", "scripts/tool.py", "main"), entries)
        self.assertIn(("manual", "app.py", "list_items"), entries)

    def test_discovers_django_rest_framework_entry_point_decorators(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "views.py").write_text(
                textwrap.dedent(
                    """
                    from rest_framework.decorators import action, api_view

                    @api_view(["POST"])
                    def login_view(request):
                        return None

                    class PageViewSet:
                        @action(detail=True, methods=["post"])
                        def publish(self, request, slug=None):
                            return None
                    """
                ).lstrip(),
                encoding="utf-8",
            )

            scan = scan_python_project(root)
            discovery = discover_entry_points(scan)

        entries = {(entry.kind, entry.function.relative_path, entry.function.qualified_name) for entry in discovery.entry_points}
        login = next(entry for entry in discovery.entry_points if entry.function.qualified_name == "login_view")
        publish = next(entry for entry in discovery.entry_points if entry.function.qualified_name == "PageViewSet.publish")
        self.assertIn(("web_route", "views.py", "login_view"), entries)
        self.assertEqual(login.http_methods, ("POST",))
        self.assertIn("POST ?", login.label)
        self.assertIn(("web_route", "views.py", "PageViewSet.publish"), entries)
        self.assertEqual(publish.http_methods, ("POST",))

    def test_discovers_fastapi_framework_hooks(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    from contextlib import asynccontextmanager
                    from fastapi import FastAPI, Request

                    @asynccontextmanager
                    async def lifespan(app: FastAPI):
                        yield

                    app = FastAPI(lifespan=lifespan)

                    @app.exception_handler(ValueError)
                    async def value_error_handler(request: Request, exc: ValueError):
                        return None

                    @app.middleware("http")
                    async def log_requests(request: Request, call_next):
                        return await call_next(request)
                    """
                ).lstrip(),
                encoding="utf-8",
            )

            scan = scan_python_project(root)
            discovery = discover_entry_points(scan)

        entries = {(entry.kind, entry.function.qualified_name, entry.evidence["reason"]["code"]) for entry in discovery.entry_points}
        self.assertIn(("framework_hook", "lifespan", "fastapi_lifespan"), entries)
        self.assertIn(("framework_hook", "value_error_handler", "framework_hook_decorator"), entries)
        self.assertIn(("framework_hook", "log_requests", "framework_hook_decorator"), entries)

    def test_composes_fastapi_router_prefixes_into_route_paths(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app").mkdir()
            (root / "app" / "__init__.py").write_text("", encoding="utf-8")
            (root / "app" / "endpoints.py").write_text(
                textwrap.dedent(
                    """
                    from fastapi import APIRouter

                    router = APIRouter()

                    @router.get('/{id}')
                    def get_item(id: int):
                        return None
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "app" / "main.py").write_text(
                textwrap.dedent(
                    """
                    from fastapi import APIRouter, FastAPI
                    from app.endpoints import router as item_router

                    app = FastAPI()
                    api_router = APIRouter(prefix='/api')
                    api_router.include_router(item_router, prefix='/items')
                    app.include_router(api_router)
                    """
                ).lstrip(),
                encoding="utf-8",
            )

            scan = scan_python_project(root)
            discovery = discover_entry_points(scan)

        entry = next(entry for entry in discovery.entry_points if entry.function.qualified_name == "get_item")
        self.assertEqual(entry.route_path, "/api/items/{id}")
        self.assertEqual(entry.label, "GET /api/items/{id}: app/endpoints.py:get_item")

    def test_cli_resolves_fastapi_dependency_type_alias_edges(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app").mkdir()
            (root / "app" / "__init__.py").write_text("", encoding="utf-8")
            (root / "app" / "deps.py").write_text(
                textwrap.dedent(
                    """
                    from typing import Annotated
                    from fastapi import Depends

                    def get_session():
                        return None

                    SessionDep = Annotated[object, Depends(get_session)]
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "app" / "routes.py").write_text(
                textwrap.dedent(
                    """
                    from app.deps import SessionDep

                    @router.get('/items')
                    async def list_items(session: SessionDep):
                        return []
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        reason_codes = {edge["evidence"]["reason"]["code"] for edge in graph["edges"]}
        self.assertIn("fastapi_dependency_alias_call", reason_codes)
        self.assertEqual(len(graph["flows"][0]["edge_ids"]), 1)
        self.assertEqual(len(graph["flows"][0]["node_ids"]), 2)

    def test_cli_resolves_fastapi_dependency_edges(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    from typing import Annotated
                    from fastapi import Depends

                    def get_current_user():
                        return None

                    @router.get('/me')
                    async def read_me(user: Annotated[object, Depends(get_current_user)]):
                        return user
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        reason_codes = {edge["evidence"]["reason"]["code"] for edge in graph["edges"]}
        self.assertIn("fastapi_dependency_call", reason_codes)
        self.assertEqual(len(graph["flows"][0]["edge_ids"]), 1)
        self.assertEqual(len(graph["flows"][0]["node_ids"]), 2)

    def test_cli_input_and_output_folder_mode_writes_parsing_results(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp) / "repo"
            root.mkdir()
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    @app.get('/')
                    def home():
                        return None
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            output = Path(temp) / "avt-output"

            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "avt_analyzer.cli",
                    "analyze",
                    "--input",
                    str(root.resolve()),
                    "--output",
                    str(output),
                    "--no-timestamp",
                ],
                check=True,
                capture_output=True,
                text=True,
            )

            graph = json.loads((output / "graph.json").read_text(encoding="utf-8"))
            summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
            warnings = json.loads((output / "warnings.json").read_text(encoding="utf-8"))
            entrypoints = json.loads((output / "entrypoints.json").read_text(encoding="utf-8"))

        self.assertIn("Output folder:", result.stdout)
        self.assertEqual(graph["metadata"]["project_name"], "repo")
        self.assertEqual(summary["files_scanned"], 1)
        self.assertEqual(summary["entry_points_found"], 1)
        self.assertEqual(warnings, [])
        self.assertEqual(entrypoints, graph["entry_points"])

    def test_cli_output_folder_accepts_ouput_typo_alias(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp) / "repo"
            root.mkdir()
            (root / "app.py").write_text("def main():\n    pass\nif __name__ == '__main__':\n    main()\n", encoding="utf-8")
            output = Path(temp) / "avt-output"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--ouput", str(output), "--no-timestamp"],
                check=True,
                capture_output=True,
                text=True,
            )

            self.assertTrue((output / "graph.json").exists())
            self.assertTrue((output / "summary.json").exists())

    def test_cli_rejects_output_folder_with_out_file(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp) / "repo"
            root.mkdir()
            (root / "app.py").write_text("def main():\n    pass\n", encoding="utf-8")

            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "avt_analyzer.cli",
                    "analyze",
                    str(root),
                    "--out",
                    str(Path(temp) / "graph.json"),
                    "--output",
                    str(Path(temp) / "avt-output"),
                ],
                capture_output=True,
                text=True,
            )

        self.assertEqual(result.returncode, 2)
        self.assertIn("--out and --output cannot be used together", result.stderr)

    def test_cli_rejects_relative_input_option(self) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "avt_analyzer.cli", "analyze", "--input", "relative/path"],
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 2)
        self.assertIn("--input must be an absolute path", result.stderr)

    def test_cli_writes_graph_with_discovered_entry_points(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    @router.post('/submit')
                    async def submit(payload: dict) -> None:
                        return None
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            out = root / "graph.json"

            result = subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        self.assertIn("Files scanned: 1", result.stdout)
        self.assertIn("Entry Points found: 1", result.stdout)
        self.assertNotIn("generated_at", graph["metadata"])
        self.assertEqual(graph["entry_points"][0]["kind"], "web_route")
        self.assertEqual(graph["flows"][0]["node_ids"], [graph["entry_points"][0]["node_id"]])

    def test_cli_follows_confirmed_local_calls_and_awaits(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    @router.post('/submit')
                    async def submit():
                        validate()
                        await persist()

                    def validate():
                        for item in []:
                            if item:
                                return item
                        raise ValueError('invalid')

                    async def persist():
                        pass
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        edge_kinds = {(edge["kind"], edge["certainty"], edge["evidence"]["reason"]["code"]) for edge in graph["edges"]}
        self.assertIn(("call", "confirmed", "same_module_call"), edge_kinds)
        self.assertIn(("await", "confirmed", "same_module_call"), edge_kinds)
        self.assertEqual(len(graph["flows"][0]["edge_ids"]), 2)
        self.assertEqual(len(graph["flows"][0]["node_ids"]), 3)
        marker_kinds = {marker["kind"] for marker in graph["markers"]}
        self.assertGreaterEqual(marker_kinds, {"async", "loop", "conditional", "return", "raise"})
        self.assertEqual(set(graph["flows"][0]["marker_ids"]), {marker["id"] for marker in graph["markers"]})

    def test_cli_resolves_imported_local_functions(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    import helpers
                    from more_helpers import finish

                    @app.get('/')
                    def home():
                        helpers.prepare()
                        finish()
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "helpers.py").write_text("def prepare():\n    pass\n", encoding="utf-8")
            (root / "more_helpers.py").write_text("def finish():\n    pass\n", encoding="utf-8")
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        reason_codes = {edge["evidence"]["reason"]["code"] for edge in graph["edges"]}
        self.assertEqual(reason_codes, {"imported_module_call", "imported_function_call"})
        self.assertTrue(all(edge["certainty"] == "confirmed" for edge in graph["edges"]))

    def test_cli_resolves_argparse_set_defaults_dispatch(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "cli.py").write_text(
                textwrap.dedent(
                    """
                    import argparse

                    def build_parser():
                        parser = argparse.ArgumentParser()
                        parser.set_defaults(func=run)
                        return parser

                    def run(args):
                        helper()

                    def helper():
                        pass

                    def main(argv=None):
                        parser = build_parser()
                        args = parser.parse_args(argv)
                        return args.func(args)

                    if __name__ == "__main__":
                        main()
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        reason_codes = {edge["evidence"]["reason"]["code"] for edge in graph["edges"]}
        self.assertGreaterEqual(reason_codes, {"same_module_call", "argparse_dispatch_call"})
        self.assertTrue(any(edge["target"].endswith("cli.py:run") for edge in graph["edges"]))
        self.assertTrue(any(edge["target"].endswith("cli.py:helper") for edge in graph["edges"]))

    def test_cli_resolves_package_imports_from_src_layouts(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            package = root / "packages" / "tool" / "src" / "my_tool"
            package.mkdir(parents=True)
            (package / "__init__.py").write_text("", encoding="utf-8")
            (package / "helpers.py").write_text(
                textwrap.dedent(
                    """
                    class Worker:
                        def run(self):
                            finish()

                    def finish():
                        pass
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    from my_tool.helpers import Worker, finish

                    @app.get('/')
                    def home():
                        worker: Worker
                        worker.run()
                        finish()
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        reason_codes = {edge["evidence"]["reason"]["code"] for edge in graph["edges"]}
        self.assertGreaterEqual(reason_codes, {"type_hint_method_call", "imported_function_call", "same_module_call"})
        self.assertTrue(any(edge["target"].endswith("packages/tool/src/my_tool/helpers.py:Worker.run") for edge in graph["edges"]))
        self.assertTrue(any(edge["target"].endswith("packages/tool/src/my_tool/helpers.py:finish") for edge in graph["edges"]))

    def test_cli_resolves_type_hint_method_calls_on_parameters(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    from services import AccountService

                    @router.post('/accounts')
                    def create_account(service: AccountService = Depends()):
                        return service.create_account()
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "services.py").write_text(
                textwrap.dedent(
                    """
                    class AccountService:
                        def create_account(self):
                            self.persist()

                        def persist(self):
                            pass
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        reason_codes = {edge["evidence"]["reason"]["code"] for edge in graph["edges"]}
        self.assertGreaterEqual(reason_codes, {"type_hint_method_call", "self_method_call"})
        self.assertTrue(any(edge["target"].endswith("services.py:AccountService.create_account") for edge in graph["edges"]))
        self.assertTrue(any(edge["target"].endswith("services.py:AccountService.persist") for edge in graph["edges"]))
        self.assertGreaterEqual(len(graph["flows"][0]["node_ids"]), 3)

    def test_cli_resolves_self_instantiated_and_type_hint_method_calls(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    from services import Service

                    @app.get('/')
                    def home():
                        local = LocalService()
                        local.run()
                        svc: Service
                        svc.execute()

                    class LocalService:
                        def run(self):
                            self.finish()

                        def finish(self):
                            pass
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "services.py").write_text(
                "class Service:\n    def execute(self):\n        pass\n",
                encoding="utf-8",
            )
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        reason_codes = {edge["evidence"]["reason"]["code"] for edge in graph["edges"]}
        self.assertGreaterEqual(reason_codes, {"instantiated_method_call", "type_hint_method_call", "self_method_call"})
        self.assertTrue(all(edge["certainty"] == "confirmed" for edge in graph["edges"]))

    def test_cli_emits_uncertain_edges_for_ambiguous_method_dispatch(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    @app.get('/')
                    def home():
                        svc: Service
                        svc.run()
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "one.py").write_text("class Service:\n    def run(self):\n        pass\n", encoding="utf-8")
            (root / "two.py").write_text("class Service:\n    def run(self):\n        pass\n", encoding="utf-8")
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        uncertain = [edge for edge in graph["edges"] if edge["certainty"] == "uncertain"]
        self.assertEqual(len(uncertain), 2)
        self.assertTrue(all(edge["evidence"]["reason"]["code"] == "ambiguous_method_call" for edge in uncertain))

    def test_cli_applies_explicit_overlay_to_uncertain_edges(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    @app.get('/')
                    def home():
                        process()
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "one.py").write_text("def process():\n    pass\n", encoding="utf-8")
            (root / "two.py").write_text("def process():\n    pass\n", encoding="utf-8")
            initial_out = root / "initial.json"
            overlay_path = root / "overlay.json"
            final_out = root / "final.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(initial_out)],
                check=True,
                capture_output=True,
                text=True,
            )
            initial_graph = json.loads(initial_out.read_text(encoding="utf-8"))
            edge_id = next(edge["id"] for edge in initial_graph["edges"] if edge["certainty"] == "uncertain")
            overlay_path.write_text(json.dumps({"edge_resolutions": [{"edge_id": edge_id, "certainty": "rejected"}]}), encoding="utf-8")

            subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "avt_analyzer.cli",
                    "analyze",
                    str(root),
                    "--no-timestamp",
                    "--out",
                    str(final_out),
                    "--overlay",
                    str(overlay_path),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            final_graph = json.loads(final_out.read_text(encoding="utf-8"))

        resolved = next(edge for edge in final_graph["edges"] if edge["id"] == edge_id)
        self.assertEqual(resolved["certainty"], "rejected")
        self.assertEqual(resolved["evidence"]["reason"]["code"], "overlay_resolution")

    def test_cli_applies_default_project_overlay(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    @app.get('/')
                    def home():
                        process()
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "one.py").write_text("def process():\n    pass\n", encoding="utf-8")
            (root / "two.py").write_text("def process():\n    pass\n", encoding="utf-8")
            initial_out = root / "initial.json"
            final_out = root / "final.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(initial_out)],
                check=True,
                capture_output=True,
                text=True,
            )
            initial_graph = json.loads(initial_out.read_text(encoding="utf-8"))
            edge_id = next(edge["id"] for edge in initial_graph["edges"] if edge["certainty"] == "uncertain")
            (root / ".avt").mkdir()
            (root / ".avt" / "overlay.json").write_text(
                json.dumps({"edge_resolutions": [{"edge_id": edge_id, "certainty": "confirmed"}]}),
                encoding="utf-8",
            )

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(final_out)],
                check=True,
                capture_output=True,
                text=True,
            )
            final_graph = json.loads(final_out.read_text(encoding="utf-8"))

        resolved = next(edge for edge in final_graph["edges"] if edge["id"] == edge_id)
        self.assertEqual(resolved["certainty"], "confirmed")
        self.assertEqual(resolved["evidence"]["reason"]["code"], "overlay_resolution")

    def test_cli_emits_external_interaction_edges(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    import os
                    import subprocess
                    import requests as rq
                    import sqlite3
                    from pathlib import Path

                    @app.get('/')
                    def home():
                        open('data.txt')
                        Path('data.txt').read_text()
                        subprocess.run(['echo', 'ok'])
                        os.system('echo ok')
                        rq.get('https://example.com')
                        sqlite3.connect('db.sqlite')
                        page.save()
                        Page.objects.filter(published=True)
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        external_nodes = [node for node in graph["nodes"] if node["kind"] == "external"]
        external_edges = [edge for edge in graph["edges"] if edge["kind"] == "external_interaction"]
        reason_codes = {edge["evidence"]["reason"]["code"] for edge in external_edges}
        labels = {node["label"].split(":", 1)[0] for node in external_nodes}

        self.assertGreaterEqual(labels, {"filesystem", "subprocess", "network", "database"})
        self.assertGreaterEqual(
            reason_codes,
            {"filesystem_call", "filesystem_method_call", "subprocess_call", "network_call", "database_call", "orm_method_call"},
        )
        self.assertEqual(set(graph["flows"][0]["edge_ids"]), {edge["id"] for edge in external_edges})
        self.assertTrue(set(graph["flows"][0]["node_ids"]).issuperset({node["id"] for node in external_nodes}))

    def test_cli_safety_warnings_redact_secret_literals_and_include_env_names(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            secret_value = "super-secret-token-value"
            docstring_secret = "docstring-secret-value"
            (root / "app.py").write_text(
                textwrap.dedent(
                    f'''
                    import os

                    """Module docstring mentions {docstring_secret} but is ignored."""

                    @app.get('/')
                    def home():
                        """Function docstring mentions {docstring_secret} but is ignored."""
                        api_token = "{secret_value}"
                        settings = {{"password": "{secret_value}"}}
                        os.getenv("DATABASE_URL")
                        os.environ["API_TOKEN"]
                    '''
                ).lstrip(),
                encoding="utf-8",
            )
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            raw_graph = out.read_text(encoding="utf-8")
            graph = json.loads(raw_graph)

        warning_codes = {warning["code"] for warning in graph["warnings"]}
        messages = {warning["message"] for warning in graph["warnings"]}

        self.assertIn("secret_literal_redacted", warning_codes)
        self.assertIn("env_var_reference", warning_codes)
        self.assertIn("Environment variable referenced: DATABASE_URL", messages)
        self.assertIn("Environment variable referenced: API_TOKEN", messages)
        self.assertNotIn(secret_value, raw_graph)
        self.assertNotIn(docstring_secret, raw_graph)

    def test_cli_emits_uncertain_edges_for_ambiguous_local_names(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    @app.get('/')
                    def home():
                        process()
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            (root / "one.py").write_text("def process():\n    pass\n", encoding="utf-8")
            (root / "two.py").write_text("def process():\n    pass\n", encoding="utf-8")
            out = root / "graph.json"

            subprocess.run(
                [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                check=True,
                capture_output=True,
                text=True,
            )
            graph = json.loads(out.read_text(encoding="utf-8"))

        uncertain = [edge for edge in graph["edges"] if edge["certainty"] == "uncertain"]
        self.assertEqual(len(uncertain), 2)
        self.assertTrue(all(edge["evidence"]["reason"]["code"] == "ambiguous_name_call" for edge in uncertain))


if __name__ == "__main__":
    unittest.main()
