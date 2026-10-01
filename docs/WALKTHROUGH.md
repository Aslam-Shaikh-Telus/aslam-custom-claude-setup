# Walkthrough

This is the reasoning behind the kit, not the instructions for using it. The
README tells you how to run the installer; this file tells you what each piece
is for, what it costs you, and which parts are still unresolved.

Read it before you adopt anything in the advanced tier. Most of the value in
this setup is in three or four files; the rest is machinery that only pays off
once you have a specific problem it solves.

## Start here

Adopt in this order. Each step is useful on its own, and each one makes the next
one worth more.

1. **`claude-md`** — the behaviour contract. On its own, this is most of the
   benefit. Take it, then edit it down to what you actually agree with.
2. **`base-settings`** — plan mode by default, deliberate compaction. Two
   minutes of work, and it changes how every session starts.
3. **`plan-contract`** — the gate that makes step 1 stick when the session gets
   long and the model starts cutting corners.
4. **`guard-commands`** — the commands you cannot undo.
5. **`agents`**, **`generic-skills`**, **`ans-command`**, **`security-sinks`**,
   **`statusline`** — cheap, low-risk, load only when relevant.
6. Everything else — `kg-runner`, `kg-update`, `servicenow-cr`, `datadog-guard`.
   These have real setup cost or only make sense for a specific environment. Do
   not start here. Several people who tried to adopt the whole setup at once
   bounced off it at exactly this point.

Steps 1–4 are perhaps two hours of reading and tuning. Step 6 is a project.

---

## The one idea underneath all of it

A long session costs quadratically. Every turn re-sends the whole conversation,
so a session that runs twice as long costs roughly four times as much — and, more
importantly, gets worse at its job as the signal-to-noise ratio drops.

Almost every component here is a consequence of that single fact:

- **Delegate reading, not thinking.** Subagents carry their own context. A file
  sweep that would cost 40 KB in the main thread costs a one-paragraph answer
  instead. That is why `agents` exists and why the contract insists on
  `file:line` references rather than file bodies.
- **One session per task.** State lives in files — a plan, a progress file, a
  knowledge graph — not in the transcript. That is why `kg-runner` exists.
- **Skills instead of a giant contract.** A skill's body only enters context
  when its description matches the task. Twenty skills cost roughly nothing on
  an unrelated turn; twenty paragraphs in `CLAUDE.md` cost their tokens on
  every turn of every session, forever.

If you take nothing else from this kit, take those three.

---

## Components

### `claude-md` — the behaviour contract

**The problem.** Left alone, the model optimises for looking finished. It
refactors code you did not ask it to touch, claims tests pass without showing
output, and guesses rather than admitting it does not know.

**What it does.** A single always-loaded file stating how work is done: ask
before assuming, delegate reading to subagents, show the command and its real
output rather than asserting success, never swallow an exception, decide where a
file goes before writing it, and commit an approved plan's changes by path once
its verification passes.

**What it costs.** It is opinionated, and some of it is friction you may not
want. "Verification-first" means a bug fix starts with a failing repro test,
unconditionally — that is the right default and it is also genuinely slower on a
one-line fix. "One session per task" means losing context you might have wanted.

**Keep it?** Yes, but edit it. Adopting someone else's behaviour contract
wholesale is the same mistake as adopting someone else's `.vimrc` wholesale. The
installer will not overwrite yours for exactly this reason — it writes the kit's
version beside yours as `CLAUDE.md.starter-kit` and leaves the merge to you.

**The rule that is easiest to underrate:** *a failing test is never edited to
make it pass.* That is a full stop, and it is in the contract because it is the
single most expensive thing an agent can quietly do to you.

---

### `base-settings` — session defaults

**The problem.** The defaults are fine for exploration and wrong for work. A
session that starts in edit mode starts editing.

