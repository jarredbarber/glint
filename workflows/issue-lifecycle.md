# Issue Lifecycle

State machine and checkpoint protocol for GitHub Issues.

## States

```
                    ┌─────────────┐
                    │ needs-triage│
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌───────────┐ ┌──────────┐ ┌────────┐
        │ needs-info│ │ready-for-│ │ wontfix│
        └─────┬─────┘ │  agent   │ └────────┘
              │        └────┬─────┘
              │             │
              └──────┐      │ agent works
                     ▼      ▼
               ┌───────────────┐
               │ ready-for-    │◄──── agent can't verify
               │   agent       │      its own work
               └───────┬───────┘
                       │
          ┌────────────┼──── can verify ──── ✓ close
          │            │
          ▼            │
   ┌──────────────┐    │
   │ ready-for-   │    │
   │   human      │    │
   └──────┬───────┘    │
          │            │
    human reviews      │
          │            │
    ┌─────┼─────┐      │
    ▼     ▼     ▼      │
 approve revise reject │
    │     │     │      │
    │     │     ▼      │
    │     │   close    │
    │     │            │
    └─────┴────────────┘
       ready-for-agent
```

## Escalation rule

An agent moves an issue to `ready-for-human` **only** when it cannot verify its own work:

1. **UI changes** — no way to see the rendered result
2. **Auth/credential-gated** — can't access the service to test
3. **Subjective** — no objective acceptance criteria
4. **Product-level** — direction, priorities, scope decisions

Everything else: complete the work, verify it, close the issue.

Both the triaging agent and the implementing agent can escalate. The bar is "I cannot verify this," not "the maintainer might have a preference."

## Checkpoint brief

When moving an issue to `ready-for-human`, post this as a comment:

```markdown
## Checkpoint

**What was done:** one-line summary

**Artifact:** link to file/PR/comment (if any)

**Decision needed:** what specifically you're being asked to approve or weigh in on

**Recommendation:** agent's suggested path forward

**To approve:** comment "approved" (or just move to ready-for-agent)
**To revise:** comment with feedback (move to ready-for-agent)
**To reject:** close the issue
```

## Human response

The human reads the checkpoint brief and does one of:

| Action | What to do | What happens next |
|--------|-----------|-------------------|
| **Approve** | Comment "approved" and/or relabel `ready-for-agent` | Agent picks up and executes the proposal |
| **Revise** | Comment with specific feedback, relabel `ready-for-agent` | Agent reworks based on feedback |
| **Reject** | Close the issue | Done |

The agent reads the latest comment to understand which response was given. No extra labels needed.

## Agent brief (for `ready-for-agent`)

When an issue moves to `ready-for-agent` (whether from triage or from human approval), an agent brief should be attached. See `docs/agents/AGENT-BRIEF.md` for the template and principles (note: that file lives outside this repo at `.agents/skills/triage/AGENT-BRIEF.md`).
