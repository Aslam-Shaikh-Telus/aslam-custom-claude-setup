// Tests for inject-plan-contract.js. Plain Node assertions, no framework - matches
// test-plan-contract.js and test-guard-commands.js.
// Run: node test-inject-plan-contract.js   (exit 0 = all pass)

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(os.homedir(), '.claude', 'hooks', 'inject-plan-contract.js');
const TEMPLATE = path.join(os.homedir(), '.claude', 'skills', 'plan-progress-tracker',
  'references', 'plan-template.md');

// The ten sections the gate enforces, hard-coded on purpose. If this list and the template
// ever disagree, that is exactly the drift the Step 3 test exists to catch - these tests
// should fail loudly rather than quietly follow the template wherever it went.
const SECTIONS = [
  '## Context',
  '## Decisions already made',
  '## Preconditions',
  '## Ground truth',
  '## Steps',
  '## Out of scope',
  '## Documentation',
  '## Verification',
  '## Sonnet-ready',
  '## Escalation',
];

let pass = 0;
let fail = 0;

const report = (name, expected, got) => {
  const ok = got === expected;
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name.padEnd(28) +
    ' expect=' + String(expected).padEnd(13) + ' got=' + got);
};

// Every run gets its own marker directory, so one test's marker cannot silence the next.
const tempDirs = [];
const freshState = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-brief-test-'));
  tempDirs.push(d);
  return d;
};

const run = (payload, env) => {
  try {
    return execFileSync('node', [HOOK], {
      input: payload,
      encoding: 'utf8',
      // CLAUDE_EXECUTOR: '' pins orchestration mode for every case regardless of the caller's
      // environment (an Opus-executes session exports CLAUDE_EXECUTOR=opus). Same fix as
      // test-plan-contract.js; the opus-mode cases override it explicitly.
      env: Object.assign({}, process.env, { CLAUDE_EXECUTOR: '' }, env || {}),
    });
  } catch (e) {
    return 'HARNESS-ERROR ' + e.message;
  }
};

const planTurn = (sessionId) => JSON.stringify({
  session_id: sessionId,
  hook_event_name: 'UserPromptSubmit',
  permission_mode: 'plan',
  prompt: 'do the thing',
});

const contextOf = (out) => {
  try {
    const o = JSON.parse(out);
    return (o.hookSpecificOutput && o.hookSpecificOutput.additionalContext) || '';
  } catch {
    return '';
  }
};

const silence = (out) => (out.trim() === '' ? 'silent' : 'spoke');

