# Playbook: Feature Delivery (playbooks/feature-delivery.md - Game Edition)

This playbook establishes the strict, step-by-step pipeline that the AI MUST execute when delivering any new feature in the MyAwesomeGame codebase.

---

## 🛠️ Step-by-Step Delivery Pipeline

1. **Step 1: Scoping & Tab Focus**: Verify that the developer has opened all relevant source files in the active tabs.
2. **Step 2: Dependency Gate Check**: Load clean architecture layers standards to ensure presentation layer boundaries are respected.
3. **Step 3: Define Request/Response Contracts**: Design DTOs or WebSocket payloads using C# record types before writing logic.
4. **Step 4: Analyze Failure Scenarios**: Identify what transient failures could happen (e.g. database disconnect, websocket reconnect loop, Redis cache eviction) and list them.
5. **Step 5: Draft the Interface**: Write the clean service interface inside the Application layer.
6. **Step 6: Plan Database Changes**: Design migrations and configure PostgreSQL/Redis entities inside the Infrastructure layer.
7. **Step 7: Propose Implementation Plan**: Write a concise plan summarizing steps 1-6 and wait for developer approval.
8. **Step 8: Implement Incrementally**: Write clean, primary constructor C# code, propagating `CancellationToken` throughout.
9. **Step 9: Database Query Audit**: Run a query performance audit (checking for `.AsNoTracking()`, N+1 loops, and split-querying).
10. **Step 10: Write xUnit Tests**: Create robust test suites covering both success and edge failure cases.
11. **Step 11: Execute Testing Loop**: Open the terminal and run `dotnet test` to verify everything is green.
12. **Step 12: Structured Logs Audit**: Ensure Serilog named structured placeholders are used correctly in all log events.
13. **Step 13: Update Scratchpad**: Record progress and decisions in `.agent/SCRATCHPAD.md`.