**What it does.** Sets plan mode as the default so every session begins by
proposing rather than doing, uses `opusplan` so planning runs on Opus and
execution on a cheaper model, sets a reasoning-effort level, turns on
auto-compaction with a deliberate window rather than letting it trigger at an
arbitrary point, and denies reads of `.env`, key and credential files.

It also sets `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` — the default floor for
subagents that do not name their own model. Since most delegated work is search
and inventory, that is where most of the saving in a delegation-heavy setup
comes from. An agent's frontmatter `model:` overrides the floor (observed on
Claude Code 2.1.268; before 2.1.251 the floor won), which is how `opus-consult`,
`opus-step` and `scoped-reviewer` get Opus while `locator` stays cheap.

**What it costs.** These are preferences, and you may have tuned yours already.
The installer offers every key one at a time against your current value, and
leaves keys you have set that the kit does not mention completely alone. Proxy
values are not shipped; keep your own.

**A trap worth knowing.** Running `/model` rewrites `settings.json` and can
silently drop keys it does not know about — `autoCompactWindow` was observed
disappearing this way. The absence of a key is not proof it was never set. If
compaction behaviour changes for no reason, check that file first.

---

### `plan-contract` — the plan quality gate

**The problem.** `CLAUDE.md` can ask for good plans. It cannot enforce them.
Twenty turns into a session, "write a proper plan first" has been crowded out by
everything else in context, and you get a plan that says "implement the feature,
then test it" — which is not a plan, it is a restatement of the request.

**Why a hook beats asking politely.** A hook runs outside the model's context.
It cannot be forgotten, argued with, or crowded out. `inject-plan-contract.js`
puts the contract into planning turns; `plan-contract.js` runs on `ExitPlanMode`
and refuses to let a plan be accepted unless it has all ten required sections —
among them its decisions, its ground truth, its verification steps, its
escalation conditions, and what is explicitly out of scope.

That last section does more work than it looks like. A plan with a real "out of
scope" section has been thought about; a plan without one usually has not.

**What it costs.** It will refuse plans you think are fine. When it does, the
answer is to fix the plan, not the hook — but that is genuinely annoying the
first few times, and you should expect to spend a session tuning it to your
taste rather than accepting the shipped rules. `node kit/hooks/test-plan-contract.js`
tells you whether a change you made still holds.

`plan-accepted-jira.js` additionally prompts about a tracking ticket whenever a
plan is accepted. If you do not work in a ticketed environment, drop that hook
and keep the other two; they are independent.

The `plan-progress-tracker` skill is the other half. A plan is a specification,
and a `<feature>-progress.md` file is where execution state lives so that a
`/clear` does not lose it. The rule that matters: **a step's verification gate
must pass before the next step starts.** A failure is a full stop to be recorded
and escalated, never something to build on top of.

---

### `guard-commands` — the destructive-command guard

**The problem.** An agent with a shell will eventually run `git push --force` or
`git reset --hard` on the wrong branch, or apply infrastructure changes from a
directory pointing at production. Each of these is fine 99 times and
catastrophic once.

**What it does.** A `PreToolUse` hook on `Bash` and `PowerShell` that denies a
specific, enumerated list of unrecoverable commands, plus rules that key off the
current working directory to block production and DR infrastructure changes from
the wrong place. Before a commit to a shared knowledge-graph repo, it scans the
staged content and asks if it finds a secret or a term from
`personal-terms.json`.

The WSBC repository names in its rules are real on purpose: a rule about the
wrong working directory only works if it names the right one. If your repos are
named differently, edit the rules.

**The regression suite is the point.** `test-guard-commands.js` is 65 cases and
plain Node — no framework, no install. A guard you cannot test is a guard you
will eventually disable out of frustration. Run it after any edit:

```
node kit/hooks/test-guard-commands.js
```

**The finding worth passing on:** the guard matches on the whole command string,
which means **it matches commit message prose as well as commands**. Writing
`git commit -m "revert the force push we did last week"` can trip a rule that is
looking for `force push`. This is not a bug that was worth fixing — narrowing
the match to avoid it would open real holes — but it surprises everyone the
first time, and now it will not surprise you.

