# Produce static graph JSON before adding an API

Phase 1 will prioritize a CLI analyzer that writes an Execution Flow Graph JSON file instead of starting with a backend `/analyze` API. This deviates from the original web-service plan, but keeps the first restart focused on local analysis correctness, deterministic output, and a static viewer; the analyzer will still be packaged as a reusable library so a FastAPI wrapper can be added later without reshaping the core engine.
