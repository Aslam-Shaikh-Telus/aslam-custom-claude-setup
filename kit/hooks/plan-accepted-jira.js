#!/usr/bin/env node
// PostToolUse hook on ExitPlanMode: fires when a plan is APPROVED and injects a reminder to
// load the plan-progress-tracker skill and settle the Jira question before implementation.
//
// Why a hook: the rule already lives in ~/.claude/skills/plan-progress-tracker/SKILL.md
// ("Confirm the Jira ticket up front"), but skills load on model judgement, matched against
// their description. At the moment a plan is approved there is no user phrasing to match -
// only an ExitPlanMode tool result - so nothing reliably triggered a skill lookup and the
// Jira step got silently skipped. A hook cannot be skipped.
//
// Approve vs reject: verified against every past ExitPlanMode result in
// ~/.claude/projects/**/*.jsonl. On approval the result is an OBJECT carrying the plan text;
// on rejection it is a STRING ("User rejected tool use", or "Error: The user doesn't want to
// proceed with this tool use..."). PostToolUse should only fire on success anyway - this is
// the belt to that suspenders.
//
// Node rather than PowerShell to match guard-commands.js: Windows PowerShell startup measured
// ~678ms against Node's ~197ms.
//
// Must never break the turn: any internal error exits 0 silently, emitting nothing.
//
// Commit-on-completion line added 2026-09-29: finished plans were leaving trees dirty for the next session.

const REMINDER =
  'The plan was just approved. Before writing any implementation code, invoke the ' +
  'plan-progress-tracker skill (Skill tool, skill: "plan-progress-tracker") and follow its ' +
  '"Linking the plan to Jira" section:\n' +
  '  - Ask the user: "Is there a Jira ticket for this work?"\n' +
  '  - If yes: run the context discovery (getJiraIssue, parent/children, linked issues, ' +
  'remote links), present the graph, and confirm which ticket is primary before locking it in.\n' +
  '  - If no: offer to create one with createJiraIssue, proposing summary + description from ' +
  'the plan and confirming fields first.\n' +
  '  - If the user opts out ("no Jira for this plan"): proceed with progress.md only and ' +
  'record `jira: none` in its frontmatter.\n' +
  'Then create the <feature>-progress.md tracker, including its `## Git baseline` for every git ' +
  'work tree the plan touches. When `## Verification` passes, commit per the skill\'s ' +
  '"Committing on completion" section before declaring the plan done. Do not skip this - it is ' +
  'the step this hook exists to enforce.';

// Second job, added 2026-08-25: warn when a plan that declared itself NOT Sonnet-ready is approved.
// Under the `opusplan` model setting, approval has ALREADY moved this session to Sonnet - the
// alias switches on the permission-mode flip, not on plan content - and no hook can move it back,
// because hook returns carry no model field. So this is a warning, deliberately, rather than a fix.
// Under the reclaimed `Verdict: no` semantics (2026-09-16, see plan-contract.js:16-27), the
// PreToolUse gate now denies a `no`-verdict plan unconditionally, so this branch should only ever
// fire when a `Contract: exempt` or `CLAUDE_PLAN_CONTRACT=off` escape hatch let an unfinished plan
// through anyway - the plan is still unfinished, escape hatch or not.
//
// Revised 2026-08-28: the mid-session `/model` round trip used to be offered as "the remedy"
// here. Removed - an Enter-confirmed `/model` persists by rewriting the `model` key in
// settings.json, and a forgotten restore silently pins every future session to Opus. This is the
// most likely cause of two unexplained settings.json drifts on record (NEEDS-REVIEW.md:165-175),
// and was caught live mid-plan-execution this same session.
//
// Corrected 2026-09-16, two claims: (1) "CLAUDE_CODE_SUBAGENT_MODEL overrides agent frontmatter"
// was reversed in v2.1.251 and confirmed live on 2.1.268 and again on 2.1.273 - frontmatter
// `model:` now wins (see claude-setup-tracker.md:100). (2) "...and the per-call `model`
// parameter" was independently wrong even when written - that same measurement found the
// per-call override honoured 9/9. Only the `updatedInput`-ignored-for-delegation measurement
// stands unchallenged. So per-step Opus delegation (a marked step under `## Steps`, escalated to
// `opus-consult` or `opus-step`) is now the PREFERRED route for settling an open judgement without
// a whole-session restart - a fresh `claude --model opus` session is the fallback, for judgement
// that cannot be expressed as a single plan step (e.g. the plan itself needs re-designing).
const MODEL_WARNING =
  'This plan declared `Verdict: no` under `## Sonnet-ready` - it is NOT Sonnet-ready, yet ' +
  'approving it has already switched this session to Sonnet, and no hook can switch it back. ' +
  '(Note: the plan-contract gate normally denies a `no` verdict outright - if this fired anyway, ' +
  'an escape hatch let the plan through, and it is still unfinished.)\n' +
  '  - Preferred: settle the open question. Either decide it directly and change the verdict to ' +
  '`yes`, or mark the step that needs it (`Opus: consult` / `execute` / `verify` under `## ' +
  'Steps`, listed on an `Escalations:` line) and delegate it to an `opus-consult` or `opus-step` ' +
  'subagent - both run on Opus regardless of this session\'s own model, no restart required.\n' +
  '  - Fallback, only when the judgement cannot be expressed as a single marked step (the plan ' +
  'itself needs re-designing, not just one decision within it): start a NEW session with ' +
  '`claude --model opus` and execute from the plan file. Do not use a mid-session `/model` ' +
  'switch - an Enter-confirmed `/model` persists by rewriting the `model` key in settings.json, ' +
  'so a forgotten restore pins every future session to Opus.';

