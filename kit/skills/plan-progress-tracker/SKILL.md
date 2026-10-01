---
name: plan-progress-tracker
description: Use when a plan has been approved for implementation, when starting non-trivial multi-step work, when the user mentions a Jira ticket or wants to track progress in Jira, or when resuming work that already has a <feature>-progress.md file. Covers task breakdown, plan execution tracking, the progress.md living document, and Jira integration (ticket discovery, status sync, milestone comments, workflow mapping).
argument-hint: [PROJ-1234]
---

# Plan & Progress Tracker (with Jira Integration)

## Project management practices

- **Break work into tasks** — For non-trivial work, create a task list with clear deliverables before starting.
- **Status updates** — When working on multi-step tasks, provide brief progress updates between steps.
- **Flag blockers early** — If something is blocked or unclear, raise it immediately rather than making assumptions.
- **Scope awareness** — If a request is growing beyond the original scope, flag it and confirm before continuing.
- **Prioritize** — When given multiple tasks, ask about priority order rather than assuming.
- **Use plans for complex work** — For large features or refactors, create a plan and get alignment before coding.
- **Summarize decisions** — After a discussion with multiple options, summarize what was decided and why.

## The plan contract

Before a plan can be approved (enforced by a `PreToolUse` hook on `ExitPlanMode` — see `%USERPROFILE%\.claude\hooks\plan-contract.js`), it must contain ten sections. The hook exists because a plan is the entire handoff channel between the model that decides and the model that executes: anything left undecided in the plan becomes improvised at execution time, and improvised decisions don't agree with each other.

1. `## Context` — the why, the problem, the intended outcome.
2. `## Decisions already made` — every design call, with rationale.
3. `## Preconditions` — repo/branch/env, required files, an explicit "if a precondition fails, STOP and ask".
4. `## Ground truth` — `file:line` anchors for every site being changed, with current behaviour stated.
5. `## Steps` — opens with an `Execution order:` line (sequential, or which steps may run in parallel — parallel steps must write disjoint files). Each step names an exact target file and ends with its own `Verify:` gate: a runnable command and a binary pass condition. A failed `Verify:` is a full stop, not a note — record it in progress.md and escalate rather than building on top of it.
6. `## Out of scope` — explicit do-not-touch paths.
7. `## Documentation` — a `Repo docs:` line naming the repo docs updated, or `none - <reason>`; every named path becomes a step with its own `Verify:` gate. KG entries stay with `kg-update` at the end of the work.
8. `## Verification` — end-to-end acceptance criteria **derived from the ticket's AC**, restated as Given/When/Then, with binary pass/fail thresholds and at least one falsification test (a check that fails on purpose, proving the suite isn't vacuous). The planning agent does not invent these: one model writing both the plan and the criteria that judge it means passing proves self-consistency, not correctness. Where the ticket carries no AC, surface that absence before planning proceeds rather than filling the gap yourself — see the `pm-po-jira` skill for the format.
9. `## Sonnet-ready` — a `Verdict: yes` or `Verdict: no` line, plus a one-line reason. This is a claim about the *plan*, not a request for a model. `Verdict: yes` means the plan — including any step carrying an `Opus:` marker — is complete and executable as written. `Verdict: no` means the plan is genuinely unfinished, and is an unconditional denial: the two routes out are to settle the judgement, or to name it as a marked step under `Escalations:`, either way followed by a change to `yes`. Approval switches the session to Sonnet on its own (the `opusplan[1m]` setting at `settings.json:37`), and neither plan text nor any hook can override that — a step needing real judgement escalates via the per-step marker grammar (`Opus: consult` / `Opus: execute` / `Opus: verify`, see `references\plan-template.md`) rather than through the verdict. When the plan carries at least one marker, `Escalations: <step names>` is required alongside the verdict; a marker-free plan states `Escalations: none`.
10. `## Escalation` — ambiguity is a stop condition, not a judgement call.

Copyable skeleton with per-section notes: `references\plan-template.md`.

**Density belongs in tables, not prose.** `Decisions already made` and `Ground truth` scan in seconds as tables. A repeated pattern is described once with two or three representative paths, never enumerated across every file. Specificity means *no unresolved decisions*, not *more words* — a long section that is hedging fails the contract; a long section that is deciding passes.

**Escape hatches**, for when the contract genuinely doesn't apply: a one-line `Contract: exempt — <reason>` in the plan, or (rarely, when the hook itself is misbehaving) `CLAUDE_PLAN_CONTRACT=off` in the environment.

## Progress tracker for accepted plans

Once a plan is approved for implementation, create a progress tracker document (e.g., `<feature>-progress.md`) capturing the original plan: scope, goals, ordered steps, and key decisions. Keep it as the living record of execution and update it at meaningful checkpoints — after each step, when blockers arise, or when direction changes.

