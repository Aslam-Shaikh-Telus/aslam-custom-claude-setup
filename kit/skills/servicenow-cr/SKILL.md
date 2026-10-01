---
name: servicenow-cr
description: Use when drafting a ServiceNow or THFLOW change request for a stage or production change — raising, opening, drafting or preparing a CR or change record, filling CR fields, answering the TELUS Health Change Risk Assessment, or fixing a change the submission-quality bot bounced. Triggers on ServiceNow, THFLOW, CR, change request, change record, CHG, change ticket, CAB, prod change, production deployment change, submission quality, risk assessment, change window kickback.
argument-hint: stage | prod
---

# ServiceNow / THFLOW change request drafting

Produces a paste-ready ASCII text file of CR field values. Aslam opens the record in the portal
and pastes each field in; this skill never submits anything.

## Why this skill exists

TELUS Health runs a bot over every submission, and it scores **two independent things**:

1. **Submission Quality** — a 12-criteria score on whether the narrative fields are good enough.
2. **Risk Assessment consistency** — a cross-read of the six Risk Assessment dropdowns against
   the narrative fields.

Passing one does not pass the other. A real record scored `Submission Quality: PASS (12/12)` and
was still bounced with:

> - The answer 'The Change cannot be tested' contradicts the detailed test plan present in the narrative.
> - The answer 'Moderate (outage not expected, but possible)' contradicts the narrative stating 'no service interruption'.
> - The answer 'Easy (Change can be rolled back by a single team within the Change Window)' contradicts the backout plan which indicates a more complex rollback process.

This is by design. The Change Submission Quality Guide specifies every Risk Assessment row as a
*derivation*, not an opinion — "Matches what is stated in justification and plan", "Matches what
is stated in the test plan", "Matches what is stated in the backout plan".

**So never ask which risk answer to pick, and never pick one by feel. Derive all six from the
narrative, then prove each one against the sentence it came from.**

## Read these before drafting

| Need | Read |
|---|---|
| How to derive each of the six risk answers, the verbatim option strings, and the guards | [references/risk-derivation.md](references/risk-derivation.md) |
| What each narrative field must contain to score | [references/field-guide.md](references/field-guide.md) |
| The exact output skeleton | [references/output-template.txt](references/output-template.txt) |
| Field labels and their portal tabs, verbatim | `C:\GitHub\vendor-change-request-form\extract-cr-form.py:23-35` (`SERVICENOW_MAP`) — read-only |
| The underlying authority for field quality and risk derivation | `%USERPROFILE%\Downloads\Change_Submission_Quality_Guide_TELUS_Health.pdf` |

## Getting the content

- **Use the session first.** If the change was just built in this session, or there is a plan file,
  a `<feature>-progress.md`, a PR diff or a KG entry describing it, draft from that. Do not
  re-interview for anything already on the table.
- **Then interview only the gaps.** Ask for what genuinely cannot be known: who executes, who
  validates and when, where validation evidence is stored, whether a comparable environment
  exists, and which environments this CR covers.
- **Ask in one batch, not one question at a time.**

## Fields this skill drafts

Eleven fields across four ServiceNow tabs, labelled verbatim from `SERVICENOW_MAP`. Nine are
drafted from the narrative; `Conflicts` and `Related records` are author actions unless the
session already supplies the value. Field-by-field table and the content each one needs to
score: [references/field-guide.md](references/field-guide.md).

## Hard rules

- **Never emit a schedule value.** No planned start, no planned end, no change window, no CAB
  required, no CAB date, no CAB delegate. Do not discuss or reason about change windows at all.
  Aslam fills these in the portal.
- **Never emit a service or CI value.** No Company, Service Portfolio, Service, Service Offering,
  Application Service, Environment or Configuration Item. Same reason.
- **Never invent a Conflict or a Related record.** Conflicts requires the ServiceNow conflict
  checker. Emit the author-action marker instead.
- **Never invent an assignment group.**
- **Write Implementation plan, Backout plan and Test plan steps as imperative first-person
  instructions**, not third-person actor descriptions — `1. Reboot hcsp12sql.`, never
  `1. The implementation team reboots hcsp12sql.` If a step is performed by a different actor
  than the primary executor (e.g. an escalation step for on-call), name that actor explicitly in
  the step, since imperative voice would otherwise wrongly imply the primary executor performs
  it. Non-step lines (`Teams required:`, `Notification - before/after:`, `Tester:`) stay
  descriptive.
- **Risk answers are quoted verbatim from the portal dropdowns** — exact parentheses, spacing and
  capitalisation. A paraphrase is a defect; the bot matches on the string.
- **One file per change.** If the same change lands in both stage and prod, emit a single file
  holding two complete drafts, Part A then Part B — not two files.
- **Risk answers are computed per environment.** Stage and prod legitimately differ, most often on
  Q2 (customers affected) and Q3 (impact to service). Each part carries its own risk block.
- **ASCII only.** No smart quotes, no en-dashes, no box-drawing. ServiceNow fields are plain
  textareas.
- **No markdown in the output.** No pipe tables, no `**bold**`, no backtick fences. Those paste
  as literal characters.

