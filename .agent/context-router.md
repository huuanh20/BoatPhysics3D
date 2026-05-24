# Context Router (context-router.md - Game Edition)

This file acts as the cognitive routing map for the AI. When a user requests a task, matching rules determine which exact standard, heuristic, mode, or skill is loaded into the active memory context.

---

## 🎯 Routing Map

### 1. Realtime WebSockets & SignalR
- **If task involves**: SignalR hubs, room connections, event streams, or websocket reconnect logic:
- **Load**:
  - `standards/API_STANDARDS.md`
  - `heuristics/FAILURE_RULES.md`
  - `checklists/realtime-check.md`
  - `modes/performance.md`

### 2. Database & EF Core
- **If task involves**: DB models, player records, migrations, or database queries:
- **Load**:
  - `standards/DATABASE_RULES.md`
  - `heuristics/ANTI_PATTERNS.md`
  - `modes/performance.md`

### 3. Matchmaking & Leaderboard Cache (Redis)
- **If task involves**: Redis cache, matchmaking queues, or leaderboard rankings:
- **Load**:
  - `standards/DATABASE_RULES.md`
  - `heuristics/SCALING_RULES.md`

### 4. Payments & Purchases
- **If task involves**: Virtual store, payments checkout, or purchases validation:
- **Load**:
  - `standards/SECURITY_RULES.md`
  - `heuristics/FAILURE_RULES.md`
  - `checklists/payment-flow.md`
  - `modes/security.md`

### 5. Writing Code & Testing
- **If task involves**: Writing game services, logic, or tests:
- **Load**:
  - `standards/TESTING_RULES.md`
  - `modes/implementer.md`

---

## ⚡ Execution Principle
Always limit active context to **ONLY the target rules and skills mapped above**. Do not load all files simultaneously.
