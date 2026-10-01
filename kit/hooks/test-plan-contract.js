// Tests for plan-contract.js. Plain Node assertions, no framework - matches test-guard-commands.js.
// Run: node test-plan-contract.js   (exit 0 = all pass)

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = process.env.USERPROFILE + '\\.claude\\hooks\\plan-contract.js';

// An empty directory so the disk fallback finds nothing during tests, instead of picking up
// whatever real plan happened to be written most recently.
const EMPTY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-contract-test-'));

// A plan that satisfies every check. Each mutation below breaks exactly one thing.
const GOOD = [
  '# Test plan',
  '',
  '## Context',
  'Why this exists, the problem it solves, and the intended outcome.',
  '',
  '## Decisions already made',
  '| Decision | Rationale |',
  '|---|---|',
  '| Use Node | Matches the existing hooks |',
  '',
  '## Preconditions',
  '- `node --version` succeeds.',
  '- If a precondition fails, STOP and ask.',
  '',
  '## Ground truth',
  '| Location | Current state |',
  '|---|---|',
  '| `settings.json:14` | model is opus[1m] |',
  '',
  '## Steps',
  'Execution order: sequential - each step depends on the previous.',
  '',
  '### 1. Change the first file',
  'Edit `foo.js` and add the bar function.',
  '**Verify:** `node foo.js` -> prints ok.',
  '',
  '### 2. Change the second file',
  'Edit `baz.js` and add the qux function.',
  '**Verify:** `node baz.js` -> exit 0.',
  '',
  '## Out of scope',
  '- `settings.json:14` - untouched.',
  '',
  '## Documentation',
  'Repo docs: none - fixture has no user-facing change',
  '',
  '## Verification',
  '```bash',
  'node test.js',
  '```',
  '**Pass: exit 0.**',
  'Falsification test: corrupt the input and confirm it now fails.',
  '',
  '## Sonnet-ready',
  'Verdict: yes',
  'Plan names exact files and insert points; content is specified above.',
  '',
  '## Escalation',
  'Ambiguity is a stop condition. Stop and ask.',
].join('\n');

// Short, with no file-modification language - below the size gate.
const SHORT = ['# Quick question', '', '## Context', 'Answer whether log rotation runs nightly.'].join('\n');

// Remove a whole '## <heading>' section from the good plan.
const drop = (heading) => {
  const lines = GOOD.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## ' + heading);
  if (start === -1) throw new Error('fixture has no section: ' + heading);
  let end = start + 1;
  while (end < lines.length && !/^## /.test(lines[end])) end++;
  return lines.slice(0, start).concat(lines.slice(end)).join('\n');
};

const sub = (from, to) => {
  if (!GOOD.includes(from)) throw new Error('fixture does not contain: ' + from);
  return GOOD.split(from).join(to);
};

// Apply several replacements in sequence, each checked against the text left by the one before
// it. Most marker fixtures need two or three edits (a marker line in ## Steps, an Escalations:
// line in ## Sonnet-ready, sometimes a removed Verify: gate) - sub() only applies one.
const mut = (...pairs) => {
  let text = GOOD;
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error('fixture does not contain: ' + from);
    text = text.split(from).join(to);
  }
  return text;
};

const EXEMPT_OK = ['# Stub', '', '## Context', 'Contract: exempt - trivial one-line fix in `a.js`. Edit it.']
  .concat(new Array(30).fill('Filler line to clear the size gate.')).join('\n');
const EXEMPT_BARE = ['# Stub', '', '## Context', 'Contract: exempt -']
  .concat(new Array(30).fill('Edit the file.')).join('\n');