## Write for the approver

The reader is a CAB member deciding whether to approve. Every line must help that decision.
Anything aimed at the person preparing the record does not belong in the record.

**Do not emit:**

- paste instructions, drafting narration, or notes about the document itself;
- author to-dos inside a field body - a field is read as fact, so a pending item goes in the
  AUTHOR ACTIONS checklist, never inline;
- troubleshooting tips and diagnostic anecdotes aimed at whoever executes;
- argument about whether the change is a good idea - describe it, do not advocate for it;
- restating in one field what another field already says;
- multi-line scaffolding for a field carrying no content - one line is enough.

**When a value is genuinely unknown, mark it, do not narrate it.** Write a bracketed placeholder
in place of the value - `<<TBD: per-node restart durations>>` - and put the explanation and the
action in the AUTHOR ACTIONS checklist. Never write a sentence beginning "AUTHOR ACTION" inside a
field body: the approver reads a field as a statement of fact, and a to-do in that position reads
as an unfinished record. One placeholder, a few words, no prose.

**Keep in full, without exception:** the Implementation plan, Backout plan and Test plan. The
quality guide requires any peer to execute them unaided, so detail there is the requirement, not
bloat. Never merge, elide or summarise a step.

**When a plan is genuinely long,** attach it as a runbook rather than compressing it. The guide
permits this provided the attachment meets the same standard. Say in the field that the runbook is
attached and give its name.

The discursive fields - Description, Justification, Risk and impact analysis, Outage / service
impact - are where conciseness applies. State the facts the approver weighs and stop.

## Output

- Write to `%USERPROFILE%\Downloads\`.
- Filename `<slug>-CR.txt` for a combined stage+prod draft; `<slug>-CR-<env>.txt` for a single
  environment. Slug is the system plus the change, e.g. `healthenl-cert-CR.txt`.
- **If the target file already exists, stop and ask.** Never silently overwrite a draft.
- Follow [references/output-template.txt](references/output-template.txt) exactly.
- **Never hard-wrap a field body.** Each paragraph, numbered step, lettered sub-step and labelled
  line (`If it fails:`, `Notification - before:`, `Tester:`) is one physical line, however long.
  Only the banner, divider and `end of field` lines are fixed at 62 columns. The author pastes each
  field into ServiceNow verbatim, so a line break inside a sentence lands in the CR as a ragged break.
- **Short description is at most 160 characters.** ServiceNow cuts it off at 160 with no
  warning (observed 2026-09-28). Count before writing; if it is over, rewrite it shorter. Never
  truncate mid-word.
- After writing, tell the user the full path and list anything left as an author action.

## Run the six guards before writing anything

Derive all six risk answers, then check each guard. **A tripped guard blocks emission.** Do not
write the file, and do not quietly swap in the answer that passes.

| Q | Guard - emission is blocked when | Read against |
|---|---|---|
| Q1 | the implementation plan names two or more teams, but the answer is `Not complex` | Implementation plan |
| Q2 | the answer is `All` on a non-production part; or the answer is `None` while Outage / service impact declares a user-visible effect | Description, Risk and impact analysis, Outage / service impact |
| Q3 | the narrative says no service interruption / no impact / no downtime, but the answer is `Moderate` or `Significant` | Outage / service impact, Description |
| Q4 | the Test plan holds executable steps, but the answer is `The Change cannot be tested` | Test plan |
| Q5 | validation is deferred to a later day or a soak period, but the answer is `Easy`; or the customer is the verifier and the answer is not `Difficult` | Test plan |
| Q6 | the backout plan names two or more teams or two or more separately-operated systems, but the answer is `Easy`; or there is no executable reversal and the answer is not `Difficult`; or **any** narrative field says a component cannot be backed out, while the answer is `Easy` or `Medium` | Backout plan, Backout duration, **and every other field** |

**A guard reads the whole document, not just its source field.** The bot cross-reads every
risk answer against the entire narrative, so a contradiction anywhere trips the guard. Narrowing
a guard to one field is how a contradiction gets through - for example, a backout plan that is
clean on its own while the risk analysis says a component cannot be reversed.

**Scoping a component out of one field does not scope it out of the record.** If a component is
named in the Description but excluded from the Backout plan, the record still contains both
statements and the bot still reads both. Either remove the component from the change entirely, or
answer for the change as it actually stands. An author-action note is not a substitute for either.

Q3, Q4 and Q6 are the three the bot has actually caught. See
[references/risk-derivation.md](references/risk-derivation.md) for each worked through.

**When a guard trips, the contradiction is real and one side is wrong.** Say which two fields
disagree, quote both, and ask which to change. Never resolve it by choosing the answer that makes
the guard pass - that is exactly the failure mode this skill exists to stop.

## Emit the consistency self-check

Every generated file ends with a `CONSISTENCY SELF-CHECK - DO NOT PASTE` block: one line per
answer, `Q<n> <verbatim answer string>`, grouped under `PART A` and `PART B`. No quoted source
sentences, no guard walkthrough - the guards already ran and blocked before anything was written.
The block exists so a kickback can be matched against what was actually submitted. Keep it to 20
lines or fewer.
