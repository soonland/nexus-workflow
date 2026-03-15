# Feature Implementation Skill (GitHub Actions)

Given a GitHub Issue containing a feature spec (created by `/feature-spec`), implement the feature end-to-end: fetch the spec, explore the codebase, post the plan as an issue comment, then implement and open a PR.

> **Context:** This skill runs inside a GitHub Actions runner (ubuntu-latest). There is no interactive session — the `@claude implement` trigger comment is the confirmation to proceed. Skip any step that requires a running dev server or interactive input.

---

## Pre-flight

1. Fetch the issue:
```bash
gh issue view <number> --repo <owner/repo> --json title,body,labels,number
```
2. If the issue does NOT have the `feature-spec` label, post a warning comment and stop:
```bash
gh issue comment <number> --repo <owner/repo> --body "⚠️ This issue does not have the \`feature-spec\` label. Stopping — re-trigger with a confirmed feature spec issue."
```
3. Parse the spec sections: Scope, Requirements, Decisions, Out of Scope.

---

## Implementation Protocol

Execute in this order. Complete each step fully before moving to the next.

### Step 0 — Branch & Mark In Progress

1. Move the issue to **In Progress** in the GitHub project:
```bash
ITEM_ID=$(gh project item-list 3 --owner soonland --format json \
  | jq -r '.items[] | select(.content.number == <issue-number>) | .id')

gh project item-edit \
  --project-id PVT_kwHOBJBtu84BRfyS \
  --id "$ITEM_ID" \
  --field-id PVTSSF_lAHOBJBtu84BRfySzg_TtGM \
  --single-select-option-id b5487ff6
```

2. Create and push a feature branch (3–5 word kebab-case slug):
```bash
git checkout -b feat/<kebab-case-slug>
git push -u origin feat/<kebab-case-slug>
```
Never implement directly on `main`.

### Step 1 — Explore

Before writing a single line:
- Identify which files will need to change based on the spec's Scope field.
- Read every file you plan to modify — never edit blind.
- Note existing patterns (naming, imports, component structure) and follow them exactly.
- Check for existing tests covering the areas you will touch.

### Step 2 — Post the Plan

Post the plan as a comment on the issue, then immediately proceed to Step 3 (the trigger comment is the confirmation):

```bash
gh issue comment <issue-number> --repo <owner/repo> --body "$(cat <<'EOF'
## Implementation Plan

**FEATURE:** <title>

**CHANGES:**
1. `<file path>` — <what changes and why>
2. `<file path>` — <what changes and why>

**DB CHANGES:** <list any schema/migration changes, or "none">
**NEW FILES:** <list new files, or "none">
**TESTS:** <list test files to add/update>

**RISKS / ASSUMPTIONS:**
- <any assumption worth flagging>

## Progress

- [ ] Step 3 — Implement
- [ ] Step 4 — Tests
- [ ] Step 5 — Breaking Change Check
- [ ] Step 6 — Lint & Typecheck
- [ ] Step 7 — PR created

🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

After each step completes, edit the comment to check off the corresponding box:
```bash
COMMENT_ID=$(gh issue view <issue-number> --repo <owner/repo> --json comments \
  | jq -r '.comments | last | .id // empty')

gh api repos/<owner/repo>/issues/comments/$COMMENT_ID \
  --method PATCH \
  --field body="<updated body with checked boxes>"
```

### Step 3 — Implement

For each file:
- Read the full file before modifying it.
- Make the minimum change required — do not refactor surrounding code.
- Follow existing conventions exactly (naming, imports, formatting, lint rules).

Before every commit, run the test suite in the affected package:
```bash
# Run from within the affected package directory, e.g.:
cd nexus-erp && npm test
# or
cd nexus-workflow-core && npm test
```

If any existing tests break due to your changes, fix or update them **in the same commit** as the code change — never commit with a failing test suite.

Commit logical groups of changes using **Conventional Commits** format:
```
<type>(<scope>): <short description>

[optional body]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