Each update should note: current status (done / in-progress / blocked), new findings or context discovered, errors encountered and how they were resolved, workarounds applied (with reasons), and any deviations from the original approach (with justification). The goal is that anyone — including a future session — can read the tracker and understand both *what* was done and *why* the path evolved the way it did.

**Where it goes:** beside the plan file, in `%USERPROFILE%\.claude\plans\`, unless the work is repo-scoped and will be committed — then in the repo root. Placement has drifted before (one progress file ended up inside a project repo with nothing else there to signal that); the `plan_file:` frontmatter key below exists specifically so a session that finds the wrong one can recover.

**`plan_file:` is mandatory frontmatter**, naming the plan this tracker belongs to. After a `/clear` or a session restart, the executing model has no memory of which plan it is executing — this back-reference is the only thing that recovers it.

### Committing on completion

The next session must not open on a dirty tree this plan left behind.

- **Baseline at creation.** For every git work tree the plan will touch (`git -C <dir> rev-parse --show-toplevel` succeeds), record `git status --porcelain` in a `## Git baseline` section of progress.md when you create the tracker.
- **Commit only after `## Verification` passes.** If Verification fails, do not commit. Record the failure and escalate. A plan that stops mid-way stays uncommitted on purpose.
- **Stage by path.** Stage only the paths this plan created, modified or deleted, naming each one. Never use `git add -A`, `git add .` or `git commit -a`. If a path the plan changed was already dirty at baseline, STOP and ask, because committing it whole would absorb someone else's hunks. Leave other pre-existing changes alone and list them in the completion report.
- **Branch.** If HEAD is on the default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`, else `main`/`master`) and `git remote` is non-empty, create and switch to `<jira-key>-<feature>` (or `<feature>` when `jira: none`) before committing. A repo with no remote (`~/.claude`, `local-kg`) commits on its current branch.
- **Message.** Use an imperative summary line, then a body naming the plan file and Jira key, then the attribution trailer the session requires.
- **One commit per work tree.** A plan that touched several repos commits in each one.
- **Never push, amend, or pass `--no-verify`.** If a hook refuses the commit, report the refusal verbatim and stop.
- **Record it.** Put each commit SHA (and branch, if one was created) in progress.md before declaring the plan done.

### Escalation tracking

If the plan's `## Sonnet-ready` carries an `Escalations:` line naming one or more marked steps,
seed an `## Escalations` checklist in the tracker **at creation time** — one unchecked entry per
marked step, naming its marker kind (`consult` / `execute` / `verify`) and the named judgement or
reason. Do this even though the approval-time `additionalContext` briefing also names these steps:
that briefing is one-shot and does not survive a compaction, while the progress file is re-read
every turn — on anything past a short plan, the checklist is the only thing that still tells a
later turn a marker means "call `opus-consult`" or "call `opus-step`".

When execution reaches a marked step, record the escalation as its own dated log entry: which
agent was dispatched, the marker kind, the named judgement or reason given to it, and its returned
decision or ruling **verbatim** — including an Inconclusive `verify` ruling, which is the one most
likely to get quietly rounded up to a pass if it isn't written down. Check off the checklist entry
once recorded.

## Jira Integration (extends Progress Tracker)

Applies whenever a plan is approved for implementation.

### Linking the plan to Jira

- **Confirm the Jira ticket up front** — Before creating `<feature>-progress.md`, ask: *"Is there a Jira ticket for this work?"*
  - If **yes** → discover full context (see below) before proceeding.
  - If **no** → offer to create one with `createJiraIssue`. Propose summary + description from the plan; confirm fields before creating.
  - **Per-plan opt-out**: user may say "no Jira for this plan" — proceed with progress.md only, record `jira: none` in frontmatter, skip all Jira sync.

- **Discover related context before locking in the primary ticket** — When the user names a ticket, don't just verify it in isolation. Build the full picture first:
  - `getJiraIssue(KEY)` → captures parent (for subtasks/stories under an epic), assignee, status, current description.
  - If the ticket is an Epic: `searchJiraIssuesUsingJql("\"Epic Link\" = KEY OR parent = KEY")` to find children. Pass `fields: ["key","status","summary"]` and `maxResults: 100` — both are honoured (verified 2026-08-25), so one call covers any realistic epic. Omitting `fields` returns full descriptions and roughly doubles the token cost. If an epic genuinely exceeds 100 children, carry the returned `nextPageToken` into a follow-up call. See `C:\GitHub\local-kg\work\tooling-atlassian-mcp.md`.
  - If the ticket has linked issues (blocks/blocked-by/relates-to/clones), surface them.
  - `getJiraIssueRemoteIssueLinks(KEY)` for any external links (Confluence, dashboards, design docs).
  - Present the full graph to the user — "Here's what I found: parent EPIC-100, 3 sibling stories, 2 'blocks' links" — then ask **which ticket is primary for status sync** and **which others (if any) should receive milestone comments**.
  - Record the primary in frontmatter as `jira: PROJ-1234`; secondary recipients as `jira_cc: [PROJ-100, PROJ-99]`.

