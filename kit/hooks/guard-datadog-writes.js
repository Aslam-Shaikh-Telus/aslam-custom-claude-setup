#!/usr/bin/env node
// PreToolUse guard: Datadog MCP tools are read-only by default. Anything that is not a
// recognised read prompts for permission before it runs.
//
// Why this exists as a hook and not as prose: the Datadog role on the `worksafebc` org
// grants **MCP Write** as well as MCP Read, so Datadog itself will happily execute a
// monitor create/edit/delete and leave a real change in the production org. There is no
// server-side refusal to rely on. The standing rule - read via MCP, write via Terraform -
// lived only in a plan file and a memory entry, both of which a fresh session can miss.
//
// Rule (one, deliberately):
//   Any tool on a Datadog MCP server whose name is not a recognised read verb -> ask.
//
// `ask`, never `deny`. Writes should never be the direct path, but an emergency change
// has to remain possible with the user's explicit say-so. A hard block would just get
// switched off, and a switched-off guard enforces nothing.
//
// Default-closed by design: an unrecognised tool name asks rather than passing. New write
// tools appear whenever a toolset is enabled via `/ddtoolsets` (34 toolsets exist,
// including `remote-actions` and `code-exec`), so a denylist of known write verbs would
// silently miss the next one. The cost is that a genuinely-read tool with an unusual verb
// prompts once; add its prefix to READ_VERBS when that happens.
//
// Must never break a tool call by accident: any internal error exits 0 silently, allowing
// the call through.

// Verb prefixes that only ever read. Everything else on a Datadog server asks.
const READ_VERBS = /^(search|get|list|load|aggregate|analyze)_/;

function ask(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try {
    const toolName = (JSON.parse(raw).tool_name || '').trim();

    // Tool names are `mcp__<server>__<tool>`. Server names may contain single
    // underscores (`plugin_datadog_mcp`), so split on the double-underscore separator
    // rather than pattern-matching the whole string - a tool merely *mentioning*
    // datadog on some other server must not be gated.
    const parts = toolName.split('__');
    if (parts.length < 3 || parts[0] !== 'mcp') process.exit(0);

    const server = parts[1];
    const tool = parts.slice(2).join('__');
    if (!/datadog/i.test(server)) process.exit(0);
    if (READ_VERBS.test(tool)) process.exit(0);

    ask(
      `Datadog MCP is read-only by standing rule, and "${tool}" is not a recognised read.\n\n` +
      'Datadog config changes belong in Terraform (the datadog-terraform-example work on ' +
      'thcp-wsbc-infrastructure-dev), not in a direct MCP call: the Datadog role grants ' +
      'MCP Write, so this will succeed and leave an out-of-band change in the worksafebc ' +
      'org that no IaC state knows about.\n\n' +
      'Approve only for a deliberate emergency change. If approved, say in your reply that ' +
      'this creates drift, and note what needs codifying afterwards.'
    );
  } catch {
    process.exit(0); // fail open - never break a call on a guard bug
  }
});
