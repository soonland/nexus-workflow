# Declared Start Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A workflow declares its expected start inputs in the BPMN file; the console Start dialog pre-fills the Variables JSON box with a template and lists a hint per input.

**Architecture:** The core parser reads `<nexus:input>` elements from the start event's `extensionElements` into an optional `inputs` field on `StartEventElement`. The app already stores whole elements as JSONB and returns them from `GET /definitions/:id`, so it only needs a regression test. The console fetches the definition when the dialog opens and builds the template with a small pure helper.

**Tech Stack:** TypeScript, fast-xml-parser (core), Hono + Postgres/vitest (app), React + MUI + vitest/Testing Library (console), pnpm.

**Spec:** `docs/superpowers/specs/2026-10-18-start-inputs-design.md`

## Global Constraints

- Declaration: `<nexus:input name="..." hint="..." type="string|number|boolean"/>` inside the start event's `<bpmn:extensionElements>`. `name` required; `hint`, `type` optional; unknown `type` is treated as `string`.
- Template placeholders by type: `string` → `""`, `number` → `0`, `boolean` → `false`.
- Invalid `name` (empty, or not matching `^[A-Za-z_$][A-Za-z0-9_$]*$`) and duplicate names (first wins) are skipped **silently**. Never push to the parser's `errors` list (any error makes the definition non-deployable).
- No new endpoint, no DB migration, no server-side or client-side validation of submitted variables.
- A definition without inputs, or a failed definition fetch, leaves the Start dialog exactly as today (including the helper text `The workflow starts with these, e.g. {"amount": 120}`).
- Core stays pure (no I/O). The console must not import `nexus-workflow-core`.
- Run `pnpm lint` and `pnpm test` in each package changed before committing. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not touch `.github/workflows/`.
- One branch `feat/start-inputs-454` off `main`, one PR, do not merge.

## Review Focus

- Input named `__proto__` or `constructor`: the template must still contain it as an own key (build with `Object.fromEntries`, never `obj[name] =`). (Task 3)
- Fetch finishes after the person already typed in the Variables box: their text must not be overwritten. (Task 3)
- Dialog closed, or switched to another definition, before the fetch resolves: a late response must not fill the wrong dialog. (Task 3)
- `startEventId` points at no element, or the start event has no `inputs`: dialog behaves as today. (Task 3)
- `<nexus:input>` inside another element's `extensionElements` (e.g. a user task) is ignored; a single `<nexus:input>` (not an array in the raw XML) still parses. (Task 1)
- A hint containing `<b>` or very long text renders as plain text. (Task 3)

---

### Task 1: Parse start inputs in core

**Files:**
- Modify: `nexus-workflow-core/src/model/types.ts` (add `ProcessInput`, extend `StartEventElement` near line 248)
- Modify: `nexus-workflow-core/src/parser/BpmnXmlParser.ts` (`ARRAY_ELEMENTS` near line 38, `parseStartEvent` near line 189)
- Create: `nexus-workflow-core/tests/fixtures/bpmn/start-inputs.bpmn`
- Test: `nexus-workflow-core/src/parser/BpmnXmlParser.test.ts` (uses `loadFixture(name)`)

**Interfaces:**
- Produces: `export interface ProcessInput { name: string; hint?: string; type?: 'string' | 'number' | 'boolean' }` and `StartEventElement.inputs?: ProcessInput[]` (exported through `model/types.ts`, already re-exported by `src/index.ts`). `inputs` is absent, not `[]`, when nothing valid is declared. `type` is set only when the attribute is one of the three allowed values; otherwise omitted (consumers treat missing as `string`).

