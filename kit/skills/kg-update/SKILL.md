---
name: kg-update
description: Update the project knowledge graph with durable knowledge from the current session. Use when the user runs /kg-update, asks to record findings, learnings, incidents, or decisions in the knowledge graph, or when concluding significant work in a project whose path matches an entry in ~/.claude/kg/registry.json.
---

# Update the project knowledge graph

Capture durable knowledge from the current session into the project's knowledge graph, on the user's personal KG branch.

## Changelog

- **2.2.0** — Step 4 now actively enforces the accuracy-first, agent-optimized authoring conventions (status/date headers, no volatile-fact duplication into indexes, link resolution check) instead of relying on the contract text alone. If you're on an older runner, `git pull` this repo and re-run `.claude-kit\setup.ps1` to pick it up — nothing pushes this automatically.

## Procedure

1. **Find the candidates, classify the knowledge, then route — in that order.**

   Read `~/.claude/kg/registry.json` and collect every entry whose `match` regex matches the current working directory. A project KG and the local wiki matching together is the normal case, not an ambiguity — resolve it with the rules below rather than asking.

   **Privacy gate — apply before choosing a destination.** A KG with `"shared": true` is pushed to a team repo; once merged, its content is in the team's history and cannot be unpublished. Never write to a shared KG:

   - anything about a named individual's role, allocation, performance, or departure;
   - career, compensation, or HR matters;
   - the user's own priorities, opinions, or assessments of people and teams;
   - org-political observations.

   These go to the local wiki regardless of how project-relevant they look. Shared KGs take only impersonal, verifiable project facts — systems, configuration, procedures, failure modes.

   **Routing.** Durable, impersonal project knowledge → that project's KG. Everything else — cross-project or non-project work, personal context, and in-flight state that has not yet become durable project knowledge → the local wiki (the entry with `"shared": false`).

   **Default deny.** If a fact is ambiguous, write it to the local wiki and link to the project KG from there. Promoting later is cheap; unpublishing from a team repo is not.

   Ask the user only when two *project* KGs match, or when no entry matches at all.

2. **Load the KG's rules.** Read `<kg.path>/.claude-kit/KG-CONTRACT.md` (mentally substituting `{{KG_NAME}}`, `{{KG_PATH}}`, `{{BRANCH}}` from the registry entry) and the KG root `index.md` for section layout and conventions. The contract is authoritative for this KG — follow it over anything below if they differ.

3. **Extract durable knowledge.** Review the session's work and list facts worth keeping: infrastructure/configuration changes, incident lessons, deploy quirks, server/credential locations, business rules discovered in code, architecture decisions. Exclude conversation-local detail and anything the project's own repo/docs already record. If nothing qualifies, say so and stop — do not invent content.

4. **Write it, applying these checks before committing:**
   - Put each fact in the correct section — one focused document per topic (split by what question the doc answers, not by line count; extend an existing document when one already covers the topic).
   - Lead the doc/section with a one-line summary (what it is, how current) before supporting detail — reorder for a fast read, never omit a caveat or exception to shorten it. Accuracy beats brevity whenever they'd conflict.
   - **Before writing a status, count, or "as of" value into a section's `index.md`, check whether that fact already lives in a topic doc.** If it does, don't duplicate it into the index — link to the topic doc instead. A duplicated volatile fact will drift out of sync with the source; index entries should carry only stable facts (name, owner, path).
   - Give anything that changes over time (status, count, incident state) an explicit `**Status (<date>):**` line rather than relying on narrative tense.
   - Add a `NEEDS-REVIEW.md` entry for anything tentative, contradictory, or unverified, with a `**Status:**` line (`open (as of <date>)`, `open (undated)` if no date is actually known — never fabricate one, or `resolved <date>`).
   - **Verify every link you add actually resolves** (the target file exists at that relative path) before committing it. Use resolvable relative markdown links only — never `[[wikilink]]` syntax.
   - Update that section's `index.md` so the new document is discoverable.

5. **Commit on the user branch.** In the KG clone:
   - `git fetch origin`
   - Checkout `<kg.branch>` (create from `origin/main` if missing), merge `origin/main` into it.
   - Commit with a message describing the knowledge added, then `git push origin <kg.branch>`.
   - **Never commit to `main`.** If the working tree has unrelated changes or the push fails, leave the commit local and tell the user.

6. **Report.** Summarize what was captured, which files changed, and the branch it landed on.
