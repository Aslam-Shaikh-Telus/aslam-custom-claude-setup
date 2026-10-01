# aslam-custom-claude-setup

The Claude Code setup I use day to day on WSBC and NLCHI work, packaged so the
team can adopt pieces of it: a behaviour contract (`CLAUDE.md`), a plan quality
gate, command guardrails, scoped subagents, task-shaped skills and a cost-aware
statusline.

It is a **private repo for the team**, not a public kit. Client and project
names (WSBC, NLCHI) are left in on purpose because several guards only work when
they name the real repos. Colleague names, personal paths, internal hostnames
and secrets are scrubbed before anything is committed (see
[Maintaining](#maintaining-this-repo)).

The content is re-exported from my live `~/.claude`, so it keeps changing as I
change my setup. `git pull` is how you get updates; [CHANGELOG.md](CHANGELOG.md)
says what moved.

Read [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md) before adopting anything in the
advanced tier. It explains what each component is for, what it costs, and the
order to adopt them in.

## Quickstart

Prerequisites: PowerShell 7 (`pwsh`), Node on `PATH`, git, and Claude Code.

```powershell
gh repo clone Aslam-Shaikh-Telus/aslam-custom-claude-setup C:\GitHub\aslam-custom-claude-setup
cd C:\GitHub\aslam-custom-claude-setup

# 1. See what would change. Writes nothing.
pwsh -File INSTALL.ps1 -Report

# 2. Install interactively: one decision per component, one per conflicting setting.
pwsh -File INSTALL.ps1
```

The installer never overwrites your `CLAUDE.md`. It writes the kit's version
next to yours as `CLAUDE.md.starter-kit` so you can merge it by hand. A file
that differs from yours is backed up before it is replaced. `-Components` limits
a run to named components, and `-TargetRoot` points it somewhere other than
`%USERPROFILE%\.claude` (useful for a dry run into a temp folder).

### 3. Merge the hooks by hand

`INSTALL.ps1` copies hook *files* but does not edit the `hooks` block of your
`settings.json`. Copy the entries you want from [kit/settings.json](kit/settings.json)
into your own `%USERPROFILE%\.claude\settings.json`, replacing `<HOME>` with your
profile path (JSON-escaped). For example, the destructive-command guard:

```json
"PreToolUse": [
  {
    "matcher": "Bash|PowerShell",
    "hooks": [
      {
        "type": "command",
        "command": "node \"C:\\Users\\<you>\\.claude\\hooks\\guard-commands.js\"",
        "timeout": 10
      }
    ]
  }
]
```

Only add a hook for a component you installed. A hook pointing at a missing file
fails on every tool call.

### 4. Finish up

- Fill in `%USERPROFILE%\.claude\hooks\personal-terms.json` with your
  colleagues' names and client keywords. It ships empty and is never committed.
- If you took `kg-runner`, copy `kg\registry.example.json` to `kg\registry.json`
  and point it at your own knowledge-graph repos.
- Restart Claude Code. Hooks are read at start-up.
- Check the guards on your machine: `node %USERPROFILE%\.claude\hooks\test-guard-commands.js`.

## Updating

```powershell
cd C:\GitHub\aslam-custom-claude-setup
git pull
pwsh -File INSTALL.ps1 -Report     # shows what differs from what you have
```

Read the new [CHANGELOG.md](CHANGELOG.md) entry first. Components you have
edited locally show as `Differs`, and the installer asks before replacing them,
so local tuning survives an update. If a new hook arrived, merge it into
`settings.json` by hand as in step 3.

## What is in it

| Path | What |
|---|---|
| `kit/` | Everything that installs into `%USERPROFILE%\.claude`: `CLAUDE.md`, `settings.json`, `hooks/`, `agents/`, `skills/`, `commands/`, `kg/`, `statusline/` |
| `manifest.json` | Component catalogue the installer reads: tier, files, settings keys, benefit and cost |
| `INSTALL.ps1` | Advisory installer: survey, per-component choice, backups |
| `docs/WALKTHROUGH.md` | Why each component exists and what it costs |
| `tools/` | Maintainer scripts: export from live, scan for leaks |
| `tests/fixtures/` | A fake existing setup for exercising the installer |

Components by tier:

| Tier | Components |
|---|---|
| core | `claude-md`, `base-settings`, `plan-contract`, `guard-commands` |
| recommended | `agents`, `generic-skills`, `ans-command`, `security-sinks`, `statusline` |
| advanced | `kg-runner`, `kg-update`, `servicenow-cr`, `datadog-guard` |

## Deliberately not included

- PM and role-specific skills and commands (Jira status reports, weekly briefs).
- Machine-specific integrations: email alerts, Outlook mail, desktop
  notifications, VM access.
- Memory, knowledge-graph contents, transcripts, logs and `projects/`.
- Credentials, `settings.local.json`, enterprise-pushed settings, proxy values.

## Maintaining this repo

This section is for me (or anyone who forks the repo to share their own setup).

Mirrored files under `kit/` are never edited here. They are copied from the live
setup by `tools/export.ps1`, using the map in `tools/export.json`. Curated files
(`kit/CLAUDE.md`, `kit/settings.json`, `kit/hooks/personal-terms.json`,
`kit/kg/registry.example.json`) are hand-edited here and export never touches
them.

```powershell
pwsh -File tools/export.ps1 -Check   # exit 1 if kit/ has drifted from live
pwsh -File tools/export.ps1          # copy, substitute, scan, then write kit/
git diff                             # review every change before committing
# add a dated entry to CHANGELOG.md, then commit by path
```

How the scrub works:

- **Substitution.** The profile path becomes `%USERPROFILE%` in all three
  spellings (`\`, `\\`, `/`). The path is read at run time, so the user id never
  appears in committed config.
- **Scan.** `tools/scan.ps1` refuses denied terms, absolute `C:\Users\<name>` paths
  and secret-shaped strings (AWS keys, private-key blocks, Slack and GitHub
  tokens, inline credential assignments). Export writes nothing to `kit/` unless
  the scan of the staged copy is clean.
- **Denylist.** Terms live in `tools/denylist.local.json`, which is gitignored
  because the list itself is colleague names. The scan also reads `names` from
  `~/.claude/hooks/personal-terms.json`. Literal swaps for a mirrored file go in
  its `replacements` array: `{ "file": "kit/...", "from": "...", "to": "..." }`.
  Never weaken a scan rule to get a pass.
- **Pre-commit hook.** `.githooks/pre-commit` runs the scan on every commit.
  Enable it once per clone: `git config core.hooksPath .githooks`.

On a clone without `denylist.local.json` the scan warns and skips the term
check; the path and secret checks still run.
