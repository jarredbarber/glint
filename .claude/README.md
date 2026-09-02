# Claude config for this repo

`skills/work` and `skills/triage` are vendored here so the hosted GitHub Claude
integration (and contributors without them in `~/.claude/skills`) can run
`/work` and `/triage`. They are copied verbatim from the maintainer's setup;
edit the upstream copies and re-sync rather than forking behavior here.

ponytail: the `ponytail` skill is a plugin, not vendored. Install it from its
marketplace rather than copying its files into the repo. There is no Claude
GitHub Action workflow in `.github/` to wire a plugin install into yet; add the
marketplace/plugin install there if one is introduced.
