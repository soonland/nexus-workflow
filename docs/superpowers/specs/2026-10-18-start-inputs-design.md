# Declared start inputs for the Start dialog (#454, reduced scope)

## Why

Starting an instance manually means typing a JSON object into a blank box in the console. Nobody
remembers which variable names a given workflow expects, and nothing in the product says. The
person who asked for this wants one thing: **when I start a workflow, tell me which variables it
expects, with a hint for each, and give me a template to fill in.**

This replaces the original scope of #454 (schema-driven forms with a `nexus:form` format, field
types, server-side validation and a form renderer). That scope was judged too large for the actual
need. Real form controls are explicitly deferred; the design below leaves room to grow into them.

## Goals

- A workflow can declare, in its BPMN file, the inputs its start event expects: a name, an
  optional one-line hint, and an optional simple type.
- The Start dialog shows those inputs with their hints and pre-fills the Variables JSON box with a
  template of the names.
- A workflow that declares nothing behaves exactly as today.

## Non-goals

- No form controls (dropdowns, date pickers, checkboxes), no repeating groups.
- No validation of what is submitted, neither client-side nor server-side. Extra or missing
  variables are still accepted.
- No "required" flag.
- Not the Complete task dialog or the force-step dialogs; only the Start dialog.
- Not the workflow designer (#423). This only defines something the designer could later write.
- No new endpoint, no database migration.

## Anti-goals

- It must not stop anyone starting a workflow that declares no inputs, or starting with variables
  that differ from the template.
- A malformed declaration must never break deploying a definition.

## The declaration

On the process's start event, in `extensionElements`, using a `nexus` XML namespace:

```xml
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:nexus="http://nexus-workflow/schema" ...>
  <bpmn:process id="review-request" isExecutable="true">
    <bpmn:startEvent id="start" name="Request received">
      <bpmn:extensionElements>
        <nexus:input name="title"  hint="What is being requested" />
        <nexus:input name="amount" hint="Total in euros" type="number" />
      </bpmn:extensionElements>
      ...
```

- `name` (required): the variable name.
- `hint` (optional): one line shown to the person starting the workflow.
- `type` (optional): `string` (default), `number` or `boolean`. In this version it only decides
  the placeholder value in the template (`""`, `0`, `false`); it is not validated or enforced.
  Any other value is treated as `string`.

Only the start event the engine actually uses (the process's `startEventId`, the first start event)
is read. Start events inside sub-processes are ignored.

The namespace URI is a choice made in this design (my call); any stable URI works as long as it is
used consistently. The parser already strips namespace prefixes (`removeNSPrefix: true`), so the
element is read as `input` regardless of the prefix chosen.

## Parser and model (nexus-workflow-core)

- `StartEventElement` gains an optional `inputs?: { name: string; hint?: string; type?: 'string' |
  'number' | 'boolean' }[]`.
- The BPMN parser reads `extensionElements > input` on the start event.
- Malformed entries are skipped silently. Malformed means: missing/empty `name`, a `name` that is
  not a plain identifier (letters, digits, `_`, `$`, not starting with a digit), or a duplicate
  `name` (first wins). They must never be added to the parser's `errors` list, because any entry
  there makes the definition non-deployable (`isDeployable = errors.length === 0`). There is no
  non-fatal warnings channel today; adding one (parser result, app response, OpenAPI) is a separate
  change and out of scope. This is my call; a typo in a declaration therefore just means that
  input is missing from the template.
- Core stays pure and free of I/O; this is parsing plus a type, with unit tests alongside the
  existing parser tests and a new BPMN fixture.

## API (nexus-workflow-app)

`GET /definitions/:id` already returns the stored parsed definition, so `inputs` should flow
through with no route change: the store (`PostgresStateStore.getDefinition`) keeps the whole parsed
definition as JSON and revives it. The builder must confirm that `reviveDefinition` keeps the new
optional `inputs` field and that older stored definitions without it still load. No storage change
or migration is expected.
`GET /definitions/:id` and `POST /definitions/:id/instances` both use the latest version, so the
template always describes the version that will run. Definitions deployed before this change have
no `inputs` until they are redeployed; that is accepted. The OpenAPI file (`openapi.yaml`) is updated to describe the field.

## Console (nexus-workflow-console)

- The API client gains a call for the full definition (`GET /definitions/:id`); the console does
  not import core, so it declares a minimal local type for the part it reads.
- `StartInstanceDialog` fetches the definition when it opens. If the start event has inputs:
  - the Variables box is pre-filled with a JSON template, one key per input, in declared order,
    using the placeholder for its type;
  - the inputs are listed under the box as `name: hint` (name alone when there is no hint).
- The person can edit or replace the JSON freely. Submitting works exactly as today.
- If the fetch fails, or the definition declares no inputs, the dialog looks and behaves as it does
  now. A failed fetch is not shown as an error; the dialog just stays as it is.
- The existing helper text (`e.g. {"amount": 120}`) is kept only when there are no declared inputs.

## Example

`nexus-workflow-app/examples/review-request.bpmn` should declare `title` and `amount`. Note that
the `examples/` directory is untracked in the current working copy; the builder should create the
core test fixture independently and treat updating the example as best effort.

## Growing into #454 / #423 later

Adding a richer type, a `required` flag or choices later means adding optional attributes to
`input`. The designer (#423) would write the same element. Nothing here has to be undone.

## Left to the builder

- Exact TypeScript names and file layout, within existing conventions in each package.
- Wording of the parser warnings.
- How the hint list is laid out in the dialog.
- Test structure (follow each package's existing patterns; run `pnpm lint` and `pnpm test` in every
  package changed).

## Size

One PR touching core, app (OpenAPI and a persistence check) and console. Small.