- **Warn if the primary ticket is already in a terminal state** — If `getJiraIssue` returns status "Done", "Closed", "Cancelled", or similar, do not silently proceed. Surface it: *"PROJ-1234 is currently 'Done'. Options: (a) reopen it, (b) create a new ticket linked to this one, (c) proceed without status sync, (d) cancel and rethink."* Wait for the user's choice every time — do not pick a default.

### Once Jira is confirmed — autonomous at milestones

- **Status transitions** without re-asking: To Do → In Progress (on start), → Blocked (on blocker raised), → Done (on completion). Use `getTransitionsForJiraIssue` to discover valid transition IDs (workflow varies per project).

- **Workflow-variation fallback** — If `getTransitionsForJiraIssue` does *not* return a clean transition for the intended state (e.g., the project's workflow has no "Blocked" status, or requires "In Review" → "QA" → "Done" rather than a direct → Done), do **not** force the closest match. Stop and ask:
  - Show the user the actual available transitions for the ticket's current status.
  - Propose the closest semantic match ("This workflow has 'On Hold' instead of 'Blocked' — use that?").
  - Wait for confirmation. Record the chosen mapping in progress.md frontmatter under `jira_workflow:` so subsequent transitions in this plan reuse it without re-asking:
    ```
    jira_workflow:
      blocked: "On Hold"
      done: "Ready for QA"
    ```
  - The mapping is per-plan, not global — different Jira projects may map differently.
  - For **WORKSAFE** and **NLCHI**, the real transition ids are already recorded in `C:\GitHub\local-kg\pm\projects.md`. They differ sharply: WORKSAFE exposes 12 global transitions from any status with no screens, while NLCHI has 3 conditional ones where `Resolve Issue` and `Close Issue` carry screens and will likely demand a `resolution`. Read that file for context, but still call `getTransitionsForJiraIssue` before transitioning — conditions are evaluated per issue and per user.

- **Milestone comments** at: work start, major step completion, blocker raised, plan deviation, work complete.

  **What counts as "major step complete"** — A *major step* is any step in the plan's top-level ordered list (the steps the user approved when accepting the plan). Sub-steps, internal checkpoints, refactors, and intermediate verification all stay in `progress.md` only and do not generate a Jira comment. Rule of thumb: if the user would recognize the step from the original plan, it's milestone-worthy; if it's an implementation detail Claude introduced during execution, it's not.

- **Comments quote the relevant progress.md excerpt inline** — Each milestone comment is self-contained so a Jira reader without filesystem access still gets the full picture. Quote the relevant section verbatim (use Jira's `{quote}...{quote}` or `> ` markdown), don't just link. Keep it scoped to the milestone — quote the section that's actually relevant, not the entire progress.md.

- **User can override at any time**: *"stop posting to Jira"*, *"don't transition that ticket"*, *"drop Jira from this plan"* — honor immediately for the rest of the session and reflect the decision in frontmatter.

### Altitude split

- **Jira ticket** = milestones with inline-quoted detail. Self-sufficient for non-filesystem readers.
- **progress.md** = the complete granular execution log (per-checkpoint status, findings, errors, workarounds, deviations with reasons). Still the source of truth Claude reads to resume context.

### Resuming work

- On a plan whose progress.md has a `jira:` key, read the primary ticket's current status and most recent comments *before* continuing. Also check any `jira_cc:` tickets for status drift.
- If the ticket was moved or commented on out-of-band since the last progress.md update, surface it to the user before proceeding.
- Honor any `jira_workflow:` mapping found in frontmatter — don't re-discover transitions mid-plan.

### Always ask first for

- Closing the ticket beyond "Done" (terminal states with no return path in the workflow)
- Editing fields other than status, description (on initial sync), and adding comments
- Logging worklog hours
- Creating, removing, or modifying issue links to other tickets
- Posting to any ticket *not* in the confirmed `jira:` or `jira_cc:` list

## Example progress.md frontmatter

```yaml
---
plan: oauth-callback-migration
plan_file: oauth-callback-migration.md
created: 2026-05-14
jira: PROJ-1234
jira_cc:
  - EPIC-100
  - SEC-99
jira_workflow:
  blocked: "On Hold"
  done: "Ready for QA"
---
```

Opted-out variant:

```yaml
---
plan: quick-doc-fix
plan_file: quick-doc-fix.md
created: 2026-05-14
jira: none
---
```

`jira: none` can still co-exist with a populated `jira_cc:` — this covers work with no single primary ticket to sync status against, but that should still surface milestone comments on related tickets:

```yaml
---
plan: chg0057305
plan_file: chg0057305.md
created: 2026-08-10
jira: none
jira_cc:
  - WORKSAFE-2201
---
```
