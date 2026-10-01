#!/usr/bin/env node
// PreToolUse guard: blocks a small set of commands that standing instructions say must
// never run. These rules previously existed only as prose in CLAUDE.md, KG-CONTRACT.md,
// and memory - instructions the model can forget. A hook cannot be forgotten.
//
// Rules (1-4 deny, 5 asks, all with an explanation fed back to the model):
//   1. git commit / push while on main inside a registered SHARED knowledge graph
//   2. PR-create calls carrying reviewers
//   3. git push --force / --force-with-lease, and git commit --amend
//   4. terraform apply / destroy targeting prod or dr, including the `make apply` form
//   5. state-changing gcloud / gsutil / aws / az / bq calls (asks; reads pass through)
//
// Deliberately narrow. A guard that fires during ordinary work gets switched off, and a
// switched-off guard enforces nothing.
//
// Node rather than PowerShell purely for speed: this runs before every shell call, and
// Windows PowerShell startup measured ~678ms against Node's ~197ms.
//
// Must never break a tool call by accident: any internal error exits 0 silently, allowing
// the command through.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function decide(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}
const deny = (reason) => decide('deny', reason);
const ask = (reason) => decide('ask', reason);

// Secret shapes worth stopping before they enter a shared repo's history. Deliberately
// few and high-signal - a scanner that cries wolf gets ignored.
const SECRET_PATTERNS = [
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key ID'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'GitHub token'],
  [/\b(password|passwd|secret|api[_-]?key)\s*[:=]\s*["']?[^\s"'{}$<>]{8,}/i, 'inline credential assignment'],
];

// Scan the staged diff of a shared KG for secrets and for personal terms the user has
// listed in ~/.claude/hooks/personal-terms.json. Returns [] when nothing matches.
function scanStagedContent(kgRoot) {
  let diff = '';
  try {
    diff = execFileSync('git', ['-C', kgRoot, 'diff', '--cached', '--unified=0'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  if (!diff.trim()) return [];

  // Only added lines matter - removing a name is exactly what we want to encourage.
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  if (!added.trim()) return [];

  const hits = [];
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(added)) hits.push(`possible ${label}`);
  }

  try {
    const termsPath = path.join(process.env.USERPROFILE || '', '.claude', 'hooks', 'personal-terms.json');
    if (fs.existsSync(termsPath)) {
      const terms = JSON.parse(fs.readFileSync(termsPath, 'utf8'));
      for (const name of terms.names || []) {
        if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(added)) {
          hits.push(`person: ${name}`);
        }
      }
      for (const kw of terms.keywords || []) {
        if (new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(added)) {
          hits.push(`sensitive topic: ${kw}`);
        }
      }
    }
  } catch {
    // A malformed terms file must not block a commit.
  }
  return [...new Set(hits)];
}

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  try {
    if (!input.trim()) return process.exit(0);
    const payload = JSON.parse(input);
    const cmd = payload?.tool_input?.command;
    if (typeof cmd !== 'string' || !cmd) return process.exit(0);

    // Cheap bail-out: nothing below can match without one of these verbs.
    if (!/\b(git|gh|curl|terraform|make|gcloud|gsutil|aws|az|bq)\b/i.test(cmd)) return process.exit(0);

    const cwd = payload?.cwd || process.cwd();

    // ---- Rule 3: force push and amend ---------------------------------------------
    // Matched per shell segment, against `push`/`commit` as git's own subcommand, with
    // heredoc/here-string bodies and quoted strings removed first. The old whole-command
    // regexes fired on any text mentioning "push" plus a `-F`-like token - a commit message
    // body, `git commit -F msg.txt && echo "never push"` - and blocked real commits on
    // 2026-09-29. Quoting a flag to dodge the check is not the threat model: this guards
    // against forgetting the rule, not against evasion.
    const gitSub = (sub) =>
      new RegExp(String.raw`\bgit(?:\s+-[Cc]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+` + sub + String.raw`\b(.*)`, 'i');
    const segments = cmd
      .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, ' ') // heredocs
      .replace(/@'[\s\S]*?\n'@|@"[\s\S]*?\n"@/g, ' ')                                // PS here-strings
      .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, ' ')                                    // quoted args
      .split(/&&|\|\||[;|\n]/);
    const pushArgs = segments.map((s) => s.match(gitSub('push'))?.[1]).filter((a) => a != null);
    // --force, --force-with-lease, --force-if-includes; -f alone or bundled (-uf) -
    // case-sensitive, since -F is not a push flag; a +refspec forces that ref.
    if (pushArgs.some((a) => /(^|\s)(--force\b|-[a-z0-9]*f[a-z0-9]*\b|\+\S)/.test(a))) {
      deny(
        'Blocked: force push. The standing rule in the global CLAUDE.md is never to force ' +
        'push without explicit permission. If the user has just asked for it, they can run ' +
        'it themselves with `! git push --force ...`.'
      );
    }
    if (segments.some((s) => /(^|\s)--amend\b/.test(s.match(gitSub('commit'))?.[1] ?? ''))) {
      deny(
        'Blocked: git commit --amend. The standing rule in the global CLAUDE.md is never to ' +
        'amend without explicit permission - prefer a new commit. If the user explicitly ' +
        'asked, they can run it themselves with `! git commit --amend`.'
      );
    }

    // ---- Rule 2: reviewers on a PR create ------------------------------------------
    const isPrCreate = /\bgh\b[\s\S]*\bpr\b[\s\S]*\bcreate\b/i.test(cmd) || /pull-requests/i.test(cmd);
    if (isPrCreate && /(--reviewer\b|["']reviewers["']|\breviewers\s*:)/i.test(cmd)) {
      deny(
        'Blocked: this PR-create call carries reviewers. The user adds reviewers manually, ' +
        'always - omit the reviewers array entirely. It also fails outright if any listed ' +
        'account is unlicensed (InvalidPullRequestReviewersException).'
      );
    }

    // ---- Rule 4: terraform apply/destroy against prod or dr ------------------------
    // The infra repos drive Terraform through Makefiles, so `ENV=prod make apply` (and
    // apply-all / apply-partial / destroy-*) are the forms actually used. Matching only
    // the literal terraform binary would miss every real invocation.
    const isApplyDestroy =
      /\bterraform\b[\s\S]*\b(apply|destroy)\b/i.test(cmd) ||
      /\bmake\b[^|;&]*\b(apply|destroy)(-all|-partial)?\b/i.test(cmd);
    if (isApplyDestroy) {
      const targetsProd =
        /(infrastructure-(prod|dr)|[\\/]env[\\/](prod|dr)\b)/i.test(cwd) ||
        /\bENV\s*=\s*["']?(prod|proddr|dr)\b/i.test(cmd);
      if (targetsProd) {
        deny(
          `Blocked: terraform apply/destroy targeting prod or dr (cwd: ${cwd}). Two live ` +
          'hazards make this unsafe unattended: the prod Cloud Armor default rule is ' +
          'deny(403) and NOT in preview, so an apply can cut public access to everything ' +
          'except allowlisted partner CIDRs; and the DR repo\'s components still point at ' +
          'the prod project and prod state bucket on Oct-2024 code, so an apply from there ' +
          'regresses prod. See wsbc-pp-kg/infra/drift-register.md items 3 and 5. If this is ' +
          'genuinely intended, run it deliberately outside Claude.'
        );
      }
    }

    // ---- Rule 5: state-changing cloud CLI calls ------------------------------------
    // The `cloud-iac-guardrails` skill says never to run `gcloud * create/update/delete/
    // set` (or the AWS/Azure equivalents) for a resource the project manages via IaC -
    // out-of-band changes get reverted on the next apply, drift silently, and bypass
    // review. That rule lived only in 13 lines of skill prose, which loads only when the
    // skill triggers. Rule 4 above covers terraform; the cloud CLIs had nothing.
    //
    // `ask`, not `deny`: the skill itself documents an emergency exception ("just do it
    // now via gcloud, we'll codify later"), so the escape hatch has to exist. Reads pass
    // through untouched - a guard that fires on `gcloud ... list` would be switched off.
    const cloudCli = /\b(gcloud|gsutil|aws|az|bq)\b/i.exec(cmd);
    if (cloudCli && !/(--help|--dry-run)\b/i.test(cmd)) {
      const MUTATE = /\b(create|delete|update|patch|set|add|remove|enable|disable|deploy|import|restore|reset|attach|detach|replace|undelete|purge)\b/i;
      let mutates = false;
      switch (cloudCli[1].toLowerCase()) {
        case 'gcloud': {
          // `config`, `auth` and `components` change this machine, not a cloud resource.
          if (/\bgcloud\s+(config|auth|components|version|info|help)\b/i.test(cmd)) break;
          // Verb tokens only. Testing the whole command string against MUTATE matched
          // `patch` inside resource names like `wsbc-vm-patch-runner` and the gcloud
          // group `patch-jobs` (a hyphen is a word boundary), firing this guard on
          // plain `list`/`describe`/`logging read` calls that happen to touch a
          // patch-something resource.
          const gcloudVerbs = cmd
            .replace(/'[^']*'|"[^"]*"/g, ' ') // drop quoted args
            .match(/\bgcloud\b((?:\s+[a-z0-9][a-z0-9-]*)*)/i)?.[1]
            ?.trim().split(/\s+/).filter(Boolean) ?? [];
          // `patch` is exact-match only: `patch-jobs`/`patch-deployments` are gcloud
          // group names, not verbs. Everything else keeps a `verb(-|$)` prefix form
          // so `set-machine-type` and `add-iam-policy-binding` still ask.
          const MUTATE_TOKEN =
            /^(create|delete|update|set|add|remove|enable|disable|deploy|import|restore|reset|attach|detach|replace|undelete|purge|execute|start|stop|restart|pause|resume)(-|$)/i;
          mutates = gcloudVerbs.some(t => t.toLowerCase() === 'patch' || MUTATE_TOKEN.test(t));
          break;
        }
        case 'gsutil':
          mutates = /\bgsutil\s+(rm|cp|mv|rsync|mb|rb|setmeta|acl\s+(set|ch)|iam\s+(set|ch))\b/i.test(cmd);
          break;
        case 'aws':
          mutates = /\b(create|delete|put|update|modify|terminate|attach|detach|remove|set|start|stop|reboot|run)-[a-z0-9-]+/i.test(cmd) ||
                    /\baws\s+s3\s+(rm|cp|mv|sync|mb|rb)\b/i.test(cmd);
          break;
        case 'az':
          mutates = MUTATE.test(cmd) || /\baz\b[\s\S]*\b(start|stop|restart)\b/i.test(cmd);
          break;
        case 'bq':
          // A `bq query` carrying DML/DDL writes just as surely as `bq mk` does.
          mutates = /\bbq\s+(mk|rm|update|insert|load|cp)\b/i.test(cmd) ||
                    (/\bbq\s+query\b/i.test(cmd) && /\b(insert|update|delete|merge|create|drop|alter|truncate)\b/i.test(cmd));
          break;
      }
      if (mutates) {
        ask(
          'This looks like a state-changing cloud CLI call. The standing rule is to change ' +
          'cloud resources through Infrastructure-as-Code, not the CLI: an out-of-band ' +
          'change gets reverted on the next IaC apply, drifts silently from the code, and ' +
          'bypasses review and the audit trail.\n\n' +
          'Approve only if this is a deliberate emergency. If approved, say in your reply ' +
          'that it creates drift and name the codification PR that needs to follow. If it ' +
          'is actually a read, the guard was too broad - say so rather than approving out ' +
          'of habit.'
        );
      }
    }

    // ---- Rule 1: commit or push on main inside a shared KG -------------------------
    if (/\bgit\b[\s\S]*\b(commit|push)\b/i.test(cmd)) {
      const registryPath = path.join(process.env.USERPROFILE || '', '.claude', 'kg', 'registry.json');
      if (fs.existsSync(registryPath)) {
        const raw = fs.readFileSync(registryPath, 'utf8');
        if (raw.trim()) {
          const registry = [].concat(JSON.parse(raw));
          for (const kg of registry) {
            if (!kg || !kg.path) continue;
            if (kg.shared === false) continue; // the local wiki commits to main by design

            const kgRoot = String(kg.path).replace(/[\\/]+$/, '');
            if (!cwd.replace(/[\\/]+$/, '').toLowerCase().startsWith(kgRoot.toLowerCase())) continue;

            let branch = '';
            try {
              branch = execFileSync('git', ['-C', kgRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
              }).trim();
            } catch {
              continue;
            }

            const pushingToMain = /\bpush\b[^|;&]*\bmain\b/i.test(cmd);
            if (branch === 'main' || branch === 'master' || pushingToMain) {
              deny(
                `Blocked: committing or pushing to '${branch}' in the shared knowledge graph ` +
                `'${kg.name}'. That repo is PR-only by org policy and runs a Secret Scanning ` +
                `check. Switch to the personal branch '${kg.branch}' first (create it from ` +
                'origin/main if it does not exist), commit there, and let the maintainer PR ' +
                'it into main.'
              );
            }

            // Content check on the way into a shared repo's history. Asks rather than
            // denies: a pattern match cannot judge whether a name is a leak or legitimate
            // source attribution, so the decision stays with the user.
            if (/\bcommit\b/i.test(cmd)) {
              const hits = scanStagedContent(kgRoot);
              if (hits.length) {
                ask(
                  `Staged content for the SHARED knowledge graph '${kg.name}' matched ` +
                  `${hits.length} item(s) that may not belong in a team repository: ` +
                  `${hits.join('; ')}. Shared KGs take impersonal, verifiable project facts ` +
                  'only, and merged content cannot be unpublished. Review the staged diff ' +
                  'before confirming - if it is personal or people-related, move it to the ' +
                  'local wiki instead. (Legitimate source attribution on a contested fact is ' +
                  'a valid reason to proceed.)'
                );
              }
            }
          }
        }
      }
    }
  } catch {
    // A broken guard must not break the session.
  }
  process.exit(0);
});
