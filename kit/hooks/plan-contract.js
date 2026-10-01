#!/usr/bin/env node
// PreToolUse hook on ExitPlanMode: refuses to let a plan leave plan mode until it is a complete
// specification, so the model that executes it transcribes rather than designs.
//
// Why: a plan is the entire handoff channel between the model that decides and the model that
// builds. Every decision left out of the plan becomes an improvised decision at execution time,
// and improvised decisions do not agree with each other - which is what "it ran for 90 minutes
// and the result was full of inconsistencies" actually looks like.
//
// Why a hook rather than a skill: same reasoning as plan-accepted-jira.js:5-9. Skills load on
// model judgement, matched against their description. At plan-authoring time there is no user
// phrasing to match - so nothing reliably fires. A hook cannot be forgotten, and costs no tokens.
//
// Node rather than PowerShell to match the other hooks: ~197ms vs ~678ms startup.
//
// Why `## Sonnet-ready` is binary rather than a three-way tier (changed 2026-08-25): the section
// used to be `## Execution tier`, naming Haiku, Sonnet or Opus. Nothing could ever act on it. No
// hook return field changes the session model - the contract offers permissionDecision,
// additionalContext, updatedInput and systemMessage, and none of them touch model selection. The
// only mechanism that switches models across plan approval is the `opusplan` alias, and it is
// TWO-state: Opus while permission mode is `plan`, Sonnet the instant approval flips the mode. It
// never reads the plan. So a three-tier declaration could be honoured in exactly one of its three
// cases and silently betrayed in the other two - which is the failure that prompted this change,
// after plans declaring `Execution tier: Sonnet` executed on Opus 1M.
// The field now states the only thing that is both checkable and true: is this plan complete
// enough for Sonnet to transcribe? `Verdict: no` is primarily a signal the plan is not finished -
// the intended response is to go decide the open question, not to escalate the model.
//
// Reading the plan: payload.tool_input.plan carries the full text. NOTE this is undocumented -
// the ExitPlanMode schema declares no `plan` parameter and its description says the plan is read
// from the file the model wrote. It is populated anyway (verified 2026-08-25 from a live
// transcript). Because an undocumented field can vanish in a harness update, there is a disk
// fallback, and if BOTH fail the hook passes the plan but says so out loud. A gate that dies
// quietly is the exact failure this hook exists to prevent.
//
// Escape hatches, in order of bluntness:
//   1. `Contract: exempt - <reason>` in the plan, for genuinely trivial work.
//   2. CLAUDE_PLAN_CONTRACT=off in the environment, for when this hook itself is the problem.
//
// Must never break the turn: any internal error exits 0 silently.

const fs = require('fs');
const path = require('path');

// Tunables. MIN_ENFORCED_LINES keeps trivial plans frictionless; below it, a plan is only
// enforced if it actually proposes changing files.
const MIN_ENFORCED_LINES = 25;
const FALLBACK_MAX_AGE_MS = 10 * 60 * 1000;

const REQUIRED_SECTIONS = [
  ['context', 'the why, the problem, and the intended outcome'],
  ['decisions already made', 'every design call plus its rationale - anything missing here becomes an improvised decision at execution time'],
  ['preconditions', 'repo/branch/env, required files, and an explicit "if a precondition fails, STOP and ask"'],
  ['ground truth', 'file:line anchors for every site being changed, with current behaviour stated'],
  ['steps', 'ordered steps, each naming an exact target file'],
  ['out of scope', 'explicit do-not-touch paths'],
  ['documentation', 'a "Repo docs:" line naming the repo docs this change updates, or "none - <reason>"; every named path must appear in ## Steps'],
  ['verification', 'end-to-end acceptance criteria with binary pass/fail thresholds'],
  ['sonnet-ready', 'a `Verdict: yes` or `Verdict: no` line plus a one-line reason; `no` is an unconditional denial - settle the judgement, or mark the step under `## Steps` (`Opus: consult` / `execute` / `verify`) and list it on an `Escalations:` line'],
  ['escalation', 'what to do on ambiguity - it is a stop condition, not a judgement call'],
];

