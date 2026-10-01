# Global Claude Code Behavior

## Core Principles

- **Ask clarifying questions** — Before implementing, ask questions to understand intent, scope, and constraints. Don't make large assumptions about what the user wants.
- **Delegate reading, not thinking** — Send file sweeps, searches and inventory work to subagents; they carry their own context, so the main thread stays small. Require them to return conclusions plus `file:line` references, never file bodies — then read only the file that actually matters. Parallelise freely when tasks are genuinely independent; don't fan out for its own sake. `CLAUDE_CODE_SUBAGENT_MODEL` (`settings.json` → `env`) is the default floor for subagents that don't specify otherwise; per-agent frontmatter `model:` overrides it (confirmed on 2.1.268 — this reversed in v2.1.251, so `model: opus` in frontmatter is no longer inert); a per-call `model` parameter overrides both. Use the floor for cheap delegated work and raise individual agents via frontmatter where accuracy pays (e.g. `scoped-reviewer` on `opus`), rather than raising the floor itself.
- **Explain the why, in proportion** — Be thorough on decisions, trade-offs and anything surprising: the *why*, not just the *what*. Be terse on mechanical confirmations. Depth where it changes what I do, not everywhere.

## Precedence

Where an installed skill or plugin conflicts with the rules below, these win:

1. Plan documents always use the section contract enforced by `plan-contract.js`
   (ten sections by default; nine, without `## Sonnet-ready`, when `CLAUDE_EXECUTOR=opus`
   is set for an Opus-executes session). `superpowers:writing-plans` prescribes a
   different header; it does not apply here.
2. Do not use `superpowers:subagent-driven-development`. Its model-escalation ladder
   cannot function while the subagent model floor is unresolved (see `Delegate reading,
   not thinking` above).
3. `/code-review`, `/simplify` and `/loop` are the defaults. Prefer them over any plugin
   offering the same capability.
4. Reference a known file with `@path/to/file` rather than letting a search locate it.

## Session & Context Hygiene

Cost is quadratic in session length — every turn re-reads the whole conversation, so a session that runs twice as long costs roughly four times as much. **Context size, not verbosity, is the spend.**

- **One session per task** — `/clear` at task boundaries. State carries in the plan file, `<feature>-progress.md` and the KGs, not in the transcript.
- **Compact deliberately** — If context passes ~150k mid-task, run `/compact <what to keep>` rather than letting auto-compaction choose. A deliberate compaction at a natural boundary loses far less than an automatic one at an arbitrary point.
- **Never read a large file into the main thread** to answer a small question — delegate it. A 39 KB file costs its tokens when it enters the cache *and* on every turn afterwards.
- **Watch the statusline** — context %, 7-day quota % and session cost are on screen. Act on them before they act on you.

## File Placement

Decide where a file goes **before** writing it. Apply in order:

1. Supports a specific repo and will be committed/shared through git → **inside that repo**. Nothing else goes in a repo.
2. Internal working file the user never asked for (intermediate data, throwaway script) → **session scratchpad**.
3. Standalone one-off the user will open or review (report, export, converted doc) → **`%USERPROFILE%\Downloads`**.
4. Durable, not a repo, not a one-off → **its own kebab-case folder under `C:\GitHub`**, with script-relative paths (`$PSScriptRoot`, `Path(__file__).parent`).
5. **Never** a loose file directly in `C:\GitHub` — that root holds project directories only.

## Software Development

- **Security first** — Never hardcode secrets, credentials, or API keys. Flag any security concerns immediately.
- **Credential store** — Windows Credential Manager is the default for every local secret. Read it first; seed it once from the source of truth (1Password or a user prompt) and cache the result. Never keep a secret in `.env`, env vars, config files or arguments. Exceptions: tools with their own OAuth store (gh, gcloud, Datadog MCP), and CI or shared-infra secrets, which go to Secret Manager or CI variables.
- **Git hygiene** — Write clear, concise commit messages. Never force push or amend without explicit permission.
- **Explicit error handling** — Never swallow exceptions. Handle, wrap with context, or propagate deliberately — don't silently ignore failures.

Everything else previously here — minimal changes, verification-first, evidence over assertion, preferring CLI tools — is now covered deeper and on-demand by `superpowers:verification-before-completion`, `superpowers:test-driven-development`, and `superpowers:systematic-debugging`, which trigger automatically on the relevant work.

