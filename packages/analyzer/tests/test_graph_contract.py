from __future__ import annotations

import json
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any


class GraphContractTests(unittest.TestCase):
    def test_sample_graph_fixture_matches_contract(self) -> None:
        graph = json.loads(Path("packages/analyzer/tests/fixtures/sample_graph.json").read_text(encoding="utf-8"))
        _assert_graph_contract(self, graph)

    def test_cli_no_timestamp_output_is_reproducible(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    import requests

                    @app.get('/')
                    def home():
                        requests.get('https://example.com')
                        return None
                    """
                ).lstrip(),
                encoding="utf-8",
            )
            first = root / "first.json"
            second = root / "second.json"

            for out in (first, second):
                subprocess.run(
                    [sys.executable, "-m", "avt_analyzer.cli", "analyze", str(root), "--no-timestamp", "--out", str(out)],
                    check=True,
                    capture_output=True,
                    text=True,
                )

            first_text = first.read_text(encoding="utf-8")
            second_text = second.read_text(encoding="utf-8")
            graph = json.loads(first_text)

        self.assertEqual(first_text, second_text)
        self.assertNotIn("generated_at", graph["metadata"])
        _assert_graph_contract(self, graph)

    def test_cli_generated_graph_references_existing_ids(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "app.py").write_text(
                textwrap.dedent(
                    """
                    @app.get('/')
                    def home():
                        helper()

                    def helper():
                        return None
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

        _assert_graph_contract(self, graph)


def _assert_graph_contract(testcase: unittest.TestCase, graph: dict[str, Any]) -> None:
    testcase.assertEqual(set(graph), {"metadata", "entry_points", "flows", "nodes", "edges", "markers", "warnings"})
    testcase.assertIn("schema_version", graph["metadata"])
    testcase.assertIn("analyzer_version", graph["metadata"])
    testcase.assertIn("project_name", graph["metadata"])

    node_ids = _assert_unique_ids(testcase, graph["nodes"])
    edge_ids = _assert_unique_ids(testcase, graph["edges"])
    marker_ids = _assert_unique_ids(testcase, graph["markers"])
    entry_ids = _assert_unique_ids(testcase, graph["entry_points"])

    testcase.assertEqual([node["id"] for node in graph["nodes"]], sorted(node_ids))
    testcase.assertEqual([edge["id"] for edge in graph["edges"]], sorted(edge_ids))
    testcase.assertEqual([marker["id"] for marker in graph["markers"]], sorted(marker_ids))
    testcase.assertEqual([entry["id"] for entry in graph["entry_points"]], sorted(entry_ids))

    for node in graph["nodes"]:
        testcase.assertIn(node["kind"], {"project", "module", "class", "function", "method", "external"})
        testcase.assertIn("label", node)
        if "parent_id" in node:
            testcase.assertIn(node["parent_id"], node_ids)

    for edge in graph["edges"]:
        testcase.assertIn(edge["kind"], {"call", "await", "external_interaction", "inheritance", "override"})
        testcase.assertIn(edge["certainty"], {"confirmed", "uncertain", "rejected"})
        testcase.assertIn(edge["source"], node_ids)
        testcase.assertIn(edge["target"], node_ids)
        _assert_evidence_contract(testcase, edge["evidence"])

    for marker in graph["markers"]:
        testcase.assertIn(marker["kind"], {"conditional", "raise", "return", "async", "loop"})
        testcase.assertTrue("node_id" in marker or "edge_id" in marker)
        if "node_id" in marker:
            testcase.assertIn(marker["node_id"], node_ids)
        if "edge_id" in marker:
            testcase.assertIn(marker["edge_id"], edge_ids)
        _assert_evidence_contract(testcase, marker["evidence"])

    for entry in graph["entry_points"]:
        testcase.assertIn(entry["kind"], {"web_route", "framework_hook", "cli_command", "script", "manual"})
        testcase.assertIn(entry["node_id"], node_ids)
        if "route_path" in entry:
            testcase.assertIsInstance(entry["route_path"], str)
        if "http_methods" in entry:
            testcase.assertIsInstance(entry["http_methods"], list)
            testcase.assertTrue(all(isinstance(method, str) for method in entry["http_methods"]))
        _assert_evidence_contract(testcase, entry["evidence"])

    for flow in graph["flows"]:
        testcase.assertIn(flow["entry_point_id"], entry_ids)
        testcase.assertEqual(flow["node_ids"], sorted(flow["node_ids"]))
        testcase.assertEqual(flow["edge_ids"], sorted(flow["edge_ids"]))
        testcase.assertEqual(flow["marker_ids"], sorted(flow["marker_ids"]))
        testcase.assertTrue(set(flow["node_ids"]).issubset(node_ids))
        testcase.assertTrue(set(flow["edge_ids"]).issubset(edge_ids))
        testcase.assertTrue(set(flow["marker_ids"]).issubset(marker_ids))

    for warning in graph["warnings"]:
        testcase.assertIn("code", warning)
        testcase.assertIn("message", warning)
        if "location" in warning:
            _assert_location_contract(testcase, warning["location"])


def _assert_unique_ids(testcase: unittest.TestCase, items: list[dict[str, Any]]) -> set[str]:
    ids = [item["id"] for item in items]
    testcase.assertEqual(len(ids), len(set(ids)))
    return set(ids)


def _assert_evidence_contract(testcase: unittest.TestCase, evidence: dict[str, Any]) -> None:
    testcase.assertIn("location", evidence)
    testcase.assertIn("reason", evidence)
    _assert_location_contract(testcase, evidence["location"])
    testcase.assertIn("code", evidence["reason"])
    testcase.assertIn("label", evidence["reason"])


def _assert_location_contract(testcase: unittest.TestCase, location: dict[str, Any]) -> None:
    testcase.assertIn("path", location)
    testcase.assertIn("line", location)
    testcase.assertIn("column", location)
    testcase.assertIsInstance(location["path"], str)
    testcase.assertIsInstance(location["line"], int)
    testcase.assertIsInstance(location["column"], int)


if __name__ == "__main__":
    unittest.main()
