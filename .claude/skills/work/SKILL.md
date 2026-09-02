---
name: work
description: Execute issues that triage has marked ready-for-agent. Pick one by number, or drain the queue. Counterpart to /triage (intake); this is execution.
disable-model-invocation: true
---

# Ready

`/triage` produces `ready-for-agent` issues; `/ready` consumes them. This is the execution half of the loop. It works from the **agent brief** on the issue (the contract), not the raw body.

Roles are canonical; the tracker's label strings and the human-gate fan-out live in the project's triage-labels mapping (provided to you). If it isn't, tell the user to run `/setup-matt-pocock-skills`.

## The queue

Executable leaves are `ready-for-agent` and not parked:

```bash
gh issue list --label ready-for-agent --search "-label:backlog" \
  --json number,title,updatedAt --jq 'sort_by(.updatedAt)[] | "\(.number)\t\(.title)"'
```

## Invocation

- `/work` — show the queue (see "## Ordering"), and let the maintainer pick. Do not auto-drain unless they say "work the whole queue" / "drain it". 
- `/work 132` — execute issue #132 directly.
- `/work drain` — work the queue, one issue per commit, stopping at the first that needs a gate or fails.

## Executing one issue

1. **Read the brief.** `gh issue view <n> --comments`. The agent brief comment is the contract; the body and discussion are context. If there is no brief, the issue isn't actually ready — tell the maintainer and stop (or offer to `/triage` it).
2. **Explore fresh.** The brief is behavioral, not procedural, and may be stale on paths. Find the real code via the project's domain glossary (`CONTEXT.md`, ADRs). Respect ADRs in the area.
3. **Do the work.** Implement to the brief's acceptance criteria. Stay inside its scope boundaries; don't gold-plate.
4. **Verify.** Run the project's tests / build (`AGENTS.md` lists them). Every acceptance criterion must be independently checked. If you can't verify it, that's a gate signal (below), not a reason to close.
5. **Ship.** Commit and push per the project's rules (this repo: commit + push to `main`, no PR). Reference the issue in the commit.
6. **Close.** `gh issue close <n> --comment "..."` summarizing what shipped and how it was verified.

## When you can't finish: gate, don't close

If mid-flight you hit something you cannot verify or cannot do, move the issue to a **human gate** instead of closing. Pick the gate by what the human must do (see triage-labels): `needs-info`, `needs-action`, `needs-decision`, or `needs-lgtm`. Post a checkpoint brief: key decisions (chosen over what, why), risks, and the session link. No "Recommendation: Approve." Then move on.

The bar for gating is "I literally cannot verify or proceed," not "the maintainer might have an opinion." If acceptance criteria are testable and you verified them, just close.

## Ordering

When draining or displaying, order the issues by priority. This is semi-subjective.

Things that increase priority: older, simplicity, centrality (unblocks other work), likelihood of autonomous completion.
Things that decrease priority: complexity, likelihood of needing human gating (review, manual testing) that would block other work.


## Draining

When draining the queue, work autonomously according to '## Ordering'.

In `drain` mode, do the above per issue, committing each separately. Stop and report at the first issue that needs a gate or whose verification fails — don't skip past it and don't batch unrelated changes into one commit.
