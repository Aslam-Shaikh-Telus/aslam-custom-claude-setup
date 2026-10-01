# Deriving the six Risk Assessment answers

The TELUS Health Change Risk Assessment has six required dropdowns. The Change Submission Quality
Guide specifies each one as a derivation from the narrative, not an independent judgement:

| Row in the guide | What the guide requires |
|---|---|
| Complexity | "Matches what is stated in justification and plan" |
| Customer affected | "Matches what is stated in justification and plan" |
| Impact to service | "Matches what is stated in justification and plan" |
| Peer review and testing | "Attested that change has been tested" |
| Validation | "Matches what is stated in the test plan" |
| Rollback | "Matches what is stated in the backout plan" |

So the derivation runs one way only: narrative first, answers computed from it. If an answer feels
wrong, the fix is to correct the narrative field, not to pick a different dropdown.

**Quote the option strings verbatim.** The bot matches on the string; a paraphrase is a defect.

---

## Q1 - How complex is the Change?

Options, verbatim:

1. `Not complex (1 type of CI, common steps, 1 team)`
2. `Somewhat complex (a few types of CIs, common steps, 1 - 3 teams involved)`
3. `Complex (Several CIs, tasks, teams and 2 - 3 Products / Services / Applications involved)`
4. `Very complex (Several CIs, tasks, teams and more than 3 Products / Services / Applications involved)`

Derive from: **Implementation plan** + **Description**.

| Narrative shows | Answer |
|---|---|
| One CI type, common steps, one team executing | 1 |
| A few CI types, common steps, 1-3 teams | 2 |
| Several CIs and tasks and teams, 2-3 products/services/apps | 3 |
| The same, but more than 3 products/services/apps | 4 |

**Guard.** If the implementation plan names two or more teams, `Not complex` is invalid. Count
teams by distinct operators the plan requires, not by how many people are in the room.

---

## Q2 - How many customers may be affected during the Change Window for the selected Application service and/or Configuration item?

Options, verbatim:

1. `None`
2. `Single customer`
3. `A few customers, or LPR / RC Environment`
4. `Many`
5. `All`

Derive from: **Description** + **Risk and impact analysis**.

| Narrative shows | Answer |
|---|---|
| No customer is affected at any point | 1 |
| Exactly one tenant or customer | 2 |
| A non-production environment, or an LPR / RC environment, or a handful of customers | 3 |
| A large subset of production customers | 4 |
| Every customer on the service | 5 |

**Guards.**
- On a non-production part, `All` is invalid - a stage change does not affect all customers.
- `None` is invalid if the Outage / service impact field declares any user-visible effect.

---

## Q3 - What is the impact to the Product / Service / Application during the implementation of this Change?

Options, verbatim:

1. `Insignificant (no impact to Prod)`
2. `Small (redundancy / no interruption of service)`
3. `Moderate (outage not expected, but possible)`
4. `Significant (outage required to implement Change)`

Derive from: **Outage / service impact** + **Description**.

| Narrative shows | Answer |
|---|---|
| Production is not touched at all | 1 |
| Redundancy or a rolling change absorbs it; service is not interrupted | 2 |
| No outage planned, but one is genuinely possible | 3 |
| An outage is required to implement | 4 |

**Guard - this is bot failure case 2.** If the narrative says "no service interruption", "no
impact", "no downtime" or equivalent, then `Moderate` and `Significant` are both invalid. Either
the answer drops to `Small`/`Insignificant`, or the narrative was overclaiming safety and must be
corrected. Decide which by asking, never by silently picking the one that passes.

---

## Q4 - Has this Change been fully peer reviewed, tested and deployed successfully in a comparable environment?

Options, verbatim:

1. `The Change has been fully tested`
2. `The Change has been fully tested, but there is no comparable environment`
3. `The Change cannot be tested`

Derive from: **Test plan** + whether a comparable environment exists.

