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
A behavior path through a single repository, starting from an entrypoint and continuing through the meaningful calls, branches, and outcomes that explain how that behavior works.
_Avoid_: Raw call graph, file map, system map

**Documentation Aid**:
A later product capability that helps improve documentation using insights discovered by the tool.
_Avoid_: MVP documentation generation

## Example dialogue

Developer: “I need to understand where this project starts and how its pieces connect.”
Domain expert: “Use the Understanding Aid first; Documentation Aid comes later after the tool can produce trustworthy analysis.”