| Type | When to use |
|---|---|
| `feat` | New capability visible to users |
| `fix` | Bug fix |
| `chore` | Build, deps, config — no production code change |
| `test` | Adding or updating tests |
| `refactor` | Code change with no behaviour change |
| `docs` | Documentation only |

Scope is the package name (e.g. `feat(nexus-erp): add theme switcher`). Never bundle unrelated changes in one commit.

Push after each commit:
```bash
git push
```

### Step 4 — Tests

Write unit tests for the feature:
- Test framework: Vitest (confirm via `package.json` in the affected package).
- Follow existing test file conventions — location, naming, import style.
- Cover: happy path, edge cases, and any branching logic introduced.
- Target **≥ 90% code coverage** on new code. Untestable edge cases may be skipped with a `// TODO: test` comment.
- Use the `vitest-unit-tester` agent for writing the tests.
- Run and confirm all tests pass:
```bash
cd <affected-package> && npm test
```

**A feature is not complete without passing tests at ≥ 90% coverage.**

### Step 5 — Breaking Change Check

Explicitly verify:
- Any interface, type, or component prop changed — find all call sites and confirm they compile.
- Any re-export or backward-compat shim added — confirm it is actually needed; remove if unused.
- If session/JWT fields were added or changed: document this as a known limitation in the PR.

### Step 6 — Lint & Typecheck Gate

```bash
# Lint the affected package (from its directory)
cd <affected-package> && npm run lint

# Typecheck the affected package
cd <affected-package> && npm run typecheck
```

- Fix all ESLint errors. Do not suppress with `// eslint-disable` unless genuinely inapplicable (explain why in a comment).
- Fix all TypeScript errors. Do not use `as any` or `@ts-ignore`.
- Re-run until both commands exit cleanly.

### Step 7 — PR

Create a pull request targeting `main`:

```bash
gh pr create \
  --title "feat: <feature name>" \
  --base main \
  --body "$(cat <<'EOF'
## Summary

**<Group 1 — e.g. DB & Auth>**
- <what changed and why>

**<Group 2 — e.g. UI>**
- <what changed and why>

Closes #<issue-number>

## Test plan
- [ ] Unit tests pass (≥ 90% coverage)
- [ ] Typecheck passes
- [ ] Lint passes

## Known limitations
<session sync issues, deferred metrics, or anything explicitly out of scope — omit section if none>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

Post a comment on the issue linking the PR:
```bash
gh issue comment <issue-number> --repo <owner/repo> --body "$(cat <<'EOF'
Implementation complete — PR: <pr-url>

- <one-line summary per concern group>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

Move the issue to **Waiting for Approval**:
```bash
ITEM_ID=$(gh project item-list 3 --owner soonland --format json \
  | jq -r '.items[] | select(.content.number == <issue-number>) | .id')

gh project item-edit \
  --project-id PVT_kwHOBJBtu84BRfyS \
  --id "$ITEM_ID" \
  --field-id PVTSSF_lAHOBJBtu84BRfySzg_TtGM \
  --single-select-option-id 5fc5aaa0
```

---

## Rules

- **Branch first.** Always create and push a `feat/<slug>` branch before any file changes. Never commit to `main`.
- **Minimum change principle.** Only touch what the spec requires. Do not clean up unrelated code, add extra abstractions, or implement nice-to-haves not listed as requirements.
- **Out of Scope is a hard boundary.** If a spec section says something is out of scope, do not implement it even if it seems easy.
- **Decisions are settled.** Do not re-open resolved decisions from the spec's Decisions table.
- **Read before editing.** Always read a file in full before modifying it.
- If the spec is ambiguous about a requirement, post a comment on the issue asking for clarification and stop — do not guess.

---

## Supported Scopes

| Scope | Where to look |
|---|---|
| `nexus-erp` UI | `nexus-erp/src/` — Next.js 15 app, MUI components, Auth.js, Prisma |
| `nexus-workflow-app` API | `nexus-workflow-app/src/` — Hono HTTP server, PostgreSQL |
| `nexus-workflow-core` engine | `nexus-workflow-core/src/` — pure TS, no I/O deps |
| cross-cutting | Changes span multiple projects — implement core first, then app, then UI |
