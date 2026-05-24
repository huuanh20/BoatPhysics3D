# Production Checklist: API Release (checklists/api-release.md - Game Edition)

This checklist must be audited and fully checked by the AI before releasing any new API endpoint into production.

---

## 🚀 API Release Checklist

- [ ] **Clean Architecture Dependency Check**: Verify that the Presentation layer only depends on Application layer interfaces. Ensure no DbContext is directly imported in controllers/Minimal APIs/SignalR Hubs.
- [ ] **Request Validation Guard**: Confirm that FluentValidation validators are configured and executed as filters before reaching the service layer.
- [ ] **OpenAPI / Swagger Generation**: Check that the endpoint utilizes Typed Results (`Results<Ok<T>, NotFound>`) and has a concise summary set, guaranteeing accurate Swagger JSON outputs.
- [ ] **Async Cancellation**: Ensure `CancellationToken` is accepted in the route and propagated to all downstream asynchronous method calls.
- [ ] **Cors & Security Configuration**: Double-check that the route complies with CORS policies. If it is an admin route, ensure `[Authorize(Policy = "AdminOnly")]` is present.
- [ ] **No Client-Side Evaluation Warning**: Verify that no LINQ queries within the new endpoint trigger EF Core client-side evaluation warnings.
- [ ] **Structured Log enrichment**: Ensure all info, warning, and error logs within the API flow use Serilog named structured placeholders instead of string interpolation.
