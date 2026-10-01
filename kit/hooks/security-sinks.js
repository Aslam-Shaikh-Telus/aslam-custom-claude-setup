#!/usr/bin/env node
// PostToolUse hook on Edit|Write: non-blocking reminder when an edit introduces a known
// dangerous-API sink. Ported from the security-guidance plugin's data
// (plugins\cache\claude-plugins-official\security-guidance\2.0.8\hooks\patterns.py), which was
// disabled 2026-09-11 - its per-prompt `git stash create` and Python-per-edit LLM review cost
// more than the rules were worth. This hook keeps the cheap half: pure regex/substring checks,
// no subprocess, no API call.
//
// Deliberately separate from guard-commands.js: that hook guards Bash COMMANDS before they run
// (PreToolUse, can deny); this guards FILE CONTENT after it's written (PostToolUse, never
// blocks - by the time this fires the edit already happened). Merging them would widen
// guard-commands.js past its documented narrow scope.
//
// Non-blocking by design: a sink match is often intentional (documenting the risk, as in the
// security-sinks skill this hook accompanies) and PostToolUse cannot undo a write anyway.
// Reminder-only, via systemMessage.
//
// Must never break a tool call by accident: any internal error exits 0 silently, emitting nothing.

const JS_EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'];
const PY_EXTS = ['.py', '.pyi'];
const isExt = (p, exts) => exts.some((e) => p.toLowerCase().endsWith(e));

// {ruleName, filter(path) -> bool, test(content) -> bool, message}
const RULES = [
  {
    ruleName: 'child_process_exec',
    filter: (p) => isExt(p, JS_EXTS),
    test: (c) => c.includes('child_process.exec') || c.includes('execSync(') || /(?<![a-zA-Z0-9_.])exec\(/.test(c),
    message: 'exec()/execSync() runs a shell, injectable via interpolated input - use execFile()/spawn() with an argument array.',
  },
  {
    ruleName: 'new_function_injection',
    filter: (p) => isExt(p, JS_EXTS),
    test: (c) => c.includes('new Function'),
    message: 'new Function() with interpolated strings is code injection - never interpolate untrusted strings into it.',
  },
  {
    ruleName: 'eval_injection',
    filter: (p) => !p.toLowerCase().endsWith('.md'),
    test: (c) => /(?<![a-zA-Z0-9_.])eval\(/.test(c),
    message: 'eval() executes arbitrary code - use JSON.parse(), ast.literal_eval(), or a safe expression parser.',
  },
  {
    ruleName: 'react_dangerously_set_html',
    filter: (p) => isExt(p, JS_EXTS),
    test: (c) => c.includes('dangerouslySetInnerHTML'),
    message: 'dangerouslySetInnerHTML is an XSS sink - sanitize with DOMPurify first.',
  },
  {
    ruleName: 'document_write_xss',
    filter: (p) => isExt(p, JS_EXTS),
    test: (c) => c.includes('document.write'),
    message: 'document.write() is an XSS sink - use createElement()/appendChild().',
  },
  {
    ruleName: 'innerHTML_xss',
    filter: (p) => isExt(p, JS_EXTS),
    test: (c) => c.includes('.innerHTML =') || c.includes('.innerHTML='),
    message: 'Setting innerHTML with untrusted content is an XSS sink - use textContent or DOMPurify.',
  },
  {
    ruleName: 'pickle_deserialization',
    filter: (p) => isExt(p, PY_EXTS),
    test: (c) => /(?<![a-zA-Z0-9_])pickle\.(loads?|Unpickler)\b/.test(c),
    message: 'pickle.load(s)/Unpickler executes arbitrary code from untrusted data - use JSON or a schema-validated deserializer.',
  },
  {
    ruleName: 'os_system_injection',
    filter: (p) => isExt(p, PY_EXTS),
    test: (c) => /\bos\.system\s*\(/.test(c),
    message: 'os.system() runs a shell - use subprocess.run([...]) with a list.',
  },
  {
    ruleName: 'python_subprocess_shell',
    test: (c) => /subprocess\.(?:run|call|Popen|check_output|check_call)\(.*shell\s*=\s*True/.test(c),
    message: 'subprocess(shell=True) enables command injection - pass args as a list without shell=True.',
  },
  {
    ruleName: 'unsafe_yaml_load',
    test: (c) => /\byaml\.load\s*\((?![^)\n]{0,80}Safe)/.test(c),
    message: 'yaml.load() executes arbitrary Python via !!python/object tags - use yaml.safe_load().',
  },
  {
    ruleName: 'tls_verification_disabled',
    test: (c) => /verify\s*=\s*False\b|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/.test(c),
    message: 'Disabling TLS verification allows MITM attacks - trust a proper CA instead.',
  },
  {
    ruleName: 'xml_unsafe_parse',
    filter: (p) => isExt(p, PY_EXTS),
    test: (c) => /\b(xml\.etree\.ElementTree|ElementTree|ET)\.(parse|fromstring|XML)\s*\(|\bminidom\.(parse|parseString)\s*\(/.test(c),
    message: 'stdlib XML parsers are vulnerable to XXE - use defusedxml.ElementTree.',
  },
  {
    ruleName: 'torch_unsafe_load',
    test: (c) => /\btorch\.load\s*\((?![^)\n]{0,200}weights_only\s*=\s*True)/.test(c),
    message: 'torch.load() defaults to unpickling - pass weights_only=True.',
  },
];

function firstMatch(filePath, content) {
  for (const rule of RULES) {
    if (rule.filter && !rule.filter(filePath)) continue;
    try {
      if (rule.test(content)) return rule;
    } catch {
      // A broken individual rule must not break the whole hook.
    }
  }
  return null;
}

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    if (!input.trim()) return process.exit(0);
    const payload = JSON.parse(input);
    if (!['Edit', 'Write'].includes(payload?.tool_name)) return process.exit(0);

    const filePath = payload?.tool_input?.file_path;
    const content = payload?.tool_input?.content ?? payload?.tool_input?.new_string;
    if (!filePath || typeof content !== 'string') return process.exit(0);

    const rule = firstMatch(filePath, content);
    if (!rule) return process.exit(0);

    process.stdout.write(JSON.stringify({
      systemMessage: `security-sinks: ${rule.ruleName} - ${rule.message} (see the security-sinks skill for the full list)`,
      suppressOutput: true,
    }));
  } catch {
    // A broken reminder must not break the session.
  }
  process.exit(0);
});