// --- Per-step Opus escalation marker fixtures -----------------------------------------------
// A marker attaches immediately after a step heading; the matching Escalations: line goes in
// ## Sonnet-ready right after Verdict: yes. All markers below sit on step 1, which keeps its own
// Verify: gate except in MARK_VERIFY_NO_GATE, where removing that gate is the point of the case.
const MARK_CONSULT = mut(
  ['### 1. Change the first file\n', '### 1. Change the first file\nOpus: consult - which retry backoff curve to use\n'],
  ['Verdict: yes\n', 'Verdict: yes\nEscalations: 1\n'],
);
const MARK_EXECUTE = mut(
  ['### 1. Change the first file\n',
    '### 1. Change the first file\nOpus: execute - the login flow is interactive and its output cannot be known in advance\n'],
  ['Verdict: yes\n', 'Verdict: yes\nEscalations: 1\n'],
);
const MARK_VERIFY = mut(
  ['### 1. Change the first file\n',
    '### 1. Change the first file\nOpus: verify - whether the printed output actually satisfies the pass condition\n'],
  ['Verdict: yes\n', 'Verdict: yes\nEscalations: 1\n'],
);
const MARK_NEAR_MISS_KIND = mut(
  ['### 1. Change the first file\n', '### 1. Change the first file\nOpus: consults - some reason here\n'],
  ['Verdict: yes\n', 'Verdict: yes\nEscalations: 1\n'],
);
const MARK_EMPTY_REASON = mut(
  ['### 1. Change the first file\n', '### 1. Change the first file\nOpus: consult -\n'],
  ['Verdict: yes\n', 'Verdict: yes\nEscalations: 1\n'],
);
const MARK_NO_ESCALATIONS_LINE = mut(
  ['### 1. Change the first file\n', '### 1. Change the first file\nOpus: consult - which retry backoff curve to use\n'],
);
const MARK_ESCALATIONS_MISMATCH = mut(
  ['### 1. Change the first file\n', '### 1. Change the first file\nOpus: consult - which retry backoff curve to use\n'],
  ['Verdict: yes\n', 'Verdict: yes\nEscalations: 2\n'],
);
const MARK_VERIFY_NO_GATE = mut(
  ['### 1. Change the first file\n',
    '### 1. Change the first file\nOpus: verify - whether the printed output actually satisfies the pass condition\n'],
  ['**Verify:** `node foo.js` -> prints ok.\n', ''],
  ['Verdict: yes\n', 'Verdict: yes\nEscalations: 1\n'],
);
const MARK_IN_FENCE = sub(
  '**Verify:** `node foo.js` -> prints ok.\n\n### 2. Change the second file',
  '**Verify:** `node foo.js` -> prints ok.\n\n```text\nOpus: consult - example marker syntax, quoted as documentation\n```\n\n### 2. Change the second file',
);
const ESCALATIONS_NONE = sub('Verdict: yes\n', 'Verdict: yes\nEscalations: none\n');

const cases = [
  // [name, plan, expected]
  ['complete plan',           GOOD,                                             'allow'],
  ['short plan, size gate',   SHORT,                                            'allow'],
  ['missing Verification',    drop('Verification'),                             'DENY'],
  ['missing Context',         drop('Context'),                                  'DENY'],
  ['missing Decisions',       drop('Decisions already made'),                   'DENY'],
  ['missing Ground truth',    drop('Ground truth'),                             'DENY'],
  ['missing Out of scope',    drop('Out of scope'),                             'DENY'],
  ['missing Escalation',      drop('Escalation'),                               'DENY'],
  ['missing Sonnet-ready',    drop('Sonnet-ready'),                             'DENY'],
  ['no verdict line',         sub('Verdict: yes', 'This one is fine for Sonnet.'), 'DENY'],
  ['bad verdict value',       sub('Verdict: yes', 'Verdict: maybe'),            'DENY'],
  ['verdict no, unjustified', sub('Verdict: yes', 'Verdict: no'),               'DENY'],
  ['verdict no, justified',   sub('Verdict: yes',
                                  'Verdict: no\nNeeds Opus for: choosing the retry backoff curve.'), 'DENY'],
  ['verdict yes',             GOOD,                                             'allow'],
  ['no Execution order',      sub('Execution order: sequential - each step depends on the previous.',
                                  'Do them in order.'),                         'DENY'],
  ['parallel order line',     sub('Execution order: sequential - each step depends on the previous.',
                                  'Execution order: 1, 2 parallel (disjoint files).'), 'allow'],
  ['no file:line anchor',     sub('| `settings.json:14` | model is opus[1m] |',
                                  '| the settings file | model is opus |'),     'DENY'],
  ['verification has no cmd', sub('```bash\nnode test.js\n```\n', ''),           'DENY'],
  ['hedge: as appropriate',   sub('Edit `foo.js` and add the bar function.',
                                  'Edit the file as appropriate.'),             'DENY'],
  ['hedge: TBD',              sub('Edit `baz.js` and add the qux function.',
                                  'Edit `baz.js`. Details TBD.'),               'DENY'],
  ['hedge: match whatever',   sub('Edit `baz.js` and add the qux function.',
                                  'Edit `baz.js` or match whatever the layout is.'), 'DENY'],
  ['hedge: session output',   sub('Edit `baz.js` and add the qux function.',
                                  'Content is in the session output above.'),   'DENY'],
  ['hedge: figure out',       sub('Edit `baz.js` and add the qux function.',
                                  'Figure out the right shape and apply it.'),  'DENY'],
  ['fewer Verify than steps', sub('**Verify:** `node baz.js` -> exit 0.', 'Done when it works.'), 'DENY'],
  ['exempt with reason',      EXEMPT_OK,                                        'allow'],
  ['exempt with no reason',   EXEMPT_BARE,                                      'DENY'],
  // Regression: a plan that merely DOCUMENTS the escape hatch mid-sentence (as this contract's
  // own template and this very test file's plan do) must NOT be treated as self-exempting.
  // Found live: the plan that introduced this hook quoted "Contract: exempt - <reason>" while
  // describing its own test cases, and an earlier unanchored regex exempted the whole plan.
  ['exempt mentioned in prose, still missing sections',
    drop('Verification') + '\n\nNote: see the `Contract: exempt - <reason>` escape hatch above.',
    'DENY'],
  // Per-step Opus escalation markers (Step 8).
  ['opus marker: consult, valid',              MARK_CONSULT,               'allow'],
  ['opus marker: execute, valid',               MARK_EXECUTE,               'allow'],
  ['opus marker: verify, valid (gated)',        MARK_VERIFY,                'allow'],
  ['opus marker: near-miss kind',                MARK_NEAR_MISS_KIND,       'DENY'],
  ['opus marker: empty reason',                  MARK_EMPTY_REASON,         'DENY'],
  ['opus marker: no Escalations: line',           MARK_NO_ESCALATIONS_LINE, 'DENY'],
  ['opus marker: Escalations: mismatch',          MARK_ESCALATIONS_MISMATCH,'DENY'],
  ['opus marker: verify with no Verify: gate',    MARK_VERIFY_NO_GATE,      'DENY'],
  ['opus marker quoted inside a fenced block',    MARK_IN_FENCE,            'allow'],
  ['Escalations: none, no markers',               ESCALATIONS_NONE,         'allow'],
];

