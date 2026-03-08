# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This monorepo contains two projects with a strict one-way dependency:

```
nexus-workflow/
├── nexus-workflow-core/   # pure TS engine library — no I/O deps
└── nexus-workflow-app/    # host application — HTTP, DB, UI (not yet scaffolded)
```

`nexus-workflow-app` depends on `nexus-workflow-core`. The core library never depends on the app.

## What This System Does

A BPMN 2.0 workflow engine. `nexus-workflow-core` is the brain — it parses BPMN process definitions and executes them using a token-passing model. `nexus-workflow-app` will expose it via HTTP, persist state to PostgreSQL, and provide a UI.

## Project-Level Guidance

Each project has its own `CLAUDE.md` with commands, module structure, and conventions specific to that project. Start there when working inside a project directory.

## Key Cross-Project Decisions

- The engine is a **pure function**: `execute(command, state) → (newState, events[])`. No side effects inside the engine.
- All I/O in `nexus-workflow-core` goes through injected interfaces (`StateStore`, `EventBus`, `Scheduler`). The app provides concrete implementations.
- In-memory adapter implementations live in `nexus-workflow-core` and are used directly in tests — no database needed to test engine logic.
- One atomic write transaction per engine execution cycle.
