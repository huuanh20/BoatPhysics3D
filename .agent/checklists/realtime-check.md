# Production Checklist: Real-time System (checklists/realtime-check.md - Game Edition)

This checklist must be audited and fully checked by the AI before releasing or modifying any SignalR Hub or real-time websocket synchronization logic.

---

## 🎮 Real-time WebSockets Checklist

- [ ] **Reconnect Storm Prevention**: Ensure that websocket clients (e.g. game clients) utilize **Jittered Exponential Backoff** when reconnecting, preventing a massive server spike if a network drop happens (reconnect storms).
- [ ] **Connection Limits**: Ensure the SignalR hub handles connections within thread safety bounds. Check that maximum concurrent connections per player or IP are capped to mitigate Dos attacks.
- [ ] **Heap Allocation Mitigation**: Real-time message streams run hundreds of times per second (tick rates). Ensure that tick packets avoid high heap memory allocation (e.g., reuse payload instances or stream data efficiently).
- [ ] **No Async Blocking**: SignalR Hub handlers must never block threads. Ensure all calls inside SignalR Hub lifecycle handlers (`OnConnectedAsync`, `OnDisconnectedAsync`) are fully asynchronous.
- [ ] **Redis Backplane Check**: If scaling out across multiple container nodes, verify that the Redis SignalR backplane is configured properly to distribute lobby events.
- [ ] **Zero Logging of Game Loops**: Prevent logging of individual high-frequency real-time packets (tick frames) to avoid disk space bloat and CPU latency.
