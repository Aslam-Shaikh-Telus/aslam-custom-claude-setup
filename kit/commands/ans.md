---
description: Answer the question in the terminal and write nothing anywhere, even in plan mode
argument-hint: <question>
disable-model-invocation: true
allowed-tools: Read Grep Glob
disallowed-tools: Write Edit NotebookEdit Artifact ExitPlanMode
---

Answer this, in the terminal, and write nothing anywhere:

$ARGUMENTS

**Nothing is written.** No file created or edited, no artifact published, no plan file, no
scratch file, no Jira comment, no knowledge-graph capture. This holds regardless of the
active permission mode.

**Plan mode is not an instruction to write a plan here.** If a plan contract or plan-mode
workflow appears in context, it does not apply to this turn: there is no plan, and
`ExitPlanMode` is not called. End the turn with the answer.

**Format.** Lead with the answer in one or two sentences. Add a few lines of reasoning only
where it changes the decision. No headers, no next-steps list, no offer to implement, no
summary of what you just said.

**Reading is allowed** — use `Read`, `Grep` and `Glob` freely rather than replying "I would
need to look at X". Shell commands must be read-only (`git log`, `git status`, `ls`, `cat`);
never one that creates, moves or modifies anything.

**If the honest answer is that this needs real work rather than an answer**, say so in one
sentence and stop. Do not start the work.