// Third job, added 2026-09-16: when the approved plan carries `Opus: <kind>` markers, brief the
// executor on exactly which steps to delegate and to whom, so a marked step is never attempted
// directly by this (now Sonnet) session. Extracts markers via plan-contract.js's OWN parse
// (`require`d, not reimplemented) - a second, looser regex here would reintroduce the
// citation-vs-use bug that parse exists to prevent, on the one side of the marker lifecycle that
// currently has no test coverage of its own.
const { sectionsOf, markersIn, orchestration } = require('./plan-contract');

const buildEscalationBriefing = (plan) => {
  const steps = sectionsOf(plan).get('steps');
  if (!steps) return null;
  const { marks } = markersIn(steps);
  const lines = marks
    .filter((m) => m.kind) // a malformed marker has nothing sane to brief on, and would have
    .map((m) => {           // denied the plan already unless an escape hatch let it through
      const agent = m.kind === 'execute' ? 'opus-step' : 'opus-consult';
      if (m.kind === 'verify') {
        return '  - Step "' + m.step.name + '" (Opus: verify): perform the step yourself as ' +
          'written, then hand the `Verify:` gate\'s raw output to ' + agent + ' for a ' +
          'Pass/Fail/Inconclusive ruling. Do not self-assess the result.';
      }
      return '  - Step "' + m.step.name + '" (Opus: ' + m.kind + '): do not attempt this step ' +
        'directly - dispatch ' + agent + (m.reason ? ' with: ' + m.reason : '') + '.';
    });
  if (!lines.length) return null;
  return 'This plan marks ' + lines.length + ' step(s) for Opus escalation:\n' + lines.join('\n');
};

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    if (!input.trim()) return process.exit(0);
    const payload = JSON.parse(input);
    if (payload?.tool_name !== 'ExitPlanMode') return process.exit(0);

    // Field name differs between the hook payload (tool_response) and the transcript
    // representation (toolUseResult); accept either rather than depend on one.
    const result = payload?.tool_response ?? payload?.toolUseResult;

    // A string result means the plan was rejected or the user redirected - stay quiet.
    if (!result || typeof result !== 'object' || typeof result.plan !== 'string') {
      return process.exit(0);
    }

    // additionalContext is model-facing only. systemMessage is the one channel the user
    // actually sees, so the enforcement is auditable rather than invisible.
    // Both only apply when there is a Sonnet executor to hand the plan to: in Opus-executes
    // mode (CLAUDE_EXECUTOR=opus) the gate no longer enforces Sonnet-ready at all, and no
    // marked step is ever dispatched away from the session that is already Opus.
    const notSonnetReady = orchestration() && /^\s*verdict:\s*no\b/im.test(result.plan);
    const escalationBriefing = orchestration() ? buildEscalationBriefing(result.plan) : null;

    const parts = [];
    if (notSonnetReady) parts.push(MODEL_WARNING);
    if (escalationBriefing) parts.push(escalationBriefing);
    parts.push(REMINDER);

    process.stdout.write(JSON.stringify({
      systemMessage: notSonnetReady
        ? 'Plan approved but declared NOT Sonnet-ready - this session is now on Sonnet. Refine ' +
          'the plan, or start a new session with claude --model opus and execute from the plan ' +
          'file. Also: plan-progress-tracker required, confirm the Jira ticket before ' +
          'implementation starts.'
        : 'Plan approved - plan-progress-tracker required: confirm the Jira ticket before ' +
          'implementation starts.',
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: parts.join('\n\n'),
      },
      suppressOutput: true,
    }));
  } catch {
    // A broken reminder must not break the session.
  }
  process.exit(0);
});