**`personal-terms.json` ships with empty `names` and `keywords` arrays.** It is
per-person by definition and is never committed. Fill it in locally after
install.

---

### `agents` — scoped subagents

Five agents, all deliberately narrow:

- **`Explore`** and **`locator`** answer "where does X live" and return
  coordinates and conclusions, never file bodies. They do not analyse, review,
  or explain. That restraint is the feature: a locator that starts explaining is
  a locator that starts reading whole files into a summary you then have to
  check.
- **`scoped-reviewer`** reviews a diff for correctness against stated
  requirements, in a fresh context that has not seen the reasoning that produced
  the change. It will not suggest refactors, defensive code, or extra tests.
- **`opus-consult`** is a read-only Opus judgement call for one named question
  inside an executing plan: `consult` returns a decision for the cheaper
  executor to apply; `verify` rules a step's `Verify:` output Pass, Fail or
  Inconclusive.
- **`opus-step`** is the edit-capable version, for a single plan step marked
  `Opus: execute` — where the judgement and the doing cannot be separated.

**What it costs.** Nothing at rest. The failure mode is social, not technical:
the temptation to widen a narrow agent's description until it is a general agent
with a specific name. If you do that, it stops being worth invoking.
`opus-consult` and `opus-step` only make sense alongside `plan-contract`.

---

### `generic-skills` — general engineering skills

Six skills that load only when the task matches: `troubleshooting`,
`code-craft`, `documentation`, `system-design`, `tui-design`,
`cloud-iac-guardrails`.

**Why skills rather than more contract.** A skill's body is not in context until
its description matches. That means you can have twenty of them and pay for none
of them on an unrelated turn. It is the single best mechanism the harness gives
you for keeping a large body of guidance without a large baseline cost.

**What it costs.** Skills fire on a description match, which means they
sometimes fire when you did not want them. The fix is to narrow the `description`
field in the relevant `SKILL.md`, not to delete the skill. Conversely, if a
behaviour you expect is not being applied, the description is probably too
narrow — widen it there rather than dragging the rules back into `CLAUDE.md`.

---

### `security-sinks` — dangerous-API reminders after an edit

**The problem.** The dangerous calls — `exec()` with an interpolated string,
`eval`, `new Function`, `innerHTML`, `pickle`, `yaml.load`, disabled TLS
verification — are easy to write and easy to miss in review, because each one
looks like ordinary code.

**What it does.** A `PostToolUse` hook on `Edit` and `Write` runs cheap regex and
substring checks against the edited file's content, mostly JS/TS and Python. On
a match it posts a reminder naming the sink and the safer alternative, so Claude
checks the change before moving on. No subprocess, no API call. The
`security-sinks` skill is the deeper half: it loads when you edit Terraform,
Python, JS/TS or GitHub Actions workflows and covers the sinks a regex cannot.

**What it costs.** It is advisory only. By the time a `PostToolUse` hook fires,
the write has already happened, so it never blocks — and on a file full of
legitimate sinks it repeats itself. It replaces a heavier plugin that ran an LLM
review on every edit and cost more than its rules were worth.

---

### `ans-command` — a typed command

`/ans` is answer-only mode: it reads and searches but never writes anything.

**Skills vs commands.** A skill fires on a description match, whether or not you
were thinking about it. A command fires only when you type it. Use a command
when you want deliberate control, a skill when you want the behaviour to apply
whether or not you remembered it.

**The rule for creating either: wait for the second or third real use.** Not the
first. A workflow that has happened once is an anecdote; a workflow that has
happened three times has a shape you can actually encode. Almost every skill
written on first use turns out to encode the wrong abstraction, and then you
have a file that is subtly wrong and loaded automatically — worse than nothing.

---

### `statusline` — context and cost on screen

**The problem.** Most spend on a long session is context re-transmission, and
by default there is no on-screen signal for how deep the context is or how much
quota is left. You find out when the session gets slow or the quota runs out.

