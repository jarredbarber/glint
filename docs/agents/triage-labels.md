# Triage Labels

The skills speak in terms of canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

## Axes

Labels split across four **orthogonal** axes. Some are for agent routing, some exist only so the maintainer can scan the pile fast.

| Axis | Labels | Read by | Notes |
| ---- | ------ | ------- | ----- |
| **State** | `needs-triage` → gate → `ready-for-agent` | agent | the lifecycle; a leaf ends at `ready-for-agent` |
| **Human gate** | `needs-info`, `needs-action`, `needs-decision`, `needs-lgtm` | **maintainer (scan)** | which human action unblocks it |
| **Category** | `bug`, `feat`, `chore` | both | one question: broken / new-or-changed / upkeep |
| **Shape** | `epic` | **maintainer (scan)** | container, not a leaf; agents ignore it |
| **Parked** | `backlog` | agent | orthogonal flag, NOT a state peer |
| **Closed** | `wontfix` | both | will not be actioned |

A triaged **leaf** issue carries exactly one category and exactly one state (a gate counts as its state). `backlog` and `epic` are flags layered on top, not states.

### Canonical role → tracker string

| Canonical role (mattpocock/skills) | Tracker label | Meaning |
| ---------------------------------- | ------------- | ------- |
| `needs-triage`    | `needs-triage`    | agent needs to evaluate this issue |
| `needs-info`      | `needs-info`      | blocked: human must supply information |
| `ready-for-agent` | `ready-for-agent` | fully specified, ready for an AFK agent |
| `ready-for-human` | one of `needs-info` / `needs-action` / `needs-decision` / `needs-lgtm` | blocked on the human; pick by action type (below) |
| `wontfix`         | `wontfix`         | will not be actioned |

There is no `ready-for-human` string (it fans out, below). Canonical `enhancement` also fans out into `feat` vs `chore`, below. Because the fan-outs live here in the mapping, the upstream skill needs no edits.

## Category (canonical `enhancement` fans out)

Canonical `bug` maps straight to `bug`. Canonical `enhancement` picks one:

- `feat` — new or changed **product behavior** a user would notice.
- `chore` — upkeep with **no** product-behavior change (dep bumps, behavior-preserving refactors, infra, CI, docs).

If a user would notice the difference, it's `feat`; otherwise `chore`.

## The human gate (was `ready-for-human`)

Nearly all tasks are done by agents, including design, review, and research. The human is a **gate**, not an alternate executor: an issue passes *through* a gate and returns to `ready-for-agent`, it does not terminate there. Pick the gate by **what the human must do**, so the maintainer knows the effort before opening the issue:

- `needs-info` — supply a fact or clarification the agent is missing.
- `needs-action` — do something out-of-band the agent can't (set up an account, publish, flip a dashboard setting).
- `needs-decision` — make a judgment call with no objective acceptance criteria (design, direction, priorities), including reviewing agent work.
- `needs-lgtm` — sign off / approve finished work. A lightweight `needs-decision`; kept separate so approvals batch.

`needs-info` is **double-booked**: it is also the pre-triage "waiting on reporter" state. In practice the pre-triage use is rare; treat the label as position-independent ("blocked on human info, wherever we are").

### When to gate

Gate **only** when the agent cannot verify its own work or cannot proceed without the human:

- **UI changes** — agent can't see the result → `needs-decision` (review).
- **Auth/credential-dependent work** — agent can't access the service → `needs-action`.
- **Subjective / product decisions** — no objective acceptance criteria → `needs-decision`.
- **Missing spec detail** — → `needs-info`.

Do **not** gate for: implementation choices (library, pattern, structure), behavior-preserving refactors, bug fixes with testable acceptance criteria, config/API/feature work with an unambiguous spec, or anything the agent can test. **If acceptance criteria are testable and the agent can verify them, do the work and close.**

### Who gates

Both the triaging agent and the implementing agent can move an issue to a gate. Triage catches obvious cases (design, ambiguous scope); the implementing agent gates if it discovers a judgment call mid-flight. The bar is "I literally cannot verify or proceed," not "the maintainer might have an opinion."

### The checkpoint brief

When an agent gates an issue, it posts a checkpoint brief. Key rules:

- **Include the session link** so the maintainer can `--continue` to ask follow-ups.
- **Artifacts live in the issue comment, not in repo files.** The comment is self-contained; the reviewer never needs to open another file to decide.
- **No "Recommendation: Approve."** The agent wrote the work; of course it recommends approval. Show **key decisions** (what was chosen over what and why) and **risks** so the reviewer spots wrong turns fast.

The human responds:

- **Approve:** comment "approved" or move to `ready-for-agent`.
- **Revise:** comment feedback and move to `ready-for-agent`.
- **Reject:** close the issue.

### Straightforward tasks

Not every task needs gating. Clear acceptance criteria the agent can verify → complete and close directly. No checkpoint, no gate.

## Epics

An `epic` is a **container**: a body of work that does not reduce to a single `ready-for-agent → done`. Split it into sub-issues (GitHub native sub-issues) and tag the parent `epic`. The parent's completion (all children closed) is the "is this whole thing done?" signal. Agents ignore the label — they execute the children, which flow through the normal machine. The parent is never `ready-for-agent`, so the `ready` filter skips it for free.