| Narrative shows | Answer |
|---|---|
| Executable test steps, and a comparable environment it was proven in | 1 |
| Executable test steps, but nothing comparable to production exists | 2 |
| Testing is genuinely impossible for this change | 3 |

**Guard - this is bot failure case 1.** If the Test plan field holds real executable steps, then
`The Change cannot be tested` is invalid. These two statements cannot both be true in one record.
`The Change cannot be tested` is only permissible when the Test plan field itself says testing is
impossible and explains why.

---

## Q5 - How easy is it to validate that the Change was successful?

Options, verbatim:

1. `Easy (Change is validated by TH within the Change Window)`
2. `Medium (Change is validated by TH only after the Change Window)`
3. `Difficult (Change requires customer use and validation)`

Derive from: **Test plan** - specifically who validates, and when.

| Narrative shows | Answer |
|---|---|
| TH validates as part of the implementation steps, before standing down | 1 |
| TH validates only after implementation completes - a deferred check, a next-day review, a soak or monitoring period | 2 |
| Confirmation depends on a customer actually using the service | 3 |

**Guards.**
- If the test plan defers validation to a later day, or to a monitoring/soak period, `Easy` is
  invalid.
- If the test plan names the customer as the verifier, only `Difficult` is valid.

---

## Q6 - How difficult is it to roll back the Change?

Options, verbatim:

1. `Easy (Change can be rolled back by a single team within the Change Window)`
2. `Medium (Change can be rolled back within the Change Window, but requires multiple teams)`
3. `Difficult (Change cannot be rolled back and / or must be fixed outside the Change Window)`

Derive from: **Backout plan** + **Backout duration**.

| Narrative shows | Answer |
|---|---|
| A self-contained reversal one team performs alone | 1 |
| A reversal that needs multiple teams, or multiple systems reverted in step | 2 |
| No executable reversal, or recovery is fix-forward only | 3 |

**Guards - this is bot failure case 3.**
- If the backout plan names two or more teams, or two or more systems requiring separate
  operators, `Easy` is invalid.
- If the backout plan contains no executable reversal, only `Difficult` is valid.
- If **any** field in the record states that a component cannot be backed out, or can only be
  recovered by fixing forward, then `Easy` and `Medium` are both invalid for that record - even if
  the Backout plan field itself is clean, and even if that component is excluded from the Backout
  plan. Excluding it from one field does not remove it from the record the bot reads. Either take
  the component out of the change, or answer `Difficult`.
- Count operators, not steps. A ten-step backout one engineer runs alone is still `Easy`; a
  two-step backout needing a DBA and a network engineer is `Medium`.

---

## The three observed bot failures, worked

These are from a real work note where Submission Quality passed 12/12 and the record was still
returned.

**Case 1 - Q4 against the test plan.**

Bot said: "The answer 'The Change cannot be tested' contradicts the detailed test plan present in
the narrative."

What happened: the Test plan field was filled in properly with executable steps, and Q4 was set to
`The Change cannot be tested` anyway.

Correct handling: the Q4 guard trips before emission. The answer becomes
`The Change has been fully tested`, or `The Change has been fully tested, but there is no
comparable environment` if nothing comparable to production exists.

**Case 2 - Q3 against the narrative.**

Bot said: "The answer 'Moderate (outage not expected, but possible)' contradicts the narrative
stating 'no service interruption'."

What happened: the narrative promised no interruption while the risk answer hedged toward a
possible outage.

Correct handling: the Q3 guard trips. Ask which is true - if redundancy really does cover it, the
answer is `Small (redundancy / no interruption of service)`; if an outage is genuinely possible,
the narrative must stop claiming no interruption.

**Case 3 - Q6 against the backout plan.**

Bot said: "The answer 'Easy (Change can be rolled back by a single team within the Change Window)'
contradicts the backout plan which indicates a more complex rollback process."

What happened: the backout plan described a multi-team reversal while Q6 claimed a single team.

Correct handling: the Q6 guard trips on the team count and the answer becomes
`Medium (Change can be rolled back within the Change Window, but requires multiple teams)`.
