const { execFileSync } = require('child_process');
const GUARD = process.env.USERPROFILE + '\\.claude\\hooks\\guard-datadog-writes.js';

// [name, tool_name, expected]
// GATE = the hook must interpose (ask or deny). allow = must pass straight through.
const cases = [
  // --- writes and state changes: must be gated ---
  ['create monitor',        'mcp__plugin_datadog_mcp__create_datadog_monitor',      'GATE'],
  ['update monitor',        'mcp__plugin_datadog_mcp__update_datadog_monitor',      'GATE'],
  ['delete monitor',        'mcp__plugin_datadog_mcp__delete_datadog_monitor',      'GATE'],
  ['mute monitor',          'mcp__plugin_datadog_mcp__mute_datadog_monitor',        'GATE'],
  ['edit dashboard',        'mcp__plugin_datadog_mcp__edit_datadog_dashboard',      'GATE'],
  ['schedule downtime',     'mcp__plugin_datadog_mcp__schedule_datadog_downtime',   'GATE'],
  ['remote action',         'mcp__plugin_datadog_mcp__execute_remote_action',       'GATE'],
  ['code exec',             'mcp__plugin_datadog_mcp__run_datadog_code',            'GATE'],
  ['post to incident',      'mcp__plugin_datadog_mcp__add_datadog_incident_note',   'GATE'],
  ['send feedback out',     'mcp__plugin_datadog_mcp__submit_mcp_feedback',         'GATE'],

  // --- unknown / unclassifiable tool names default to gated, not open ---
  ['opaque _dd_rfw',        'mcp__plugin_datadog_mcp___dd_rfw',                     'GATE'],
  ['opaque _dd_guc',        'mcp__plugin_datadog_mcp___dd_guc',                     'GATE'],
  ['invented future tool',  'mcp__plugin_datadog_mcp__frobnicate_the_org',          'GATE'],

  // --- a manually registered Datadog server must be covered too ---
  ['manual reg create',     'mcp__datadog_mcp__create_datadog_monitor',             'GATE'],
  ['bare datadog server',   'mcp__datadog__delete_datadog_monitor',                 'GATE'],

  // --- reads: must pass through untouched ---
  ['search monitors',       'mcp__plugin_datadog_mcp__search_datadog_monitors',     'allow'],
  ['search logs',           'mcp__plugin_datadog_mcp__search_datadog_logs',         'allow'],
  ['get dashboard',         'mcp__plugin_datadog_mcp__get_datadog_dashboard',       'allow'],
  ['get metric',            'mcp__plugin_datadog_mcp__get_datadog_metric',          'allow'],
  ['list skills',           'mcp__plugin_datadog_mcp__list_datadog_skills',         'allow'],
  ['load skill',            'mcp__plugin_datadog_mcp__load_datadog_skill',          'allow'],
  ['aggregate spans',       'mcp__plugin_datadog_mcp__aggregate_spans',             'allow'],
  ['analyze logs',          'mcp__plugin_datadog_mcp__analyze_datadog_logs',        'allow'],
  ['manual reg read',       'mcp__datadog_mcp__search_datadog_monitors',            'allow'],

  // --- must not touch anything that is not Datadog ---
  ['outlook search',        'mcp__outlook__search_messages',                        'allow'],
  ['atlassian create',      'mcp__claude_ai_Atlassian__createJiraIssue',            'allow'],
  ['plain Bash',            'Bash',                                                 'allow'],
  ['Write tool',            'Write',                                                'allow'],
  // a non-Datadog server whose TOOL name merely mentions datadog must still pass
  ['other srv, dd in tool', 'mcp__outlook__create_draft_about_datadog',             'allow'],
];

let pass = 0, fail = 0;
for (const [name, toolName, expected] of cases) {
  const payload = JSON.stringify({ tool_name: toolName, tool_input: {}, cwd: 'C:\\GitHub' });
  let out = '';
  try {
    out = execFileSync('node', [GUARD], { input: payload, encoding: 'utf8' });
  } catch (e) {
    out = 'HARNESS-ERROR ' + e.message;
  }
  const got = /"permissionDecision":"(ask|deny)"/.test(out) ? 'GATE' : 'allow';
  const ok = got === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(24)} expect=${expected.padEnd(5)} got=${got}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
