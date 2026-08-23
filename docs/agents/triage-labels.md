# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                    |
| -------------------------- | -------------------- | ------------------------------------------ |
| `needs-triage`             | `needs-triage`       | Agent needs to evaluate this issue         |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information   |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent    |
| `ready-for-human`          | `ready-for-human`    | Awaiting human review or decision          |
| `wontfix`                  | `wontfix`            | Will not be actioned                       |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Human vs. Agent

Nearly all tasks are done by agents, including design, review, and research. The upstream triage skill says `ready-for-human` means "needs human implementation" — in this project it means **"agent completed work, human needs to review or decide."**

### When to escalate to `ready-for-human`

Move an issue to `ready-for-human` **only** when the agent cannot verify its own work:

- **UI changes** — agent can't see the result
- **Auth-gated or credential-dependent work** — agent can't access the service
- **Subjective decisions** — no objective acceptance criteria exist
- **Product-level decisions** — project direction, priorities, what to build next

### When NOT to escalate

Do not escalate for:

- Implementation choices (library, pattern, code structure)
- Refactoring that preserves behavior
- Bug fixes with clear reproduction and testable acceptance criteria
- Adding config keys, API endpoints, or features where the spec is unambiguous
- Any task where the agent can run tests or otherwise verify the result

**If the acceptance criteria are testable and the agent can verify them, just do the work and close the issue.**

### Who can escalate

Both the triaging agent and the implementing agent can move issues to `ready-for-human`. Triage catches obvious cases (design tasks, ambiguous scope). The implementing agent escalates if it discovers a judgment call mid-flight. But the bar is "I literally cannot verify this," not "the maintainer might have an opinion."

### The checkpoint flow

When an agent moves an issue to `ready-for-human`, it posts a checkpoint brief (see `workflows/issue-lifecycle.md` for the full template). Key rules:

- **Include the session link** so the maintainer can `--continue` the session to ask follow-up questions.
- **Design artifacts live in the issue comment, not in repo files.** The checkpoint comment is self-contained — the reviewer should never need to open another file to understand the work or make a decision.
- **No "Recommendation: Approve."** The agent wrote the work; of course it recommends approval. Instead, show **key decisions** (what was chosen over what and why) and **risks** so the reviewer can spot wrong turns fast.

The human responds:

- **Approve:** comment "approved" or move to `ready-for-agent`. Agent picks up and executes.
- **Revise:** comment with feedback and move to `ready-for-agent`. Agent reworks based on the comment.
- **Reject:** close the issue.

### Straightforward tasks

Not every task needs human gating. If the issue has clear acceptance criteria and the agent can verify its work, the agent completes the task and closes the issue directly. No checkpoint, no `ready-for-human`.
