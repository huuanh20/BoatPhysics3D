# Production Checklist: Payment Flow (checklists/payment-flow.md - Game Edition)

This checklist must be audited and fully checked by the AI before releasing or modifying any store transaction, product checkouts, or virtual currency updates.

---

## 💳 Store Transaction Checklist

- [ ] **Transaction Idempotency**: Ensure a unique `TransactionId` is bound to the transaction. The database must reject duplicate callback updates for the same ID to prevent double-crediting player virtual items.
- [ ] **Signature Verification**: Verify the dynamic checkout request hashes. Webhook payloads MUST have their dynamic HMAC checked using secure secrets.
- [ ] **Zero Sensitive Plaintext Logs**: Ensure player bank accounts or payment secrets are never logged in plain text.
- [ ] **Connection Timeouts & Retries**: Ensure external payment provider HTTP calls timeout within 10 seconds. Implement fallback alerts to display "Processing Purchase" if external checks fail.
- [ ] **State-Transition Validation**: Verify that transaction states only transition forward (e.g., `Pending` -> `Success` or `Pending` -> `Failed`).
