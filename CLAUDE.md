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

## GitHub Actions Behavior

This repo runs two Claude workflows. Rules below apply to both.

### Workflow: Automatic PR Review (`claude-code-review.yml`)

Triggers automatically on every PR (opened, updated, ready for review, reopened).
Uses the `code-review` plugin to post inline review comments.

- **Scope:** read-only (`contents: read`, `pull-requests: read`). Never commits or pushes.
- **Goal:** flag bugs, security issues, and deviations from project conventions.
- **Note:** only fires for PRs from the repo owner (`author_association == 'OWNER'`).

### Workflow: PR / Issue Assistant (`claude.yml`)

Triggers when a commenter writes `@claude` in a PR comment, review, or issue body.
Guarded by `author_association == 'OWNER'` — only the repo owner can invoke it.

- **Scope:** read-only by default (`contents: read`). Do not assume write access is available.
- **If asked to make a change:** post a clear plan as a comment first. Only act if the request is unambiguous and safe.
- **If the request is unclear or risky:** reply asking for clarification instead of guessing.

### What Claude may do (both workflows)
- Read files, analyze code, and post PR review comments or issue replies.
- Open pull requests targeting `main` from a dedicated branch (when write access is granted).
- Commit fixes (lint, formatting, small bugs) on the current PR branch (when write access is granted).
- Add labels or comments to issues and PRs.

### What Claude must never do
- Push directly to `main` or any protected branch.
- Modify `.github/workflows/` files.
- Commit `.env` files, secrets, or credentials of any kind.
- Auto-merge a pull request — always leave merging to a human.
- Force-push or rebase published commits.
- Skip hooks (`--no-verify`) or bypass linting.

### Code quality gates
- Run `npm run lint` in every affected project before committing.
- If tests exist for the changed project, run them and do not commit if they fail.
- Follow the project-specific `CLAUDE.md` conventions for the package being modified.

### Scope discipline
- Only touch files directly related to the task described in the trigger (issue body, PR comment, etc.).
- Do not refactor, rename, or "clean up" code outside the stated scope.
- If the required change is unclear or risky, post a comment asking for clarification instead of guessing.