// Opus-executes mode, added 2026-09-28 when the budget rose to $2k/month. The Ctrl+Alt+O
// launcher sets CLAUDE_EXECUTOR=opus via launch-settings-opus.json, meaning there is no Sonnet
// executor for this session, so the Sonnet-ready section and its verdict/Escalations cross-check
// are dead weight. Absence of the var means orchestration (the prior, still-default behaviour) -
// a missing or broken flag fails strict, never loose.
const orchestration = () => process.env.CLAUDE_EXECUTOR !== 'opus';

// Phrases that defer a decision instead of making one. Scanned only within the operative
// sections listed below (see HEDGE_SCAN_SECTIONS) - narrative Context is deliberately excluded.
//
// CALIBRATION (2026-08-25, corrected after two bug fixes - see git history on this file):
//   56 plans in ~/.claude/plans, excluding *-progress.md. Denied 55, allowed 1 (the plan that
//   introduced this hook, verified compliant on merit by piping the real file through the hook
//   directly - not inferred from a green test suite). High denial is expected: the corpus
//   predates the contract and lacks `## Decisions already made`, `## Ground truth`,
//   `## Execution tier`, `## Escalation`. Zero residual hedge hits across the corpus after the
//   fixes below.
//   An EARLIER calibration run (before these fixes) reported "6 hedge hits, 2 independently
//   matching a real defect in find-the-optimization-sssion-steady-owl.md" - that claim was
//   itself wrong, caused by the bugs, and was corrected in local-kg (work/claude-setup-tracker.md)
//   rather than left standing. Both hits were this plan's OWN Context section quoting hedge
//   phrases as citations of that other file's defects, not matches within that file itself.
//   Fixed: (1) the exempt-hatch regex was unanchored and matched this plan's documentation of
//   the escape hatch mid-sentence, silently exempting the whole plan from every check; (2) after
//   anchoring to line-start, `\s*` before the reason capture matched across the newline, so a
//   bare "Contract: exempt -" swallowed the next line as a false reason; (3) the hedge scan
//   itself was whole-plan and could not tell a citation from a real hedge - fixed by restricting
//   it to HEDGE_SCAN_SECTIONS.
//   Re-run the calibration before adding a phrase to this list, or after changing its scope:
//   anything that fires on a plan you consider good is a false positive and comes back out.
const HEDGES = [
  'as appropriate',
  'or match whatever',
  'match whatever',
  'the session output above',
  "per the plan's own spec",
  'tbd',
  'figure out',
  'as needed',
  'and so on',
];

const EDIT_LANGUAGE = /\b(creat|add|edit|modify|writ|delet|refactor|implement)/i;

// A phrase written inside a code span is being NAMED, not used - a plan that documents the
// hedge list must not be denied for quoting it. Strip fenced blocks and inline code before
// scanning for hedges (but not before the other checks, which rely on backticked paths).
const stripCode = (text) =>
  text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');

// Split the plan into '## <heading>' sections. Returns a Map of lowercased heading -> body.
const sectionsOf = (text) => {
  const map = new Map();
  const lines = text.split('\n');
  let current = null;
  let buf = [];
  const flush = () => {
    if (current !== null) map.set(current, buf.join('\n'));
  };
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m && !/^###/.test(line)) {
      flush();
      current = m[1].toLowerCase().trim();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return map;
};

// --- Per-step Opus escalation markers ------------------------------------------------------
// A `### ` step may carry, immediately after its heading, one of:
//   Opus: consult - <named judgement>
//   Opus: execute - <reason>
//   Opus: verify - <what makes the outcome ambiguous>
// and `## Sonnet-ready` then names every marked step on an `Escalations:` line. The marker says
// which model does the step; the listing is the only thing stopping the two from drifting apart.
//
// Citation-vs-use, the same trap as the exempt hatch at :148-161: the first documents to carry
// markers are documents ABOUT markers - this contract's own plan, and plan-template.md, which has
// to quote the grammar in order to teach it. Two independent protections, deliberately redundant:
//   1. Anchored to COLUMN ZERO - no leading whitespace, no list marker, no backtick. Every
//      citation in the template is written as "- `Opus: consult - ...`", which cannot match.
//   2. Fenced blocks are blanked first, so an example inside a fence never registers.
// stripCode is NOT reused here. Its fence half collapses a block into a single space and merges
// the lines either side of it, which destroys the line-start anchoring this whole defence rests
// on; its inline half would empty the reason of a legitimate marker whose reason is written as a
// code span. Column zero does the citation work; fence-blanking is the belt to that braces.
//
// [ \t]* and never \s* before a (.*) capture: \s* matches the newline itself and lets the capture
// bleed into the NEXT line. A shipped bug in this file, not a hypothetical - see :154-156.
const MARKER_ANY = /^opus:[ \t]*(.*)$/i;
const MARKER_SHAPE = /^opus:[ \t]*(consult|execute|verify)[ \t]*-[ \t]*(.*)$/i;
const STEP_HEADING = /^###[ \t]+(.*)$/;