// The brief numbers its headings ("1. ## Context"), so pull them back out and compare the
// list EXACTLY. An includes() check would let a renamed '## Escalations' satisfy a test
// looking for '## Escalation' - which is precisely how a drifted template slips through.
const headingsOf = (brief) => [...brief.matchAll(/^\d+\. (## .+)$/gm)].map((m) => m[1].trim());

// --- 1. Plan-mode first turn carries the whole contract ------------------------------------

const state1 = freshState();
const first = run(planTurn('s1'), { CLAUDE_PLAN_BRIEF_STATE: state1 });
const brief = contextOf(first);

const briefHeadings = headingsOf(brief);
report('first turn: ten headings', 'exact match',
  briefHeadings.join(' | ') === SECTIONS.join(' | ')
    ? 'exact match' : 'MISMATCH [' + briefHeadings.join(' | ') + ']');

// The docs are explicit that additionalContext at the TOP level is silently ignored, which
// from here would look identical to success. Assert the nesting, not just the text.
report('nested under hookSpecific', 'yes',
  /"hookSpecificOutput"/.test(first) && /"hookEventName":"UserPromptSubmit"/.test(first)
    ? 'yes' : 'no');

// --- 2. Once per session -------------------------------------------------------------------
// UserPromptSubmit fires on every turn. Without the marker the brief would compound for the
// life of the session, which is the opposite of the low-token goal.

report('second turn, same session', 'silent',
  silence(run(planTurn('s1'), { CLAUDE_PLAN_BRIEF_STATE: state1 })));

report('different session speaks', 'spoke',
  contextOf(run(planTurn('s2'), { CLAUDE_PLAN_BRIEF_STATE: state1 })) ? 'spoke' : 'silent');

// --- 3. Only plan mode ---------------------------------------------------------------------

for (const mode of ['default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions']) {
  report('mode ' + mode, 'silent', silence(run(
    JSON.stringify({ session_id: 'm-' + mode, permission_mode: mode }),
    { CLAUDE_PLAN_BRIEF_STATE: freshState() })));
}

// --- 3b. /ans turns get no brief ----------------------------------------------------------
// /ans is answer-only: it cannot write a plan, so a plan contract is both dead weight and
// misleading pressure. The skip must NOT claim the session marker, or one /ans question would
// silently cost the session its single real brief.

const ansTurn = (sessionId, prompt) => JSON.stringify({
  session_id: sessionId,
  hook_event_name: 'UserPromptSubmit',
  permission_mode: 'plan',
  prompt,
});

for (const prompt of ['/ans which option is best?', '  /ans leading space', '/ans']) {
  report('ans: ' + JSON.stringify(prompt).slice(0, 22), 'silent', silence(run(
    ansTurn('a-' + prompt.length, prompt), { CLAUDE_PLAN_BRIEF_STATE: freshState() })));
}

// A prompt that merely starts with the same letters is a real plan turn, not an /ans turn.
report('ans: /answer-me is not /ans', 'spoke', silence(run(
  ansTurn('a-near', '/answer-me properly'), { CLAUDE_PLAN_BRIEF_STATE: freshState() })));

// The marker must survive an /ans turn: the next genuine plan turn still gets its brief.
const ansState = freshState();
run(ansTurn('a-shared', '/ans quick question'), { CLAUDE_PLAN_BRIEF_STATE: ansState });
report('ans does not eat the brief', 'exact match',
  headingsOf(contextOf(run(planTurn('a-shared'), { CLAUDE_PLAN_BRIEF_STATE: ansState })))
    .join(' | ') === SECTIONS.join(' | ') ? 'exact match' : 'MISMATCH');

// --- 4. Fail open, silently ----------------------------------------------------------------

report('malformed stdin', 'silent',
  silence(run('not json at all{{', { CLAUDE_PLAN_BRIEF_STATE: freshState() })));

report('empty stdin', 'silent',
  silence(run('', { CLAUDE_PLAN_BRIEF_STATE: freshState() })));

// No session_id means no way to dedupe, so injecting would repeat every turn forever.
report('no session_id', 'silent', silence(run(
  JSON.stringify({ permission_mode: 'plan' }), { CLAUDE_PLAN_BRIEF_STATE: freshState() })));

// Kill switch, mirroring CLAUDE_PLAN_CONTRACT=off on the gate itself.
report('kill switch off', 'silent', silence(run(planTurn('s-kill'),
  { CLAUDE_PLAN_BRIEF_STATE: freshState(), CLAUDE_PLAN_BRIEF: 'off' })));

// A leading UTF-8 BOM must not silence the hook. PowerShell 5.1 prepends one to anything it
// pipes, so any hand-run verification from a PowerShell prompt hits this.
const withBom = run('\uFEFF' + planTurn('s-bom'), { CLAUDE_PLAN_BRIEF_STATE: freshState() });
report('BOM-prefixed payload', 'exact match',
  headingsOf(contextOf(withBom)).join(' | ') === SECTIONS.join(' | ')
    ? 'exact match' : 'MISMATCH [' + contextOf(withBom).slice(0, 40) + ']');

// --- 5. Budget -----------------------------------------------------------------------------
// The entire justification for this hook is that it is cheap. A brief that grows into a
// document has defeated its own purpose. Word count is a proxy at ~1.4 tokens per word.

const words = brief.trim().split(/\s+/).length;
report('brief under 250 tokens', 'yes',
  words * 1.4 < 250 ? 'yes' : 'no (' + words + ' words)');

// --- 6. The mechanical rules, which a heading list alone cannot carry ----------------------

for (const needle of ['Execution order:', 'Verify:', 'Verdict:', 'Contract: exempt', 'as appropriate']) {
  report('rule: ' + needle, 'yes', brief.includes(needle) ? 'yes' : 'no');
}

// --- 7. A broken template fails open VISIBLY ----------------------------------------------
// Same principle as the gate's unreadable-plan path: a brief that looks installed and says
// nothing recreates the exact failure this change exists to fix.

const badDir = freshState();
const badTemplate = path.join(badDir, 'broken-template.md');
fs.writeFileSync(badTemplate, '## Context\n\n## Steps\n');

const broken = run(planTurn('s-broken'),
  { CLAUDE_PLAN_BRIEF_STATE: freshState(), CLAUDE_PLAN_TEMPLATE: badTemplate });
report('broken template warns', 'yes', /systemMessage/.test(broken) ? 'yes' : 'no');
report('broken template no brief', 'yes', contextOf(broken) === '' ? 'yes' : 'no');

report('missing template warns', 'yes', /systemMessage/.test(run(planTurn('s-nofile'), {
  CLAUDE_PLAN_BRIEF_STATE: freshState(),
  CLAUDE_PLAN_TEMPLATE: path.join(badDir, 'does-not-exist.md'),
})) ? 'yes' : 'no');

// --- 8. The live template must actually work ----------------------------------------------

const real = contextOf(run(planTurn('s-real'), {
  CLAUDE_PLAN_BRIEF_STATE: freshState(),
  CLAUDE_PLAN_TEMPLATE: TEMPLATE,
}));
report('real template parses', 'exact match',
  headingsOf(real).join(' | ') === SECTIONS.join(' | ')
    ? 'exact match' : 'MISMATCH [' + headingsOf(real).join(' | ') + ']');

// --- 9. Opus-executes mode omits Sonnet-ready ------------------------------------------------

const opusOut = run(planTurn('s-opus'), {
  CLAUDE_PLAN_BRIEF_STATE: freshState(),
  CLAUDE_EXECUTOR: 'opus',
});
const opusBrief = contextOf(opusOut);
report('opus mode: no Sonnet-ready', 'yes', !opusBrief.includes('Sonnet-ready') ? 'yes' : 'no');
report('opus mode: mode line', 'yes', opusBrief.includes('[mode=opus]') ? 'yes' : 'no');

const orchOut = run(planTurn('s-orch'), {
  CLAUDE_PLAN_BRIEF_STATE: freshState(),
  CLAUDE_EXECUTOR: '',
});
const orchBrief = contextOf(orchOut);
report('orch mode: has Sonnet-ready', 'yes', orchBrief.includes('Sonnet-ready') ? 'yes' : 'no');
report('orch mode: mode line', 'yes', orchBrief.includes('[mode=orchestration]') ? 'yes' : 'no');

for (const d of tempDirs) {
  try {
    fs.rmSync(d, { recursive: true, force: true });
  } catch {
    // A leftover temp dir must not fail the suite.
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
