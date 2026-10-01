---
name: troubleshooting
description: Use when investigating bugs, errors, crashes, failing tests, unexpected behavior, broken builds, or any "X isn't working" situation. Triggers on words like bug, error, crash, broken, failing, not working, regression, fault, exception, hang, slow, debugging.
---

# Troubleshooting

Invoke `superpowers:systematic-debugging` first for method — its Iron Law (no fix without root
cause), four-phase investigation, and 3-strike architecture stop cover the general procedure more
deeply than anything duplicated here. This skill only adds what is specific to this estate.

## Where to look, by system

- **NLCHI / NLHS Linux VMs** (nlap*, webmethods, Liferay, Tomcat) — log locations, service names,
  and access are in `nlchi-vm-access`. Do not guess a path; that skill is the source of truth.
- **WSBC / GCP** — infrastructure and monitoring context lives in `cloud-iac-guardrails` and the
  `wsbc-pp` KG (`C:\GitHub\wsbc-pp-kg`), including the drift register for known infra findings.
- **Datadog-observed services** — use the Datadog MCP skills (`ddconfig`, `search_datadog_logs`,
  `search_datadog_incidents`) rather than SSH; it is read-only by instruction, never a write tool.

## Escalation

If root cause isn't found after the 3-strike stop in `systematic-debugging`, or the system
involved needs access this session doesn't have, stop and name what's missing rather than guessing
around it — a wrong guess against production infrastructure is worse than an unresolved bug.