**What it does.** A Node statusline that shows context %, quota % and session
cost on every render, so you `/compact` or `/clear` before the number gets bad
rather than after. It is written never to throw: a statusline that crashes shows
nothing, which is worse than a partial line. `node statusline.js --dump` writes
the raw payload to `payload-sample.json` beside the script, so you can check
field names against reality.

**What it costs.** Needs Node on `PATH`. Copy it to
`%USERPROFILE%\.claude\statusline\statusline.js`; the `statusLine` key in
`kit/settings.json` points there. Do not commit a `payload-sample.json` — it is
your session's metadata.

---

### `kg-runner` — the knowledge-graph pattern

**The problem.** Context is lost. A `/clear`, a compaction, or just the end of
the day, and the reason a thing was built that way is gone. Writing it in the
transcript does not help — nobody greps a transcript.

**What it does.** A `SessionStart` hook matches your working directory against a
registry of knowledge-graph repos and loads the matching one's index into
context. Durable project facts live in a git repo next to the code.
`kit/kg/registry.example.json` shows the shape: copy it to
`%USERPROFILE%\.claude\kg\registry.json` and point it at your own repos.

**The design choices worth copying even if you do not take the code:**

- **Registry-driven, not path-guessing.** A JSON file maps a directory-matching
  regex to a store. Explicit, greppable, and easy to see when it is wrong.
- **A per-user branch.** Each person writes to `kg/<username>` and merges
  deliberately. Without this, two people working the same project produce
  constant conflicts in the same index files and stop writing to it within a
  week.
- **The privacy gate asks rather than blocks.** Shared stores are team-visible
  and cannot be unpublished. Anything about people, careers or organisational
  politics belongs in a private local store, not a shared one. The gate prompts
  rather than refusing, because a gate that blocks gets worked around.

**What it costs.** This is the most expensive component in the kit by a wide
margin. A repo per project, a branch convention, and — the actual hard part — a
habit of writing to it. A knowledge graph nobody writes to is worse than no
knowledge graph, because people trust it and it is stale.

**Two known traps.** An entry pointing at a repo with **no git remote fails
quietly** — you get no error, just no knowledge. And if you have two copies of
the runner floating around, check which one you are running: a runner installed
by hand can drift from the canonical one and silently stop emitting part of its
output.

**Do not adopt this in week one.**

---

### `kg-update` — recording into the graph

The other half of `kg-runner`. Writes session findings, decisions and incidents
into the matching store in its own format, so recording knowledge is one command
rather than a chore that gets skipped.

**What it costs.** Useless without `kg-runner` and at least one registered
store — the installer enforces that dependency. It asks before writing anything
that looks personal rather than blocking, so you still have to read what it
proposes rather than accepting on autopilot.

**A habit worth building alongside it:** before declaring yourself blocked,
search the graph for how the thing was done before. A note saying one tool could
not do something is not proof the capability is gone.

---

### `servicenow-cr` — change request drafting

**What it does.** Drafts a stage or production change request: fills the form
fields, derives the risk-assessment answers, and produces a submission that
clears the automated quality check first time. Useful to anyone shipping into a
controlled environment, not just to one team.

**The caveat, and it matters.** The field definitions in this skill were
transcribed from a separate vendor change-request form repository, and **the
change windows stated there contradict the ones in the change-windows reference
that the same process publishes.** The skill's copy is a snapshot and the
authoritative form moves.

Confirm the current field list and the current windows against your own source
before you submit anything. Do not treat this skill as the system of record —
treat it as a fast first draft that still needs checking against the real form.

---

### `datadog-guard` — Datadog MCP writes go through Terraform

**The problem.** The Datadog role on the WSBC org grants MCP Write as well as
MCP Read, so a monitor create, edit or delete through the Datadog MCP server
succeeds and leaves a real change in the production org that no Terraform state
knows about. Datadog itself will not refuse.

