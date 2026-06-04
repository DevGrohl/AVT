# Architecture Visualizer Tool

Architecture Visualizer Tool helps developers understand unfamiliar software projects and systems by revealing their structure and relationships.

## Language

**Developer**:
A person trying to understand an unfamiliar project or broader software system.
_Avoid_: Architect, beta user, end user

**Understanding Aid**:
The primary product capability: helping a Developer explore what exists in a project or system and how parts relate, especially by following Execution Flows.
_Avoid_: Documentation generator, documentation updater

**Execution Flow**:
A behavior path through a single repository, starting from an Entry Point and continuing through the meaningful calls, branches, External Interactions, and outcomes that explain how that behavior works.
_Avoid_: Raw call graph, file map, system map

**External Interaction**:
A point where an Execution Flow communicates outside the analyzed code path, such as HTTP, database, or filesystem access.
_Avoid_: Integration, dependency, side effect

**Uncertain Edge**:
A possible relationship in an Execution Flow that the tool cannot prove from static analysis alone. A Developer may resolve it manually or ignore it until higher-confidence analysis is available.
_Avoid_: Guess, hallucination, inferred fact

**Analysis Overlay**:
Project-local knowledge that records a Developer's confirmations or rejections of Uncertain Edges so future analyses can reuse those decisions.
_Avoid_: Global training data, source code modification, temporary UI state

**Entry Point**:
A place where a Developer can begin exploring an Execution Flow. Early Entry Points include web route handlers, CLI commands, and executable scripts.
_Avoid_: Entrypoint, start file, root node

**Documentation Aid**:
A later product capability that helps improve documentation using insights discovered by the tool.
_Avoid_: MVP documentation generation

## Example dialogue

Developer: “I need to understand where this project starts and how its pieces connect.”
Domain expert: “Use the Understanding Aid first; Documentation Aid comes later after the tool can produce trustworthy analysis.”
