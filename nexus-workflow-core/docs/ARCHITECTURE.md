# nexus-workflow-core — Architecture

## 1. Two-Project Overview

The workflow engine is split across two projects with a strict dependency direction.

```mermaid
graph TD
    APP["nexus-workflow-app<br/>─────────────────<br/>HTTP API · PostgreSQL store<br/>WebSocket event bus · UI"]
    CORE["nexus-workflow-core<br/>─────────────────<br/>BPMN parser · Execution engine<br/>Gateway evaluators · In-memory adapters"]

    APP -->|"depends on / injects implementations into"| CORE

    subgraph External
        DB[(PostgreSQL)]
        WS[WebSocket clients]
        REDIS[(Redis)]
    end

    APP --- DB
    APP --- WS
    APP --- REDIS
```

> **Rule:** `nexus-workflow-core` never imports HTTP libraries, database drivers, or filesystem APIs. Every I/O operation is abstracted behind an injected interface.

---

## 2. Core Module Structure

```mermaid
graph LR
    subgraph nexus-workflow-core
        MODEL["model/<br/>types.ts · errors.ts"]
        IFACES["interfaces/<br/>StateStore · EventBus<br/>Scheduler · ServiceTaskHandler<br/>ExpressionEvaluator"]
        ADAPTERS["adapters/<br/>InMemoryStateStore<br/>InMemoryEventBus<br/>InMemoryScheduler"]
        PARSER["parser/<br/>BpmnXmlParser<br/>DefinitionBuilder<br/>ValidationRules"]
        ENGINE["engine/<br/>ExecutionEngine · TokenRouter<br/>StepRunner · GatewayEvaluator<br/>EventManager"]
        GW["gateways/<br/>ExclusiveGateway<br/>ParallelGateway<br/>InclusiveGateway"]
        TASKS["tasks/<br/>ServiceTask · UserTask<br/>ScriptTask · CallActivity"]
        EVENTS["events/<br/>StartEvent · EndEvent<br/>IntermediateCatch · BoundaryEvent"]
        EXPR["expression/<br/>FeelEvaluator · JsEvaluator"]
    end

    MODEL --> IFACES
    MODEL --> ADAPTERS
    MODEL --> ENGINE
    IFACES --> ADAPTERS
    IFACES --> ENGINE
    PARSER --> MODEL
    ENGINE --> GW
    ENGINE --> TASKS
    ENGINE --> EVENTS
    ENGINE --> EXPR
```

---

## 3. Execution Engine — Pure Function Model

The engine has **no side effects**. It is a pure transform of a command and current state into a new state and a list of events. Side effects (persistence, event emission) happen outside.

```mermaid
flowchart LR
    CMD["Command<br/>─────────<br/>StartProcess<br/>CompleteUserTask<br/>DeliverMessage<br/>FireTimer"]
    STATE_IN["Current State<br/>─────────────<br/>ProcessInstance<br/>Tokens<br/>VariableScopes<br/>GatewayJoinStates"]
    ENGINE(["ExecutionEngine<br/>execute()"])
    STATE_OUT["New State<br/>──────────<br/>Updated instance<br/>Updated tokens<br/>Updated scopes"]
    EVENTS["Events<br/>────────<br/>TokenMoved<br/>UserTaskCreated<br/>ProcessCompleted"]
    PERSIST[("StateStore<br/>(persist)")]
    BUS[("EventBus<br/>(emit)")]

    CMD --> ENGINE
    STATE_IN --> ENGINE
    ENGINE --> STATE_OUT
    ENGINE --> EVENTS
    STATE_OUT -->|"atomic transaction"| PERSIST
    EVENTS --> BUS
```

---

## 4. Execution Loop

When a command is applied, the engine runs tokens forward recursively until all are in a terminal or waiting state.

```mermaid
flowchart TD
    START([receive command])
    APPLY[apply command to instance]
    LOOP{pending active tokens?}
    DISPATCH[dispatch token by element type]
    SUSPEND{token suspended?}
    PRODUCE[produce new tokens on outgoing flows]
    COMMIT([commit new state and emit events])

    START --> APPLY --> LOOP
    LOOP -->|yes| DISPATCH
    LOOP -->|no| COMMIT
    DISPATCH --> SUSPEND
    SUSPEND -->|"yes — user task, message, timer"| LOOP
    SUSPEND -->|no| PRODUCE --> LOOP
```

---

## 5. Token Lifecycle

A token is the unit of execution — one per concurrent branch of a process.

```mermaid
stateDiagram-v2
    [*] --> active : produced at element

    active --> active : moves through sequence flows

    active --> waiting : suspended on user task / message / signal / timer

    waiting --> active : resumed by CompleteTask / DeliverMessage / FireTimer

    active --> suspended : instance administratively suspended

    suspended --> active : instance resumed

    active --> completed : token reaches End Event

    active --> cancelled : Terminate End Event fires

    waiting --> cancelled : interrupting boundary event fires

    completed --> [*]
    cancelled --> [*]
```

---

## 6. Process Instance Lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending : created, not yet started

    pending --> active : start()

    active --> suspended : all tokens waiting on external input

    suspended --> active : triggering command arrives

    active --> completed : all tokens reach End Events

    active --> terminated : administrative TerminateProcess command

    active --> error : unhandled Error End Event

    completed --> [*]
    terminated --> [*]
    error --> [*]
```

---

## 7. Gateway Semantics

### Exclusive Gateway (XOR)

```mermaid
flowchart LR
    IN[incoming token]
    GW{XOR}
    A["path A — amount gt 100"]
    B["path B — default"]
    NOTE["Join: first token through, no waiting"]

    IN --> GW
    GW -->|"first true condition wins"| A
    GW -->|"no match — take default"| B
    GW -.-> NOTE