let pass = 0;
let fail = 0;

const run = (payload, env) => {
  try {
    return execFileSync('node', [HOOK], {
      input: payload,
      encoding: 'utf8',
      // CLAUDE_EXECUTOR: '' pins orchestration mode for every case below regardless of the
      // real environment the test happens to run in (e.g. a Ctrl+Alt+O session, which sets
      // CLAUDE_EXECUTOR=opus for itself). Opus-mode cases override it explicitly.
      env: Object.assign({}, process.env, { CLAUDE_PLAN_DIR: EMPTY_DIR, CLAUDE_EXECUTOR: '' }, env || {}),
    });
  } catch (e) {
    return 'HARNESS-ERROR ' + e.message;
  }
};

const report = (name, expected, got) => {
  const ok = got === expected;
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name.padEnd(26) + ' expect=' + String(expected).padEnd(5) + ' got=' + got);
};

const decisionOf = (out) => (/"permissionDecision":"deny"/.test(out) ? 'DENY' : 'allow');
const withPlan = (plan, env) => run(JSON.stringify({ tool_name: 'ExitPlanMode', tool_input: { plan } }), env);

for (const [name, plan, expected] of cases) {
  report(name, expected, decisionOf(withPlan(plan)));
}

// Kill switch: a plan that would otherwise be denied must pass.
report('kill switch off', 'allow', decisionOf(withPlan(drop('Verification'), { CLAUDE_PLAN_CONTRACT: 'off' })));

// Wrong tool: never fires.
report('other tool_name', 'allow',
  decisionOf(run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }))));

// Malformed stdin: fail open, silently.
const malformed = run('not json at all{{');
report('malformed stdin', 'allow', decisionOf(malformed));
report('malformed is silent', 'yes', malformed.trim() === '' ? 'yes' : 'no');

// No plan available anywhere: fail OPEN, but VISIBLY. A gate that dies quietly is the exact
// failure mode this hook exists to prevent.
const noPlan = run(JSON.stringify({ tool_name: 'ExitPlanMode', tool_input: {} }));
report('no plan fails open', 'allow', decisionOf(noPlan));
report('no plan warns user', 'yes', /systemMessage/.test(noPlan) ? 'yes' : 'no');

// A passing plan produces no output at all - no congratulation.
report('good plan is silent', 'yes', withPlan(GOOD).trim() === '' ? 'yes' : 'no');

// Denial reasons must be actionable, not just "missing section".
report('reason names section', 'yes', /Verification/.test(withPlan(drop('Verification'))) ? 'yes' : 'no');
report('reason quotes hedge', 'yes',
  /as appropriate/.test(withPlan(sub('Edit `foo.js` and add the bar function.', 'Edit the file as appropriate.'))) ? 'yes' : 'no');

// Removing step 1's own Verify: gate also trips the pre-existing step-count check ("fewer Verify
// than steps"), which would DENY this fixture for the wrong reason and hide a silent regression in
// the new check. Assert the specific reason text, not just the decision.
report('reason names verify-without-gate', 'yes',
  /has no `Verify:` gate of its own/.test(withPlan(MARK_VERIFY_NO_GATE)) ? 'yes' : 'no');

