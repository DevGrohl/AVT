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
        self.assertIn(("web_route", "app.py", "list_items"), entries)
        self.assertIn(("cli_command", "app.py", "cli"), entries)
        self.assertIn(("cli_command", "app.py", "main"), entries)
        self.assertIn(("script", "scripts/tool.py", "main"), entries)
        self.assertIn(("manual", "app.py", "list_items"), entries)

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
            {"filesystem_call", "filesystem_method_call", "subprocess_call", "network_call", "database_call"},
        )
        self.assertEqual(set(graph["flows"][0]["edge_ids"]), {edge["id"] for edge in external_edges})
        self.assertTrue(set(graph["flows"][0]["node_ids"]).issuperset({node["id"] for node in external_nodes}))

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
