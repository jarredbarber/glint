# Claude config for this repo

`skills/work` and `skills/triage` are vendored here so the hosted GitHub Claude
integration (and contributors without them in `~/.claude/skills`) can run
`/work` and `/triage`. They are copied verbatim from the maintainer's setup;
edit the upstream copies and re-sync rather than forking behavior here.

ponytail: the `ponytail` skill is a plugin, not vendored. It is enabled via
config in `settings.json` (`extraKnownMarketplaces` + `enabledPlugins`), which
both local Claude Code and the `@claude` GitHub bot read, so it loads from its
marketplace instead of being copied into the repo.

The `@claude` bot runs via `.github/workflows/claude.yml`
(`anthropics/claude-code-action`). It checks out the repo, so it picks up these
skills and `settings.json` automatically. It needs an `ANTHROPIC_API_KEY` repo
secret and the Claude GitHub App installed on the repo (run `/install-github-app`
in Claude Code, or add the secret under Settings -> Secrets -> Actions).