// --- ## Documentation: a decision is compulsory, a document is not --------------------------
// Each case asserts the decision AND the specific reason, so a denial for some unrelated
// cause cannot pass for the documentation check working.
const NONE_LINE = 'Repo docs: none - fixture has no user-facing change';
const docCase = (name, plan, expected, reason) => {
  const out = withPlan(plan);
  report('docs: ' + name, expected, decisionOf(out));
  if (reason) report('docs: ' + name + ' reason', 'yes', reason.test(out) ? 'yes' : 'no');
};

docCase('section removed', drop('Documentation'), 'DENY', /Missing `## Documentation`/);
docCase('line removed', sub(NONE_LINE + '\n', ''), 'DENY', /has no `Repo docs:` line/);
docCase('bare none', sub(NONE_LINE, 'Repo docs: none'), 'DENY', /needs a reason after a dash/);
docCase('none with em dash', sub(NONE_LINE, 'Repo docs: none — no user-facing change'), 'allow');
docCase('empty value', sub(NONE_LINE, 'Repo docs:'), 'DENY', /`Repo docs:` is empty/);
docCase('named doc absent from steps', sub(NONE_LINE, 'Repo docs: README.md'), 'DENY',
  /names \\?"README\.md\\?" but no step/);
docCase('named doc in a step', mut(
  [NONE_LINE, 'Repo docs: README.md'],
  ['Edit `baz.js` and add the qux function.', 'Edit `baz.js` and add the qux function; document it in `README.md`.'],
), 'allow');
docCase('line only inside a fence', sub(NONE_LINE, '```text\n' + NONE_LINE + '\n```'), 'DENY',
  /has no `Repo docs:` line/);
docCase('hedge in documentation', sub(NONE_LINE, 'Repo docs: none - update docs as needed'), 'DENY',
  /as needed/);

// --- Opus-executes mode (CLAUDE_EXECUTOR=opus): Sonnet-ready is not enforced --------------
const OPUS_ENV = { CLAUDE_EXECUTOR: 'opus' };
report('opus mode: complete plan', 'allow', decisionOf(withPlan(GOOD, OPUS_ENV)));
report('opus mode: no Sonnet-ready', 'allow', decisionOf(withPlan(drop('Sonnet-ready'), OPUS_ENV)));
report('opus mode: verdict no ignored', 'allow', decisionOf(withPlan(sub('Verdict: yes', 'Verdict: no'), OPUS_ENV)));
report('opus mode: no Escalation', 'DENY', decisionOf(withPlan(drop('Escalation'), OPUS_ENV)));
report('opus mode: no Verification', 'DENY', decisionOf(withPlan(drop('Verification'), OPUS_ENV)));

// --- Drift: the contract's three copies must agree ---------------------------------------
// REQUIRED_SECTIONS in plan-contract.js, the skeleton in references/plan-template.md, and the
// numbered list in SKILL.md are three hand-synced copies of one contract. inject-plan-contract.js
// parses the TEMPLATE at runtime to build its pre-plan brief, so a rename made here that misses
// the template would silently brief a contract the gate does not enforce - a wrong brief being
// worse than none. This test is what makes that divergence impossible to ship quietly.

const SKILL_DIR = path.join(os.homedir(), '.claude', 'skills', 'plan-progress-tracker');
const requiredSections = [...fs.readFileSync(HOOK, 'utf8').matchAll(/^\s*\['([^']+)',/gm)]
  .map((m) => m[1]);

report('parsed REQUIRED_SECTIONS', '10', String(requiredSections.length));

const headingsIn = (file, re) => [...fs.readFileSync(file, 'utf8').matchAll(re)]
  .map((m) => m[1].trim().toLowerCase());

const templateHeadings = headingsIn(path.join(SKILL_DIR, 'references', 'plan-template.md'), /^## (.+)$/gm);
report('template matches gate', 'match',
  templateHeadings.join(' | ') === requiredSections.join(' | ')
    ? 'match' : 'DRIFT [' + templateHeadings.join(' | ') + ']');

const skillHeadings = headingsIn(path.join(SKILL_DIR, 'SKILL.md'), /^\d+\. `## ([^`]+)`/gm);
report('SKILL.md matches gate', 'match',
  skillHeadings.join(' | ') === requiredSections.join(' | ')
    ? 'match' : 'DRIFT [' + skillHeadings.join(' | ') + ']');

try {
  fs.rmSync(EMPTY_DIR, { recursive: true, force: true });
} catch {
  // A leftover temp dir must not fail the suite.
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