## Executing an approved plan

- The plan file is the specification. Do not redesign it mid-execution.
- Ambiguity is a stop condition, not a judgment call. A plan that needs a decision you were not given is a defective plan — say so and ask.
- Run the plan's Verification section verbatim and paste real output. Never substitute your own checks.
- Record deviations in `<feature>-progress.md` with a reason, before making them.
- A step's `Verify:` gate must pass before the next step starts. A failure is a full stop — record it and escalate; never build on top of it.
- When `## Verification` passes, commit the plan's changes in every git work tree it touched before declaring done: path-scoped staging, a branch first if HEAD is a default branch with a remote, never push. Rules: `plan-progress-tracker` → "Committing on completion".

## General Behavior

- **No emojis** — Don't use emojis unless explicitly asked.
- **Admit uncertainty** — Say "I'm not sure" rather than guessing. Verify before stating facts.
- **Respect existing work** — Investigate unfamiliar files/branches before modifying or deleting. It may be in-progress work.
- **Confirm destructive actions** — Always ask before deleting files, resetting branches, or any irreversible action.
- **Use file:line references** — When referencing code, use `path/to/file.ts:42` format for easy navigation.

## Skill Suggestion

- **Watch for repetition** — Track tasks across the ongoing conversation. When the same kind of task is performed 2–3 times, flag it as a skill candidate. Don't suggest on the first occurrence — wait for the pattern to confirm itself.
- **What qualifies** — Two categories trigger a suggestion: (1) **repetitive multi-step workflows** with a fixed sequence of steps, and (2) **tool/CLI invocation patterns** that wrap a sequence of commands. One-off conversational tasks, simple questions, and trivial single-command actions do not qualify.
- **Determine scope before suggesting** — Decide whether the candidate is **global** (useful across projects) or **project-specific** (tied to a particular codebase/repo/domain). Scope dictates file placement:
  - Global → `%USERPROFILE%\.claude\skills\<skill-name>\SKILL.md`
  - Project-specific → `<project-root>\.claude\skills\<skill-name>\SKILL.md`
- **Suggest, don't create** — Present the candidate with: (a) proposed skill name, (b) trigger phrases or conditions, (c) one-line description, (d) proposed scope with full target path, (e) rationale (which 2–3 occurrences triggered the suggestion). Wait for explicit approval before writing any files.
- **Don't re-suggest** — If a candidate was already proposed and declined in the conversation, don't bring it up again in the same session.

## Specialized Behaviors (load on demand as Skills)

The topics below live as individual skills under `%USERPROFILE%\.claude\skills\`. Claude loads each one automatically when the task matches its description — they do **not** load by default, which keeps every conversation's context lean.

| Skill | Triggers on |
|---|---|
| `troubleshooting` | Bug investigations, errors, crashes, failing tests, regressions |
| `code-craft` | Authoring a new module or service, or restructuring existing code |
| `documentation` | Writing READMEs, runbooks, API docs, design docs, in-code explanatory comments |
| `system-design` | Architecture work, system design, trade-off analysis, design docs |
| `plan-progress-tracker` | Approved plans, non-trivial multi-step work, Jira ticket references, resuming work with `<feature>-progress.md` |
| `cloud-iac-guardrails` | `gcloud`/`aws`/`az`/`terraform`/`pulumi`/`bicep` commands, any cloud-resource change |
| `kg-update` | Recording findings, learnings, incidents, or decisions into a project knowledge graph; `/kg-update` |
| `security-sinks` | Editing Terraform, Python, JS/TS, or GitHub Actions workflow files |
| `servicenow-cr` | Drafting a ServiceNow/THFLOW change request for a stage or prod change |
| `tui-design` | Building, reviewing, or changing a terminal UI |

If a behavior I expect isn't being applied, the trigger phrasing in the relevant `SKILL.md` may be too narrow — adjust the `description` field there rather than dragging the rules back into this file.

## Slash Commands

Custom commands live in `%USERPROFILE%\.claude\commands\`. They are explicit verbs — unlike skills, they fire only when typed.

| Command | Does |
|---|---|
| `/ans` | Answer-only mode: reads and searches, never writes anything. |

**Creating new commands follows the 2nd–3rd-real-use rule** — don't build one because it seems useful.
