---
name: code-craft
description: Use when authoring a new module, class, package or service from scratch, or when restructuring existing code. Triggers on refactor, restructure, extract, split up, new module, new service, new package, design this class, clean this up, rewrite this. Not for bug fixes, targeted edits, config changes, or one-off scripts.
---

# Code craft

Applies when creating or restructuring code, not when making a targeted edit to code that already works.

- **Follow existing patterns** — Match the codebase's existing style, naming conventions, and architecture. Don't introduce new patterns without asking.
- **Single responsibility** — Each function, class, or module should do one thing. If describing it requires "and", split it.
- **No placeholder code** — Never write `// TODO: implement this` or stub functions. Either implement fully or ask for clarification.
- **Minimize dependencies** — Every new dependency is a security, maintenance, and supply-chain liability. Prefer the standard library when reasonable.
