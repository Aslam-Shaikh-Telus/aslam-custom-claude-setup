# Plan template

Copyable skeleton for the ten-section contract enforced by `plan-contract.js` at
`ExitPlanMode`. Fill every section — an empty one is the same as a missing one to the hook.
See `../SKILL.md` → "The plan contract" for the full rule set this template satisfies.

---

## Context

State the problem, what prompted it, and the intended outcome. This is where you argue *why*
the change is worth making — the reader should be able to disagree with the premise here, not
discover a missing justification three sections later.

## Decisions already made

The anti-inconsistency section. Every design call that could have gone another way, with the
reason it went this way. Anything absent here becomes an improvised decision at execution
time — and improvised decisions made by different steps don't agree with each other.

| Decision | Rationale |
|---|---|
| *(one row per call)* | *(why, not just what)* |

## Preconditions

What must be true before step 1 can start: repo/branch/commit, environment, required files or
credentials. End with an explicit stop condition:

> If a precondition fails, STOP and ask.

## Ground truth

`file:line` anchors for every site being changed, with the current behaviour stated. This is
what lets the executor skip re-discovering what you already found.

| Location | Current state |
|---|---|
| `path/to/file.ext:NN` | *(what's there now)* |

## Steps

Open with one line naming the order:

```
Execution order: sequential — each step depends on the previous.
```
or
```
Execution order: 1–2 sequential; 3, 4 parallel (disjoint files); 5 last.
```

Parallel steps must write disjoint files — if two steps touch the same file, they are
sequential, no exceptions. A step is only parallel-safe if its own verification is independent
of the other parallel steps' output.

Then the steps themselves, each ending with its own gate:

### 1. *(exact target file)*

*(what changes and why — verbatim content or a hard rubric, never "match whatever" / "as
appropriate" / "figure out the right shape")*

**Verify:** `<runnable command>` → `<binary pass condition>`

A failed `Verify:` is a full stop, not a note — record it in progress.md and escalate rather
than building on top of it.

## Out of scope

Explicit do-not-touch paths and problems you noticed but are deliberately not fixing here.

## Documentation

Decide repo documentation explicitly - README, runbooks, CLAUDE.md, in-code comments. The
section is required; a document is not. One line, at column zero:

    Repo docs: README.md, docs/runbook.md

It may instead read `none - <reason>`. A bare `none` is denied. Every named path must appear
in a `### ` step under `## Steps`, which carries its own `Verify:` gate. Load the
`documentation` skill for those steps. KG entries do not belong here - `kg-update` records
them at the end of the work.

## Verification

End-to-end acceptance criteria — not a repeat of the per-step gates above. This proves the
steps work *together*, which no individual step gate can. Include:

- Criteria **derived from the ticket's acceptance criteria**, restated as Given/When/Then — not
  invented here. One model writing both the plan and the criteria that judge it means passing
  proves self-consistency, not correctness. Where the ticket carries no AC, surface that absence
  before planning proceeds rather than filling the gap yourself.
- Runnable commands with binary pass/fail thresholds.
- **At least one falsification test** — corrupt the input on purpose and confirm the check now
  fails. A verification step that can't fail isn't testing anything.

## Sonnet-ready

Omit in Opus-executes mode (CLAUDE_EXECUTOR=opus, the Ctrl+Alt+O launcher) - the gate ignores
this section there. Required in every other session.

`Verdict: yes` or `Verdict: no`, plus a one-line reason. This is a claim about *this plan*, not a
request for a particular model.

- **`Verdict: yes`** — the plan is complete and executable as written, including any steps carrying
  an `Opus:` marker (below). Sonnet can execute it without originating anything, escalating only the
  named steps.
- **`Verdict: no`** — the plan is genuinely unfinished: something above is still undecided and no
  marker can carry it. `Verdict: no` is an unconditional denial — approval does not proceed. The two
  routes out are to settle the judgement (then flip to `yes`), or to name it as a marked step under
  `Escalations:` (then flip to `yes`).

`Verdict:` no longer drives model selection — that is what the marker grammar below is for.

### Per-step Opus escalation

Approval moves the session to Sonnet by itself (the `opusplan` setting at `settings.json:37`), and
no plan text or hook can override it. A step needing real judgement is not blocked by this: name it
with a marker, immediately after that step's `### ` heading, and the Sonnet executor delegates to an
Opus subagent instead of attempting it directly.

- `Opus: consult - <named judgement>` — the decision is hard, but writing it down once it's made is
  not. `opus-consult` investigates and returns the decision for the Sonnet executor to apply.
- `Opus: execute - <reason>` — the judgement and the doing cannot be separated: a live or interactive
  run, or an edit whose content depends on real output not knowable in advance. `opus-step` performs
  the step itself.
- `Opus: verify - <what makes the outcome ambiguous>` — the step is mechanical to perform but its
  result needs reading, not just a binary check. The Sonnet executor still performs the step; then
  `opus-consult` reads the step's own `Verify:` output and rules Pass/Fail/Inconclusive. A binary
  gate (exit code, hit count, byte-identical diff) does not take `verify` — that stays with the
  executor, or a `verify` marker on it is decorative ceremony.
- No marker — the Sonnet executor performs the step and judges its own `Verify:` gate, as today.

Exactly one marker per step. `execute` alone means `opus-step` returns the gate's raw output and the
*Sonnet* executor rules on it — valid only where that gate is binary. A step needing Opus to both do
the work and read the result is two steps, not one: split it, and the `execute` half's raw output
becomes the `verify` half's input.

When a plan carries at least one marker, `## Sonnet-ready` must also carry `Escalations: <step
names>`, one per marked step; a marker-free plan states `Escalations: none`.

Delegating this judgement to an Opus subagent was believed unavailable — measured 2026-08-28, every
subagent ran Sonnet regardless of frontmatter, per-call `model`, or a hook rewriting the call's
input. That reversed in Claude Code v2.1.251: frontmatter `model:` now outranks the subagent model
floor, confirmed live on 2.1.268 and again on 2.1.273. The marker grammar above is the route that
unlocks.

Never use a mid-session `/model` round trip. An Enter-confirmed `/model` persists by rewriting the
`model` key in `settings.json`, so one forgotten restore pins every future session to Opus.

## Escalation

Ambiguity is a stop condition, not a judgement call. State what should make the executor stop
and ask rather than improvise — this is what the whole contract exists to protect.
