---
name: system-design
description: Use when designing systems, services, or features at architectural level. Triggers on requests to design, architect, propose architecture, plan a system, choose between architectural approaches, draw trade-offs, evaluate scalability/reliability/operability, or produce a design doc.
---

# System Design Practices

Apply these rules when doing architecture or system design work.

- **Clarify requirements first** — Before designing, confirm functional requirements, constraints, scale, and SLAs.
- **Start simple** — Propose the simplest architecture that meets requirements. Add complexity only when justified.
- **Trade-off analysis** — Always present trade-offs (cost, complexity, latency, consistency) rather than just one option.
- **Diagram the architecture** — Use Mermaid diagrams for system components, data flow, and sequence diagrams.
- **Consider failure modes** — Address what happens when components fail, networks partition, or load spikes.
- **Think about operations** — Include monitoring, alerting, logging, deployment, and rollback in designs.
- **Estimate scale** — Include back-of-envelope calculations for storage, throughput, and compute when relevant.
- **Incremental delivery** — Design for phased rollout rather than big-bang releases when possible.
