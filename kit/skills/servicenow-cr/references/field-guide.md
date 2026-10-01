# What each CR field must contain

Drawn from the Change Submission Quality Guide. Field labels are verbatim from `SERVICENOW_MAP`
(`C:\GitHub\vendor-change-request-form\extract-cr-form.py:23-35`).

The recurring bar across every plan field: **any peer must be able to pick it up and execute it
without further explanation.** If a step assumes context only the author has, it fails.

---

## Short description
*(header)*

High-level overview of what will be completed. One line, at most 160 characters - ServiceNow cuts the field off at 160. Say what changes and to what.

Do not put the environment name in it - the record already carries the environment.

Approver needs: the one-line summary of what changes and on what.
Leave out: the environment name, ticket numbers, and the reason - that is Field 03.

## Description
*(header)*

A detailed overview of what will be completed during this change. Cover:

- what is being changed, concretely;
- why it was required;
- what teams and systems are involved;
- any guidance additional teams need to reference.

This field and the Justification are what Q1 and Q2 are derived from, so the team count and the
customer reach must be legible here.

Approver needs: what is changing, why it was required, and which teams and systems are involved.
Leave out: troubleshooting tips, command output and error strings; those serve the executor, not the approver.

## Justification
*(Planning tab)*

Sharp and concise business and technical reason for the change. Why this, why now.

Additional reasoning is required if the change falls outside the maintenance window, lands during
a restriction event, or a conflict was detected. If the change does not meet the recommended lead
time, a thorough reason must be stated.

Approver needs: the business and technical reason, and why now.
Leave out: anything the Description already said, and advocacy for the change beyond that reason.

## Implementation plan
*(Planning tab)*

Step-by-step instructions for execution, numbered.

- Fully detailed - any peer executes it without asking the author a question.
- State how stakeholders are notified before and after implementation.
- Attaching a runbook is acceptable, but it must meet this same bar.
- End with the total time required.

This is the primary source for Q1 (complexity). Team count must be readable from it.

Approver needs: confidence that a peer can execute this unaided, and how long it takes.
Leave out: commentary explaining why a step is written the way it is. Never a step itself.

## Risk and impact analysis
*(Planning tab)*

Must cover all four:

1. the specific risks **if the change fails**;
2. the risks **if the change does not proceed**;
3. all downstream dependencies and impacts while the change executes;
4. how the change adheres to or affects privacy, regulatory and security compliance.

Point 2 is the one most often missed. Point 4 is not optional in a health context.

Approver needs: what breaks if it fails, what breaks if it does not run, and who is downstream.
Leave out: generic risk boilerplate true of any change; name only risks specific to this one.

## Backout plan
*(Planning tab)*

Step-by-step reversal, to the same standard as the implementation plan. Explicitly detail the
steps that return the system to its original state.

- Cover data, not just code or configuration. A rollback that restores a binary but leaves a
  migrated table is not a rollback.
- Name every team or role required. Q6 is derived from this, and the operator count is what
  decides the answer.

Approver needs: that a reversal exists, who performs it, and what happens to data.
Leave out: argument about whether backing out is desirable. State the steps and the teams.

## Backout duration
*(Planning tab)*

How long the backout takes, in days - hours - minutes - seconds. Must be a real number and must
be a reasonable length that fits within the change period.

Zero is never a valid answer.

Approver needs: a real number that fits inside the change period.
Leave out: prose. Numbers only.

## Test plan
*(Planning tab)*

Step-by-step instructions to test the change **from the customer's perspective**, to the same
standard as the implementation plan.

- Confirm absolutely no impact, in the terms a customer would notice.
- Include at least one end-to-end business transaction.
- If the tester is not the implementer, note it or add it as a separate task.
- State where evidence of validation will be stored.

Q4 and Q5 are both derived from this field. Whether validation happens inside or after the
implementation steps is what decides Q5, so make the timing explicit.

Approver needs: how success is confirmed from the customer's side, by whom, and when.
Leave out: speculation about what might go wrong - that belongs in Field 05. Never a step itself.

## Outage / service impact
*(Schedule tab)*

Whether an outage or degradation is required, and what a user would observe.

Free text, and the primary source for Q3. If this field says "no service interruption", Q3 cannot
be `Moderate` or `Significant`.

Approver needs: whether service is interrupted and what a user observes.
Leave out: mitigation detail; that is the Implementation plan.

## Conflicts
*(Conflicts tab)*

Known conflicts, dependencies and freeze periods. Any detected conflict must also be explained in
the Justification.

**Never fill this in from inference.** It requires the ServiceNow conflict checker run against the
real window. Emit the author-action marker.

Approver needs: whether the checker has run and what it found.
Leave out: guesses. Until the checker runs, the one-line author-action marker is the whole field.

## Related records
*(Related Records tab)*

References to related records - the driving Jira issue, a parent change, a related incident.

Fill only from something already known in the session, such as a Jira key that has actually been
seen. Otherwise emit the author-action marker.

Approver needs: references that let the approver find the driving work.
Leave out: unverified keys. A reference you have not actually seen is not a related record.

## The eleven fields

Labels verbatim from `SERVICENOW_MAP`.

| Field | Tab | Source |
|---|---|---|
| Short description | header | narrative |
| Description | header | narrative |
| Justification | Planning | narrative |
| Implementation plan | Planning | narrative |
| Risk and impact analysis | Planning | narrative |
| Backout plan | Planning | narrative |
| Backout duration | Planning | narrative |
| Test plan | Planning | narrative |
| Outage / service impact | Schedule | narrative — free text, and the primary source for risk Q3 |
| Conflicts | Conflicts | author action unless already known |
| Related records | Related Records | author action unless already known (e.g. a Jira key from the session) |
