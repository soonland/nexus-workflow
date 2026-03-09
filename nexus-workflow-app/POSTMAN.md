# Nexus Workflow — cURL Requests

Import these into Postman via **Import → Raw Text** (paste the curl command).

Base URL: `http://localhost:3000`

---

## 1. Health check

```bash
curl -s http://localhost:3000/health
```

---

## 2. Upload a process definition (BPMN XML)

The simplest deployable process: Start → Service Task → End.
The `http-call` handler is built-in and will auto-execute when the instance starts.

```bash
curl -s -X POST http://localhost:3000/definitions \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:nexus="http://nexus-workflow/extensions"
             targetNamespace="http://nexus-workflow">
  <process id="http-demo" name="HTTP Demo" isExecutable="true">
    <startEvent id="start">
      <outgoing>f1</outgoing>
    </startEvent>
    <serviceTask id="fetch" name="Fetch Data" nexus:type="http-call">
      <incoming>f1</incoming>
      <outgoing>f2</outgoing>
    </serviceTask>
    <endEvent id="end">
      <incoming>f2</incoming>
    </endEvent>
    <sequenceFlow id="f1" sourceRef="start" targetRef="fetch"/>
    <sequenceFlow id="f2" sourceRef="fetch" targetRef="end"/>
  </process>
</definitions>'
```

---

## 3. Upload a user-task process definition

Start → User Task (manual approval) → End.

```bash
curl -s -X POST http://localhost:3000/definitions \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://nexus-workflow">
  <process id="approval" name="Approval Process" isExecutable="true">
    <startEvent id="start">
      <outgoing>f1</outgoing>
    </startEvent>
    <userTask id="review" name="Review Request" assignee="manager">
      <incoming>f1</incoming>
      <outgoing>f2</outgoing>
    </userTask>
    <endEvent id="end">
      <incoming>f2</incoming>
    </endEvent>
    <sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
    <sequenceFlow id="f2" sourceRef="review" targetRef="end"/>
  </process>
</definitions>'
```

---

## 4. Upload a timer process definition

Start → 30-second timer → End.

```bash
curl -s -X POST http://localhost:3000/definitions \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://nexus-workflow">
  <process id="timer-demo" name="Timer Demo" isExecutable="true">
    <startEvent id="start">
      <outgoing>f1</outgoing>
    </startEvent>
    <intermediateCatchEvent id="wait">
      <incoming>f1</incoming>
      <outgoing>f2</outgoing>
      <timerEventDefinition>
        <timeDuration>PT30S</timeDuration>
      </timerEventDefinition>
    </intermediateCatchEvent>
    <endEvent id="end">
      <incoming>f2</incoming>
    </endEvent>
    <sequenceFlow id="f1" sourceRef="start" targetRef="wait"/>
    <sequenceFlow id="f2" sourceRef="wait" targetRef="end"/>
  </process>
</definitions>'
```

---

## 5. List all definitions

```bash
curl -s http://localhost:3000/definitions
```

Only deployable ones:

```bash
curl -s "http://localhost:3000/definitions?isDeployable=true"
```

---

## 6. Get a specific definition

```bash
curl -s http://localhost:3000/definitions/approval
```

---

## 7. Start a process instance (no variables)

```bash
curl -s -X POST http://localhost:3000/definitions/approval/instances \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## 8. Start a process instance (with variables)

```bash
curl -s -X POST http://localhost:3000/definitions/http-demo/instances \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "url": { "type": "string", "value": "https://httpbin.org/get" },
      "method": { "type": "string", "value": "GET" }
    },
    "businessKey": "demo-001"
  }'
```

---

## 9. Get instance details

Replace `INSTANCE_ID` with the `id` from the start response.

```bash
curl -s http://localhost:3000/instances/INSTANCE_ID
```

---

## 10. List all instances

```bash
curl -s http://localhost:3000/instances
```

Filter by status:

```bash
curl -s "http://localhost:3000/instances?status=active"
curl -s "http://localhost:3000/instances?status=completed"
curl -s "http://localhost:3000/instances?status=suspended"
```

Filter by definition:

```bash
curl -s "http://localhost:3000/instances?definitionId=approval"
```

Paginate:

```bash
curl -s "http://localhost:3000/instances?page=0&pageSize=10"
```

---

## 11. Complete a user task

Get the `tokenId` from the instance response (`tokens` array, find the one with `status: "waiting"`).

```bash
curl -s -X POST http://localhost:3000/instances/INSTANCE_ID/commands \
  -H "Content-Type: application/json" \
  -d '{
    "type": "CompleteUserTask",
    "tokenId": "TOKEN_ID",
    "completedBy": "manager",
    "outputVariables": {
      "approved": { "type": "boolean", "value": true }
    }
  }'
```

---

## 12. Suspend an instance

```bash
curl -s -X POST http://localhost:3000/instances/INSTANCE_ID/commands \
  -H "Content-Type: application/json" \
  -d '{ "type": "SuspendInstance" }'
```

---

## 13. Resume a suspended instance

```bash
curl -s -X POST http://localhost:3000/instances/INSTANCE_ID/commands \
  -H "Content-Type: application/json" \
  -d '{ "type": "ResumeInstance" }'
```

---

## 14. Cancel an instance (idempotent)

```bash
curl -s -X DELETE http://localhost:3000/instances/INSTANCE_ID
```

---

## 15. Deliver a message to an instance

For processes with a message catch event waiting on `"order-confirmed"`:

```bash
curl -s -X POST http://localhost:3000/instances/INSTANCE_ID/commands \
  -H "Content-Type: application/json" \
  -d '{
    "type": "DeliverMessage",
    "messageName": "order-confirmed",
    "variables": {
      "orderId": { "type": "string", "value": "ORD-999" }
    }
  }'
```

---

## 16. Broadcast a signal

Delivered to all active instances waiting on that signal name:

```bash
curl -s -X POST http://localhost:3000/instances/INSTANCE_ID/commands \
  -H "Content-Type: application/json" \
  -d '{
    "type": "BroadcastSignal",
    "signalName": "shutdown"
  }'
```

---

## Typical happy-path flow

```bash
# 1. Upload the approval definition (step 3 above)
# 2. Start an instance
curl -s -X POST http://localhost:3000/definitions/approval/instances \
  -H "Content-Type: application/json" \
  -d '{"variables": {"requestedBy": {"type": "string", "value": "alice"}}}'

# 3. Copy the instance id and token id from the response, then complete the task
curl -s -X POST http://localhost:3000/instances/INSTANCE_ID/commands \
  -H "Content-Type: application/json" \
  -d '{"type": "CompleteUserTask", "tokenId": "TOKEN_ID", "completedBy": "manager"}'

# 4. Verify it completed
curl -s http://localhost:3000/instances/INSTANCE_ID | python3 -m json.tool
```
