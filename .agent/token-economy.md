# Token Economy Rules (token-economy.md - Game Edition)

These strict directives ensure minimum token usage, hyper-focused context parsing, and lightning-fast AI response latencies in Antigravity.

---

## 🎯 Context Pruning Guidelines

### 1. Zero Bloated Scans
- **Rule**: **NEVER** scan the entire repository codebase unless explicitly instructed by the developer.
- **Rule**: Rely strictly on active open tabs and direct relative file links (`[filename](file:///...)`) specified in the prompt.

### 2. Conciseness First
- **Rule**: Avoid repeating context, database schemas, or code that is already present in the active open files.
- **Rule**: Do not write long, conversational intros or summaries. Go straight to the engineering design or the code implementation.

### 3. Incremental Implementation
- **Rule**: Never rewrite 500 lines of a class to change 5 lines. Provide precise, targeted diff blocks or focused method replacements.
- **Rule**: When creating new files, write functional, focused code blocks rather than bloated boilerplate structures.