**What it does.** A `PreToolUse` hook on Datadog MCP tools. Any tool whose name
does not start with a recognised read verb (`search_`, `get_`, `list_`, `load_`,
`aggregate_`, `analyze_`) prompts for permission, with a reason saying the
change belongs in Terraform. It is default-closed: an unrecognised tool asks
rather than passing, because new write tools appear whenever a toolset is
enabled and a list of known write verbs would miss the next one.

**What it costs.** It *asks*, never denies — an emergency change has to stay
possible, and a hard block would just get switched off. A genuinely read-only
tool with an unusual verb prompts once; add its prefix to `READ_VERBS` when that
happens. The prompt names the WSBC infrastructure repo; edit it if your
Terraform lives elsewhere. Only useful if you run the Datadog MCP plugin.

---

## Known traps

Things that cost real time to work out. None are this kit's fault; all of them
will bite you anyway.

**PowerShell 5.1 `ConvertFrom-Json` does not enumerate arrays the way you
expect.** A single-element array comes back as a bare object, so code that
iterates works on two entries and silently does nothing on one. This is fixed in
PowerShell 7, which is why `INSTALL.ps1` refuses to run on 5.1 — and why the
installer is written in 5.1-compatible *syntax*, so that the version check can
actually run and tell you, instead of the file failing to parse first.

**PowerShell 5.1 prepends a UTF-8 BOM when piping to a native process.** Your
JSON is byte-for-byte correct and `JSON.parse` still throws on the first
character, on input that a POSIX shell handles fine. Strip the leading
`U+FEFF` before parsing. Write it as an escape in your source, never as a literal
BOM character.

**Git Bash rewrites leading-slash arguments into Windows paths.** MSYS turns
`/mycommand` into `C:/Program Files/Git/mycommand` before your program sees it.
So testing a slash command via the Bash tool tests nothing — it never reached the
CLI in the form you typed. Verify from PowerShell.

**Quoted heredocs in Bash eat backslashes.** Doubled backslashes collapse to
single ones, so Windows paths embedded in a generated script break silently.
Build backslashes programmatically rather than literally.

**`gh repo list` truncates without `--limit`.** The default page size is small
and there is no warning that you got a partial answer. An inventory built from
an untruncated-looking list is simply wrong. Always pass `--limit`.

**A model's self-report about its own tools is not evidence.** If you want to
know whether a tool or a setting is actually in effect, observe the behaviour
from outside. Ask an agent what model it is running and you will get a confident
answer that may be wrong.

---

## What this kit deliberately does not contain

- **Role-specific and project-management skills and commands.** They encode one
  person's job and one organisation's ticket workflow. Nothing about the approach
  is secret; it just would not transfer.
- **Machine-specific integrations** — mail, desktop notifications, VM access.
  They depend on one machine's applications and network.
- **Any knowledge-graph content.** The machinery ships; the contents do not, and
  will not.
- **Memory.** It is one person's working notes, and much of it is about people.
- **Personal terms.** Empty arrays, filled in locally, never committed.
- **Credentials, permission allowlists, and enterprise-pushed settings.** None of
  `settings.local.json`, `remote-settings.json`, `policy-limits.json`,
  credential files or environment files are copied. If you fork this kit, keep it
  that way.

---

## What is still unresolved

Stated plainly, because confident documentation of an uncertain setup is worse
than none:

1. **Hook settings are not merged by `INSTALL.ps1`.** Files install; the `hooks`
   block in `kit/settings.json` has to be copied into your `settings.json` by
   hand. See the README.
2. **`servicenow-cr` may contradict the current change-request form**, and its
   change windows disagree with the published reference. Check your own source.
3. **Some mirrored files point at the author's private knowledge graph or at
   skills this kit does not ship** (for example a `local-kg` path in
   `plan-progress-tracker`). They are dangling references on your machine, not
   missing features. Ignore them or edit them out locally.

If you resolve any of these on your own machine, the fix belongs in this file.
