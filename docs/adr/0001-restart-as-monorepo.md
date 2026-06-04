# Restart as a monorepo

AVT is restarting as a monorepo with `packages/analyzer` for the Python analysis engine, `apps/viewer` for the static web viewer, and `spikes/visualization-libraries` for comparing graph visualization libraries. This shape is heavier than a single package, but it keeps the CLI analyzer, reusable analysis library, viewer, and decision spikes separate while preserving a path to a later API wrapper and additional language analyzers.
