# Development Workflow

This project uses a set of Claude Code skills to manage the full feature lifecycle — from spec to shipped. This document explains how to use them.

---

## Overview

```
/feature-spec          →   /implement-feature   →   /changelog
Document the feature       Build it                  Summarise the release
     ↓                           ↓
GitHub Issue (Todo)        PR → merge → Done
```

---

## Skills

### `/feature-spec` — Document a feature

Use this before writing any code. It guides you through a structured conversation and publishes the result as a GitHub Issue.

**Invoke:** type `/feature-spec` in Claude Code.

**What it does:**
1. Asks about the feature, scope, users, and requester
2. Captures problem, goals, requirements, and resolves open questions
3. Creates a GitHub Issue with:
   - Label `feature-spec` + component label (`nexus-erp`, `nexus-workflow-app`, `nexus-workflow-core`, or `cross-cutting`)
   - Assignee set to the requester
   - Issue added to the project board as **Todo**

**Output:** a GitHub Issue URL.

---

### `/implement-feature <issue-number>` — Implement a feature

Use this to implement a feature that has a published spec issue. Pass the issue number as an argument.

**Invoke:** `/implement-feature 12`

**What it does (in order):**

| Step | Action |
|---|---|
| **0** | Issue → **In Progress**, assigned to `@me`, `feat/<slug>` branch created |
| **1** | Explores codebase — reads all files to be modified |
| **2** | Presents implementation plan — waits for your confirmation |
| **3** | Implements changes using Conventional Commits |
| **4** | Writes unit tests (≥ 90% coverage) |
| **5** | Breaking change check + session/JWT caveats |
| **6** | Smoke test checklist + success metric sign-off |
| **7** | Creates PR → Issue → **Waiting for Approval** |

**Never proceeds past Step 2 without your explicit confirmation.**

---

### `/changelog` — Generate a changelog entry

Use this before tagging a release.

**Invoke:** type `/changelog` in Claude Code.

**What it does:**
1. Asks for the new version number (follows semver)
2. Collects merged PRs and Conventional Commits since the last tag
3. Groups them into human-readable sections (Features, Bug Fixes, Improvements)
4. Shows you the entry for review before writing
5. Prepends it to `CHANGELOG.md`
6. Offers to create and push a git tag

---

## Conventions

### Branch naming

```
feat/<short-description>
```
Examples: `feat/theme-switcher`, `feat/employee-csv-export`

- Lowercase, hyphens only
- 3–5 words
- Always branch from `main`, never commit directly to `main`

### Commit messages — Conventional Commits

```
<type>(<scope>): <short description>
```

| Type | Use for |
|---|---|
| `feat` | New user-facing capability |
| `fix` | Bug fix |
| `chore` | Build, deps, config |
| `test` | Tests only |
| `refactor` | Code restructure, no behaviour change |
| `docs` | Documentation only |

**Scope** is optional but recommended — use the component name:
```
feat(nexus-erp): add theme switcher
fix(nexus-workflow-app): handle missing correlation key
chore: upgrade MUI to v8
```

---

## GitHub Project Board

Issues move through these statuses automatically as you work:

| Status | When |
|---|---|
| **Todo** | Issue created by `/feature-spec` |
| **In Progress** | `/implement-feature` started |
| **Waiting for Approval** | PR created |
| **Done** | PR merged (`Closes #N` in PR body handles this) |

---

## Full Example

```
# 1. Document the feature
/feature-spec
→ publishes Issue #12 as Todo

# 2. Implement it
/implement-feature 12
→ branch: feat/employee-csv-export
→ PR created, Issue #12 → Waiting for Approval

# 3. PR reviewed and merged on GitHub
→ Issue #12 automatically closed → Done

# 4. Before the next release
/changelog
→ CHANGELOG.md updated, git tag pushed
```