```

### Parallel Gateway (AND)

```mermaid
flowchart LR
    IN[incoming token]
    SPLIT{AND split}
    A[branch A]
    B[branch B]
    C[branch C]
    JOIN{AND join}
    OUT[outgoing token]

    IN --> SPLIT
    SPLIT --> A --> JOIN
    SPLIT --> B --> JOIN
    SPLIT --> C --> JOIN
    JOIN -->|"all arrivedFromFlows satisfied"| OUT
```

> Join state tracks `arrivedFromFlows` as a `Set<string>` — **not a count** — so loops are handled correctly.

### Inclusive Gateway (OR)

```mermaid
flowchart LR
    IN[incoming token]
    SPLIT{OR split}
    A["path A — activated"]
    B["path B — activated"]
    C["path C — not activated"]
    JOIN{OR join}
    OUT[outgoing token]

    IN --> SPLIT
    SPLIT -->|condition true| A --> JOIN
    SPLIT -->|condition true| B --> JOIN
    SPLIT -.->|condition false| C
    JOIN -->|"activated paths A and B satisfied"| OUT
```

> The split records which paths were activated. The join fires when exactly those paths have arrived — not all incoming flows.

---

## 8. Message & Signal Correlation

```mermaid
sequenceDiagram
    participant EXT as External System
    participant ENG as ExecutionEngine
    participant STORE as StateStore
    participant INST as ProcessInstance

    EXT->>ENG: DeliverMessage(name, correlationKey, payload)
    ENG->>STORE: findSubscriptions(type=message, name, correlationValue)
    STORE-->>ENG: EventSubscription[]

    alt single match
        ENG->>INST: resume waiting token with payload
        ENG->>STORE: deleteSubscription(id)
    else no match and MessageStartEvent exists
        ENG->>INST: create new instance
    else no match
        ENG-->>EXT: MessageNotDeliveredError
    else multiple matches
        ENG-->>EXT: AmbiguousCorrelationError
    end
```

**Signal broadcast** (one-to-many):

```mermaid
sequenceDiagram
    participant SRC as Throw Event / External
    participant ENG as ExecutionEngine
    participant STORE as StateStore

    SRC->>ENG: SendSignal(name, payload)
    ENG->>STORE: findSubscriptions(type=signal, signalName=name)
    STORE-->>ENG: sub1, sub2, sub3 ...

    loop each matching subscription
        ENG->>ENG: resume token in instance
    end

    ENG->>ENG: emit SignalBroadcast event
```

---

## 9. Boundary Event Handling

```mermaid
sequenceDiagram
    participant ENG as ExecutionEngine
    participant STORE as StateStore

    Note over ENG: Token arrives at Task with boundary events
    ENG->>STORE: register EventSubscription per boundary event

    alt interrupting boundary fires
        STORE-->>ENG: subscription triggered
        ENG->>ENG: cancel task token
        ENG->>STORE: cancel all other boundary subscriptions
        ENG->>ENG: produce token on boundary outgoing flow
    else non-interrupting boundary fires
        STORE-->>ENG: subscription triggered
        ENG->>ENG: keep task token running
        ENG->>ENG: spawn additional token on boundary outgoing flow
    end
```

---

## 10. Dependency Injection Pattern

The host application wires the engine by injecting concrete implementations of all interfaces.

```mermaid
flowchart TD
    subgraph nexus-workflow-app
        PG[PostgresStateStore]
        WS[WebSocketEventBus]
        SCHED[DbBackedScheduler]
        H1[EmailServiceHandler]
        H2[HttpCallHandler]
        FEEL[FeelEvaluator]
        JS[JsEvaluator]
    end

    subgraph nexus-workflow-core
        ENG[WorkflowEngine]
        SS[StateStore interface]
        EB[EventBus interface]
        SC[Scheduler interface]
        SH[ServiceTaskHandler interface]
        EV[ExpressionEvaluator interface]
    end

    PG -->|implements| SS
    WS -->|implements| EB
    SCHED -->|implements| SC
    H1 -->|implements| SH
    H2 -->|implements| SH
    FEEL -->|implements| EV
    JS -->|implements| EV

    SS --> ENG
    EB --> ENG
    SC --> ENG
    SH --> ENG
    EV --> ENG
```

---

## 11. Testing Architecture

```mermaid
flowchart TD
    subgraph "nexus-workflow-core tests"
        UT["Unit tests — *.test.ts<br/>co-located with source"]
        SC["Scenario tests — *.scenario.test.ts<br/>tests/scenarios/"]
        FX["Test fixtures<br/>tests/fixtures/builders/<br/>tests/fixtures/bpmn/"]
    end

    subgraph "Test infrastructure"
        IMS[InMemoryStateStore]
        IMB[InMemoryEventBus]
        IMSch[InMemoryScheduler]
        CTX["createTestContext() factory"]
    end

    subgraph "Builder factories"
        TB[TokenBuilder]
        IB[ProcessInstanceBuilder]
        DB[ProcessDefinitionBuilder]
    end

    FX --> UT
    FX --> SC
    CTX --> UT
    CTX --> SC
    IMS --> CTX
    IMB --> CTX
    IMSch --> CTX
    TB --> FX
    IB --> FX
    DB --> FX
```

**Coverage thresholds:**

| Module | Lines | Branches |
|---|---|---|
| `src/engine/**` | 90% | 85% |
| `src/gateways/**` | 95% | 90% |
| `src/expression/**` | 90% | 85% |
| Global | 80% | 75% |
