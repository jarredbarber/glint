# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Agent needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human information            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Human vs. Agent

Nearly all tasks are eventually done by agents. All design and review tasks should be ready-for-agent instead of ready-for-human. Ignore skills that say otherwise.

Humans are needed for a handful of things:

1. Making discrete high level decisions about the project's overall focus.
2. Approving the outputs of design tasks.
3. Approving follow-up work from review tasks.

Review, design, and research (tasks that are questions) tasks should be processed by agents and then moved to `ready-for-human` for inspection.

Follow up work from review and design tasks:

1. Create a new issue marked `needs-approval` containing the proposed follow up tasks.
2. Human approves and moves to ready-for-agent -> agent picks up, reads any feedback comments, and triages follow-up tasks into their own issues (most of which should be ready-for-agent).