- [ ] **Step 1: Create the fixture** `start-inputs.bpmn`: a process with a start event whose `extensionElements` has `nexus:input` entries `title` (hint "What is being requested"), `amount` (hint "Total in euros", type `number`), `urgent` (type `boolean`, no hint), `weird` (type `date`), plus invalid ones (`name="1bad"`, `name=""`, a duplicate `title` with a different hint), and a user task whose own `extensionElements` contains a `nexus:input name="ignored"`. Declare `xmlns:nexus="http://nexus-workflow/schema"`. Follow the layout of `simple-sequence.bpmn`.
- [ ] **Step 2: Write failing tests** in `BpmnXmlParser.test.ts`: `describe('start inputs')` with `parses declared inputs in order` (start event `inputs` equals `[{name:'title',hint:'What is being requested'},{name:'amount',hint:'Total in euros',type:'number'},{name:'urgent',type:'boolean'},{name:'weird'}]`), `skips invalid and duplicate names without errors` (`result.errors` is `[]` and `isDeployable` is true), `ignores inputs on other elements` (no `ignored` anywhere), `parses a single input` (inline XML with one `nexus:input`), and `leaves inputs undefined when none are declared` (`simple-sequence.bpmn` start event has no `inputs` key).
- [ ] **Step 3: Run** `pnpm test -- BpmnXmlParser` in `nexus-workflow-core`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement.** Add `'input'` to `ARRAY_ELEMENTS`. In `parseStartEvent`, add a helper `parseInputs(raw: Record<string, unknown>): ProcessInput[] | undefined` that reads `raw.extensionElements` (object) → `input` (array) and applies the Global Constraints rules; spread `inputs` into the element only when non-empty.
- [ ] **Step 5: Run** `pnpm lint && pnpm test` in `nexus-workflow-core`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(core): parse declared start inputs from the start event`.

### Task 2: Prove inputs survive deploy and read-back in the app

**Files:**
- Test: `nexus-workflow-app/src/http/definitions.test.ts` (follow its existing setup for deploying XML and calling `GET /definitions/:id`)
- Modify only if the test fails: `nexus-workflow-app/src/db/PostgresStateStore.ts` (`reviveDefinition`, line 45; elements are stored whole, so no change is expected)

**Interfaces:**
- Consumes: Task 1's `StartEventElement.inputs`.
- Produces: `GET /definitions/:id` returns `elements[]` where the element with `id === startEventId` carries `inputs`.

- [ ] **Step 1: Write failing test** `returns declared start inputs on GET /definitions/:id`: POST BPMN XML containing a start event with `nexus:input name="amount" type="number" hint="Total in euros"`, then GET `/definitions/<id>` and assert the start event element's `inputs` equals `[{name:'amount',hint:'Total in euros',type:'number'}]`. Add `older definitions without inputs still load`: deploy `simple-sequence`-style XML with no inputs and assert the start event has no `inputs` key.
- [ ] **Step 2: Build core** (`pnpm build` in `nexus-workflow-core`; the app tests read its `dist`), then run the file with `pnpm test -- definitions` in `nexus-workflow-app`. Expected: PASS if nothing drops the field (no code change needed), otherwise FAIL and fix at the dropping site.
- [ ] **Step 3: Run** `pnpm lint && pnpm test` in `nexus-workflow-app` (Postgres must be reachable; see the app's CLAUDE.md). Note: `openapi.yaml` does not describe `/definitions`, so it is intentionally not changed.
- [ ] **Step 4: Commit** `test(app): start inputs survive deploy and read-back`.

### Task 3: Template and hints in the console Start dialog

**Files:**
- Modify: `nexus-workflow-console/src/api/types.ts` (add `StartInput`, `DefinitionDetail`)
- Modify: `nexus-workflow-console/src/api/client.ts` (interface near line 298, implementation near line 366)
- Modify: `nexus-workflow-console/src/test/fakeApi.ts` (add `getDefinition` mock near line 124)
- Create: `nexus-workflow-console/src/startTemplate.ts`, `nexus-workflow-console/src/startTemplate.test.ts`
- Modify: `nexus-workflow-console/src/components/StartInstanceDialog.tsx`
- Test: `nexus-workflow-console/src/components/StartInstanceDialog.test.tsx`

**Interfaces:**
- Produces in `types.ts`: `interface StartInput { name: string; hint?: string; type?: 'string' | 'number' | 'boolean' }`; `interface DefinitionDetail { id: string; version: number; startEventId: string; elements: Array<{ id: string; type: string; inputs?: StartInput[] }> }`.
- Produces on `TenantApi`: `getDefinition(id: string): Promise<DefinitionDetail>` calling `GET /definitions/${encodeURIComponent(id)}`.
- Produces in `startTemplate.ts`: `startInputsOf(definition: DefinitionDetail): StartInput[]` (inputs of the element whose `id === startEventId`, `[]` if none or element missing) and `buildStartTemplate(inputs: StartInput[]): string` (pretty-printed JSON with 2-space indent, keys in declared order, placeholders per Global Constraints, `''` for an empty list).

- [ ] **Step 1: Write failing helper tests** in `startTemplate.test.ts`: `startInputsOf` returns the start event's inputs, `[]` when `startEventId` matches no element, `[]` when no inputs. `buildStartTemplate` returns `{\n  "title": "",\n  "amount": 0,\n  "urgent": false\n}` for string/number/boolean; treats a missing type as string; returns `''` for `[]`; keeps `__proto__` as an own key (`Object.keys(JSON.parse(out))` contains `'__proto__'`).
- [ ] **Step 2: Run** `pnpm test -- startTemplate` → FAIL. **Implement** both functions (use `Object.fromEntries`). Run → PASS.
- [ ] **Step 3: Add the API type and client method**, and `getDefinition: vi.fn().mockResolvedValue({ id: 'd', version: 1, startEventId: 's', elements: [] })` to `fakeApi.ts`.
- [ ] **Step 4: Write failing dialog tests** in `StartInstanceDialog.test.tsx` (follow its existing render helper): `pre-fills the template and lists hints` (declared `title` w/ hint, `amount` number: the Variables field value equals the template; text `title: What is being requested` is shown; the old `e.g. {"amount": 120}` helper text is gone); `keeps today's behaviour without inputs` (empty field, old helper text shown); `keeps today's behaviour when the fetch fails` (rejected `getDefinition`, no error alert); `does not overwrite what the person already typed` (type into the field, then resolve the fetch → value unchanged); `ignores a late response for another definition` (open with definition A, switch the prop to B, resolve A last → B's field is not filled with A's template); `renders hints as plain text` (hint `<b>x</b>` appears literally). Submitting still sends the edited JSON through `api.startInstance` (existing test stays green).
- [ ] **Step 5: Run** `pnpm test -- StartInstanceDialog` → new tests FAIL.
- [ ] **Step 6: Implement in `StartInstanceDialog.tsx`:** a `useEffect` keyed on `definition?.id` that calls `api.getDefinition` with a cancelled flag (ignore results after cleanup); store `inputs` in state (`[]` on failure or no definition, reset on close); when the result has inputs and the Variables field is still untouched (track with a `variablesTouched` ref/state set in `onChange`, cleared in `reset`), set the field to `buildStartTemplate(inputs)`. Render a `Typography variant="body2"` list of `name: hint` (name alone without hint) under the field, and use the old helper text only when `inputs.length === 0`.
- [ ] **Step 7: Run** `pnpm lint && pnpm test && pnpm exec tsc --noEmit` in `nexus-workflow-console`. Expected: all pass.
- [ ] **Step 8: Commit** `feat(console): pre-fill the Start dialog from declared start inputs`.

### Task 4: Example and PR

**Files:**
- Modify (best effort, directory is untracked in the maintainer's checkout; skip if absent from git): `nexus-workflow-app/examples/review-request.bpmn`

- [ ] **Step 1:** If `nexus-workflow-app/examples/review-request.bpmn` is tracked, add `xmlns:nexus="http://nexus-workflow/schema"` and declare `title` and `amount` (type `number`) on its start event; otherwise skip this task's example change.
- [ ] **Step 2:** Push `feat/start-inputs-454` (`git push -u origin feat/start-inputs-454`) and open a PR to `main` referencing #454, with the PR body ending `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge.