// Blank fenced regions while PRESERVING line structure, and normalise CRLF first: sectionsOf
// (:108) splits on a bare \n, so a trailing \r otherwise rides along inside every captured step
// name and marker reason, and the cross-check below then compares strings that can never be equal.
const fencedOutLines = (text) => {
  let inFence = false;
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => {
    if (/^[ \t]*```/.test(line)) {
      inFence = !inFence;
      return '';
    }
    return inFence ? '' : line;
  });
};

// Compare a step heading with an `Escalations:` entry. Strict equality produces cosmetic denials -
// `6`, `Step 6`, and `### 6. Add marker validation` are the same step - and a gate that denies for
// cosmetics is a gate that gets switched off.
const labelKey = (s) => s
  .replace(/[`*_]/g, '')
  .replace(/[ \t]+/g, ' ')
  .trim()
  .replace(/[.,;:]+$/, '')
  .toLowerCase();

const ordinalOf = (s) => {
  const m = /^(?:step[ \t]*)?#?(\d+)\b/.exec(labelKey(s));
  return m ? m[1] : null;
};

const titleOf = (s) => {
  const m = /^(?:step[ \t]*)?#?\d+[.):]?[ \t]*(.*)$/.exec(labelKey(s));
  return m && m[1].trim() ? m[1].trim() : labelKey(s);
};

const sameStep = (entry, stepName) => {
  const a = ordinalOf(entry);
  const b = ordinalOf(stepName);
  if (a && b) return a === b;
  return titleOf(entry) === titleOf(stepName);
};

// Collect the markers in `## Steps`, validating each one's shape. A malformed marker is a denial,
// not a silent pass - but it still registers as CLAIMING its step, so one bad marker does not also
// cascade into a spurious `Escalations:` mismatch for the same root cause.
const markersIn = (stepsText) => {
  const marks = [];
  const problems = [];
  let step = null;
  for (const line of fencedOutLines(stepsText)) {
    const heading = STEP_HEADING.exec(line);
    if (heading) {
      step = { name: heading[1].trim(), gated: false };
      continue;
    }
    if (MARKER_ANY.test(line)) {
      const shape = MARKER_SHAPE.exec(line);
      if (!step) {
        problems.push('`## Steps` has an `Opus:` marker before any `### ` step heading: "' + line.trim() + '". A marker names the step it sits in - put it immediately after that step\'s heading.');
      } else if (!shape || !shape[2].trim()) {
        problems.push('Malformed `Opus:` marker in `## Steps`: "' + line.trim() + '". The shape is exactly one of `Opus: consult - <named judgement>`, `Opus: execute - <reason>` or `Opus: verify - <what makes the outcome ambiguous>` - one of those three kinds, a hyphen, then a non-empty reason.');
        marks.push({ kind: null, step });
      } else {
        marks.push({ kind: shape[1].toLowerCase(), step, reason: shape[2].trim() });
      }
      continue;
    }
    if (step && /Verify:/.test(line)) step.gated = true;
  }
  for (const mark of marks) {
    if (mark.kind === 'verify' && !mark.step.gated) {
      problems.push('Step "' + mark.step.name + '" carries `Opus: verify` but has no `Verify:` gate of its own. The marker says who READS the gate\'s result, not that the gate is optional - state the runnable command and its binary pass condition.');
    }
  }
  return { steps: marks.map((m) => m.step.name), problems, marks };
};

// The `Escalations:` line in `## Sonnet-ready`, or null when there is none. Column-zero anchored
// and fence-blanked, for the same citation-vs-use reason as the markers above. Absent means `none`:
// measured 2026-09-15, ZERO of the 162 files in ~/.claude/plans carried this line, so requiring it
// unconditionally would newly deny the whole corpus instead of the marker-carrying plans.
const escalationsIn = (sonnetReadyText) => {
  for (const line of fencedOutLines(sonnetReadyText)) {
    const m = /^escalations:[ \t]*(.*)$/i.exec(line);
    if (m) {
      if (/^none$/i.test(m[1].trim())) return [];
      return m[1].split(/[,;]/).map((s) => s.trim()).filter((s) => s.length > 0);
    }
  }
  return null;
};

// --- `## Documentation` --------------------------------------------------------------------
// Why (added 2026-09-28): KG entries were reliably written at the end of work by kg-update, but
// repo docs - README, runbooks, CLAUDE.md, in-code comments - were the pipeline stage that simply
// did not happen. Nothing asked: the documentation skill fires on phrasing, and its own rule is
// "don't create docs unless asked". The section is compulsory; a document is not. `none - <reason>`
// is a valid answer, so the plan records a decision instead of a silence. KG entries are
// deliberately NOT declared here - that would duplicate the end-of-work kg-update.
//
// Column-zero and fence-blanked for the same citation-vs-use reason as escalationsIn above: the
// template quotes this grammar to teach it. Returns null (line absent), { none: reason } (reason
// may be '' - the caller denies that), or an array of named paths (possibly empty).
const docsIn = (documentationText) => {
  for (const line of fencedOutLines(documentationText)) {
    const m = /^repo docs:[ \t]*(.*)$/i.exec(line);
    if (!m) continue;
    const value = m[1].trim();
    const none = /^none\b[ \t]*(?:[-–—][ \t]*(.*))?$/i.exec(value);
    if (none) return { none: (none[1] || '').trim() };
    return value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return null;
};

// Fall back to the plan file on disk when the payload does not carry the text.
const readPlanFromDisk = () => {
  const dir = process.env.CLAUDE_PLAN_DIR ||
    path.join(process.env.USERPROFILE || '', '.claude', 'plans');
  const entries = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.endsWith('-progress.md'))
    .map((f) => {
      const full = path.join(dir, f);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (!entries.length) return null;
  // A stale match means we would be judging the wrong plan - better to pass and say so.
  if (Date.now() - entries[0].mtime > FALLBACK_MAX_AGE_MS) return null;
  return fs.readFileSync(entries[0].full, 'utf8');
};

const check = (plan) => {
  const problems = [];

  // Escape hatch 1: an explicit exemption with a stated reason. Anchored to the START of a
  // line (optional list marker/whitespace only before it) so that documentation ABOUT this
  // escape hatch - in this plan, in SKILL.md, in plan-template.md - never triggers it by
  // accident. Without the anchor, a plan that merely quotes "Contract: exempt - <reason>" as
  // an example mid-sentence would exempt itself from every other check, which is exactly the
  // kind of silent bypass this whole hook exists to prevent.
  // Note: [ \t]* (not \s*) right before the capture group - \s* would match the newline
  // itself and let the capture bleed into the NEXT line, turning a bare "Contract: exempt -"
  // into a false "reason" of whatever text happens to follow it. Found live via the test suite.
  const exempt = /^[-*]?\s*contract:\s*exempt\s*[-–—][ \t]*(.*)$/im.exec(plan);
  if (exempt) {
    if (exempt[1].trim().length > 0) return [];
    return ['`Contract: exempt` needs a reason after the dash. Say why the contract does not apply, or remove the line and meet it.'];
  }

  // Size gate: short plans that do not propose file changes are left alone.
  if (plan.split('\n').length < MIN_ENFORCED_LINES && !EDIT_LANGUAGE.test(plan)) return [];

  const sections = sectionsOf(plan);

  for (const [name, what] of REQUIRED_SECTIONS) {
    if (name === 'sonnet-ready' && !orchestration()) continue;
    if (!sections.has(name)) {
      problems.push('Missing `## ' + name.replace(/\b\w/g, (c) => c.toUpperCase()) + '` - add it: ' + what + '.');
    }
  }

  const ground = sections.get('ground truth');
  if (ground && !/[\w./\\-]+\.\w+:\d+/.test(ground)) {
    problems.push('`## Ground truth` has no `file:line` anchor. Name the exact locations being changed, e.g. `settings.json:14`, so the executor does not have to go looking.');
  }

  const steps = sections.get('steps');
  let markedSteps = [];
  if (steps) {
    if (!/execution order:/i.test(steps)) {
      problems.push('`## Steps` has no `Execution order:` line. State it, e.g. `Execution order: sequential` or `Execution order: 1-2 sequential; 3, 4 parallel (disjoint files)`. Parallel steps must write disjoint files.');
    }
    const stepCount = (steps.match(/^###\s+/gm) || []).length;
    const verifyCount = (steps.match(/Verify:/g) || []).length;
    if (stepCount > 0 && verifyCount < stepCount) {
      problems.push('`## Steps` has ' + stepCount + ' steps but only ' + verifyCount + ' `Verify:` gates. Every step needs one - a runnable command and a binary pass condition - so a wrong step is caught at that step instead of at the end.');
    }
    const markerResult = markersIn(steps);
    markedSteps = markerResult.steps;
    problems.push(...markerResult.problems);
  }

  const verification = sections.get('verification');
  if (verification && !/```|`[^`\n]+`/.test(verification)) {
    problems.push('`## Verification` has no runnable command. Add a fenced block with the exact command and its pass threshold, not a description of what to check.');
  }

  const documentation = sections.get('documentation');
  if (documentation !== undefined) {
    const docs = docsIn(documentation);
    if (docs === null) {
      problems.push('`## Documentation` has no `Repo docs:` line. Add one at column zero naming the repo docs this change updates (README, runbooks, CLAUDE.md, in-code comments), e.g. `Repo docs: README.md`, or `Repo docs: none - <reason>` when no doc changes.');
    } else if (!Array.isArray(docs)) {
      if (!docs.none) {
        problems.push('`Repo docs: none` needs a reason after a dash, e.g. `Repo docs: none - internal refactor, no behaviour change`. The reason is what makes `none` a decision rather than a skipped stage.');
      }
    } else if (docs.length === 0) {
      problems.push('`Repo docs:` is empty. Name the repo docs this change updates, or write `Repo docs: none - <reason>`.');
    } else {
      const stepsText = steps || '';
      for (const doc of docs) {
        if (!stepsText.includes(doc)) {
          problems.push('`Repo docs:` names "' + doc + '" but no step in `## Steps` mentions it. Add a `### ` step that updates it, with its own `Verify:` gate - a doc that is only declared is a doc that does not get written.');
        }
      }
    }
  }

  const sonnetReady = sections.get('sonnet-ready');
  if (sonnetReady && orchestration()) {
    const verdict = /^\s*verdict:\s*(yes|no)\b/im.exec(sonnetReady);
    if (!verdict) {
      problems.push('`## Sonnet-ready` has no verdict line. Add `Verdict: yes` or `Verdict: no`, plus a one-line reason.');
    } else if (verdict[1].toLowerCase() === 'no') {
      problems.push('`## Sonnet-ready` says `Verdict: no`. That is an unconditional denial - the plan is genuinely unfinished. Either settle the judgement and change the verdict to yes, or name it as a marked step (`Opus: consult` / `execute` / `verify`) under `## Steps` and list it on an `Escalations:` line, then change the verdict to yes.');
    }

    const escalations = escalationsIn(sonnetReady);
    if (markedSteps.length > 0) {
      if (escalations === null) {
        problems.push('`## Steps` has an `Opus:` marker but `## Sonnet-ready` has no `Escalations:` line. List every marked step, e.g. `Escalations: 6` - or `Escalations: none` when there are no markers.');
      } else {
        for (const stepName of markedSteps) {
          if (!escalations.some((e) => sameStep(e, stepName))) {
            problems.push('Step "' + stepName + '" carries an `Opus:` marker but is not named on the `Escalations:` line in `## Sonnet-ready`. Add it - the listing is what stops the marker and the escalation record from drifting apart.');
          }
        }
        for (const entry of escalations) {
          if (!markedSteps.some((s) => sameStep(entry, s))) {
            problems.push('`Escalations:` names "' + entry + '" but no step in `## Steps` carries a matching `Opus:` marker. Remove the stale entry, or add the marker to the step it refers to.');
          }
        }
      }
    } else if (escalations !== null && escalations.length > 0) {
      problems.push('`Escalations:` names step(s) but `## Steps` has no `Opus:` markers. Remove the line (or set it to `Escalations: none`), or add the marker to the step(s) it refers to.');
    }
  }

  // Hedge scan is scoped to the OPERATIVE sections only - not `## Context`. Context is
  // narrative by design ("argue why the change is worth making") and may legitimately quote
  // or cite a hedge phrase as an example of a past defect, exactly as this plan's own Context
  // does. Scanning the whole plan produced a real false positive here: a citation of another
  // plan's flaw ("...the session output above...") is not this plan deferring a decision.
  // Ground truth and Out of scope are also excluded - factual anchors and boundary lists,
  // low-risk for this failure mode, and Ground truth may legitimately quote existing code.
  const HEDGE_SCAN_SECTIONS = ['preconditions', 'decisions already made', 'steps', 'documentation', 'verification', 'sonnet-ready', 'escalation'];
  const scanText = HEDGE_SCAN_SECTIONS
    .map((name) => sections.get(name) || '')
    .join('\n')
    .toLowerCase();
  const scannable = stripCode(scanText);
  for (const hedge of HEDGES) {
    if (scannable.includes(hedge)) {
      problems.push('Hedge phrase "' + hedge + '" defers a decision instead of making it. Resolve it now, in the plan - that decision will otherwise be improvised at execution time.');
    }
  }

  return problems;
};

const deny = (reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
};

// Guarded so this file can also be `require()`d - by plan-accepted-jira.js, to brief the
// approval-time escalation message off the EXACT SAME marker parse enforced here, rather than a
// second regex that could drift looser and reintroduce the citation-vs-use bug this parse exists
// to prevent (see :136-148). require.main !== module during a require, so none of this attaches
// stdin listeners or calls process.exit - a plain `require('./plan-contract')` is side-effect-free.
if (require.main === module) {
  let input = '';
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    try {
      // Escape hatch 2: the blunt one. A logic bug here could otherwise make plan mode
      // inescapable, and the fail-open catch below only covers crashes, not bad judgement.
      if (process.env.CLAUDE_PLAN_CONTRACT === 'off') return process.exit(0);
      if (!input.trim()) return process.exit(0);

      const payload = JSON.parse(input);
      if (payload && payload.tool_name !== 'ExitPlanMode') return process.exit(0);

      let plan = payload && payload.tool_input && payload.tool_input.plan;
      if (typeof plan !== 'string' || !plan.trim()) {
        try {
          plan = readPlanFromDisk();
        } catch {
          plan = null;
        }
      }

      if (typeof plan !== 'string' || !plan.trim()) {
        // Fail open - but visibly. Silence here would recreate the failure mode this hook exists
        // to prevent: a gate that looks installed and checks nothing.
        process.stdout.write(JSON.stringify({
          systemMessage: 'Plan contract gate could not read the plan (no tool_input.plan and no recent plan file) - the plan was NOT checked. If this persists, the harness payload shape has changed.',
          suppressOutput: true,
        }));
        return process.exit(0);
      }

      const problems = check(plan);
      if (!problems.length) return process.exit(0);

      deny(
        'This plan is not yet executable by a model with no memory of this conversation. ' +
        problems.length + ' problem' + (problems.length === 1 ? '' : 's') + ' to fix:\n\n' +
        problems.map((p, i) => (i + 1) + '. ' + p).join('\n') +
        '\n\nEdit the plan file to fix these, then call ExitPlanMode again. ' +
        'If the contract genuinely does not apply, add a line: Contract: exempt - <reason>.'
      );
    } catch {
      // A broken gate must never break the session.
    }
    process.exit(0);
  });
}

module.exports = { sectionsOf, markersIn, escalationsIn, docsIn, sameStep, MARKER_SHAPE, STEP_HEADING, orchestration };
