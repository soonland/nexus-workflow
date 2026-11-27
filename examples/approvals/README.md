# Approval requests: a minimal integration example

Someone submits a request, someone else approves or rejects it. The point is to show how an
application uses the workflow engine, in as little code as possible.

| In the application | In the engine |
|---|---|
| Submit a request | Start an instance of `approval-request`, with the fields as variables |
| Pending request | An open user task |
| Approve / reject | Complete the task with a `decision` variable |
| Final status | The instance is `completed`; read `decision` |

- `src/workflow.ts`: every call to the engine. **Start reading here.**
- `process/approval-request.bpmn`: the process.
- `src/web.ts`: the page and its two forms.

There is no database, no Redis and no login. It listens on `127.0.0.1` only; do not expose it.

## Run it

All commands from the repository root, with Docker running and the project installed
(`pnpm run init`).

```bash
nvm use
docker compose up -d

# Once (and again after the database is recreated): a tenant and a key for this app
pnpm --filter nexus-workflow-app tenant:provision approvals --name "Approvals example" \
  --role service --write-env ../examples/approvals/.env.local

pnpm --filter nexus-workflow-app dev          # terminal 1
pnpm --filter nexus-example-approvals dev     # terminal 2: http://localhost:3003
```

The process is deployed at startup if the engine does not have it yet. After editing the BPMN
file, upload the new version yourself (console, or `POST /definitions`).

Optional settings in `.env.local`: `WORKFLOW_API_URL` (default `http://localhost:3000`), `PORT`
(default `3003`).
