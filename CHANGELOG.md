# Changelog

Newest first. Each entry says what changed in `kit/` and whether you need to do
anything after `git pull`.

## 2026-10-01

First share. Replaces the earlier `claude-starter-kit` draft and the
hand-copied handoff bundle from the 2026-09-23 demo.

Components (13):

- **core**: `claude-md`, `base-settings`, `plan-contract` (ten-section plan
  contract, inject/gate/Jira-prompt hooks, `plan-progress-tracker` skill),
  `guard-commands` (destructive-command guard, 65-case test suite).
- **recommended**: `agents` (Explore, locator, scoped-reviewer, opus-consult,
  opus-step), `generic-skills` (troubleshooting, code-craft, documentation,
  system-design, tui-design, cloud-iac-guardrails), `ans-command`,
  `security-sinks` (PostToolUse sink reminder + skill), `statusline`.
- **advanced**: `kg-runner`, `kg-update`, `servicenow-cr`, `datadog-guard`
  (asks before any non-read Datadog MCP call).

Repo tooling: `tools/export.ps1` re-exports `kit/` from the live setup,
`tools/scan.ps1` blocks names, personal paths and secrets, and
`.githooks/pre-commit` runs the scan on every commit.

Installer: fixed a StrictMode crash in `INSTALL.ps1 -Report` ("property 'Count'
cannot be found") when a settings-key filter returned a single result; `base-settings` now offers only keys that
`kit/settings.json` actually ships.

Action after pull: none (first install). Hooks still need a manual merge into
`settings.json`; see README step 3.
