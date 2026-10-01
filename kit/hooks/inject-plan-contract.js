// UserPromptSubmit hook. Puts the plan contract in context BEFORE a plan is written, once
// per session, so the ExitPlanMode gate (plan-contract.js) stops being the way the contract
// is learned and becomes what it was meant to be: a fail-safe that rarely fires.
//
// Why this exists: the contract is documented in skills/plan-progress-tracker/SKILL.md, but
// that skill triggers only AFTER a plan is approved. During authoring the rules were never in
// context, so plans were written blind and denied two or three times each - and a denial
// re-reads the whole plan, which on a 20 KB plan costs far more than this brief.
//
// Single source of truth: the ten headings are PARSED from references/plan-template.md at
// runtime rather than copied here. The contract already lived in three hand-synced places
// (the validator, SKILL.md, the template); a fourth copy would drift, and a brief that
// teaches rules the gate does not enforce is worse than no brief.
//
// Must never break the turn: any internal error exits 0 with empty stdout.
//
// Escape hatch: CLAUDE_PLAN_BRIEF=off
// Test overrides: CLAUDE_PLAN_TEMPLATE (template path), CLAUDE_PLAN_BRIEF_STATE (marker dir)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { orchestration } = require('./plan-contract');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');

const TEMPLATE_PATH = process.env.CLAUDE_PLAN_TEMPLATE ||
  path.join(CLAUDE_DIR, 'skills', 'plan-progress-tracker', 'references', 'plan-template.md');

// cache/ is gitignored, so markers never show up as tree noise.
const STATE_DIR = process.env.CLAUDE_PLAN_BRIEF_STATE ||
  path.join(CLAUDE_DIR, 'cache', 'plan-brief');

const REQUIRED_SECTION_COUNT = 10;

// The half a heading list cannot carry. Kept deliberately short: prose is what makes a brief
// expensive, and prose is not what fails. What fails is a missing heading or a missing
// mechanical marker.
const MECHANICAL_RULES = [
  '- Ground truth: at least one file.ext:123 anchor',
  '- Steps: open with "Execution order:"; each "### " step ends with "Verify:"',
  '- Documentation: "Repo docs: <paths>" or "Repo docs: none - <reason>"; named paths',
  '  must appear in Steps. KG entries stay with kg-update',
  '- Verification: a runnable command in a code fence',
  '- Banned in operative sections: as appropriate | match whatever | the session output',
  '  above | per the plan\'s own spec | tbd | figure out | as needed | and so on',
  '- Contract does not apply: "Contract: exempt - <reason>"',
];

// Only enforced when there is a Sonnet executor to hand the plan to (see plan-contract.js's
// own orchestration() - same test, so the brief and the gate can't disagree). Omitted entirely
// in Opus-executes mode (CLAUDE_EXECUTOR=opus), where nothing reads Sonnet-ready or dispatches
// a marked step to opus-consult/opus-step.
const ORCHESTRATION_RULES = [
  '- Sonnet-ready: "Verdict: yes" ("no" is denied) plus "Escalations: <steps>" or "none"',
  '- A step may carry, right after its heading, "Opus: consult|execute|verify - <reason>";',
  '  list every marked step on Escalations:',
];

const readSections = () => {
  const text = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return text.split(/\r?\n/)
    .filter((line) => /^## \S/.test(line))
    .map((line) => line.trim());
};

const renderBrief = (sections) => {
  const orch = orchestration();
  const shownSections = orch ? sections : sections.filter((s) => s !== '## Sonnet-ready');
  const rules = orch ? MECHANICAL_RULES.concat(ORCHESTRATION_RULES) : MECHANICAL_RULES;
  return [
    // A single no-space token, not "Mode: X" - the brief is budget-tested at under 250 tokens
    // (see test-inject-plan-contract.js "brief under 250 tokens") and was already within one
    // word of that cap in orchestration mode before this annotation existed.
    'PLAN CONTRACT - checked at ExitPlanMode; a failing plan is DENIED. ' +
      '[mode=' + (orch ? 'orchestration' : 'opus') + ']',
    '',
    'Sections, in order:',
    shownSections.map((s, i) => (i + 1) + '. ' + s).join('\n'),
    '',
    'Checks:',
    rules.join('\n'),
    '',
    'Skeleton: ' + TEMPLATE_PATH,
  ].join('\n');
};

// A marker per session id. UserPromptSubmit fires on every turn, so without this the brief
// would compound for the life of the session - the opposite of the point.
const markerFor = (sessionId) =>
  path.join(STATE_DIR, sessionId.replace(/[^A-Za-z0-9._-]/g, '_') + '.marker');

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    if (process.env.CLAUDE_PLAN_BRIEF === 'off') return process.exit(0);

    // Strip a leading UTF-8 BOM. Claude Code writes clean JSON, but PowerShell 5.1 prepends a
    // BOM to anything it pipes, which made this hook look silently broken when it was driven
    // from a PowerShell prompt. Costs one character and changes nothing on clean input.
    const text = input.replace(/^\uFEFF/, '');
    if (!text.trim()) return process.exit(0);

    const payload = JSON.parse(text);
    if (!payload || payload.permission_mode !== 'plan') return process.exit(0);

    // /ans is answer-only - it cannot write a plan, so the contract is dead weight there and,
    // worse, reads as pressure to produce a plan the command forbids. Skipped BEFORE the
    // marker is claimed below, so an /ans question never costs the session its one real brief.
    const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
    if (/^\s*\/ans(\s|$)/.test(prompt)) return process.exit(0);

    // No session id means no way to dedupe, and a brief that repeats every turn is worse
    // than no brief at all.
    const sessionId = payload.session_id;
    if (typeof sessionId !== 'string' || !sessionId.trim()) return process.exit(0);

    const marker = markerFor(sessionId);
    if (fs.existsSync(marker)) return process.exit(0);

    // Claim the session BEFORE emitting. If anything below throws, the cost is one missing
    // brief; claiming afterwards would risk emitting on every turn instead.
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(marker, new Date().toISOString());

    let sections;
    try {
      sections = readSections();
    } catch {
      sections = null;
    }

    if (!sections || sections.length !== REQUIRED_SECTION_COUNT) {
      // Fail open - but VISIBLY. Silence here would recreate the failure this hook exists to
      // fix: a brief that looks installed and teaches nothing. Same principle as the gate's
      // unreadable-plan path in plan-contract.js.
      process.stdout.write(JSON.stringify({
        systemMessage: 'Plan contract brief was NOT injected: ' + TEMPLATE_PATH +
          ' did not yield ' + REQUIRED_SECTION_COUNT + ' "## " headings (found ' +
          (sections ? sections.length : 'no readable file') +
          '). The ExitPlanMode gate still applies, so plans will be checked but not pre-briefed.',
        suppressOutput: true,
      }));
      return process.exit(0);
    }

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: renderBrief(sections),
      },
    }));
  } catch {
    // A broken brief must never break the session.
  }
  process.exit(0);
});
