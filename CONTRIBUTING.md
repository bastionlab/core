# Contributing

Thanks for helping. Bug reports, fixes and new add-ons are all welcome.

## Before you start

- Bigger changes: open an issue first so we can agree on the shape.
- New features go into an add-on (`templates/new-addon <id> "<Name>"`), not into the core. See
  [docs/architecture.md](docs/architecture.md) and `.claude/rules/` for how the code is laid out.
- No hardcoded addresses, CT ids or names: they come from `/etc/dash/config.json`.
- The UI is phone-first and English; new strings go through `$t()` (`scripts/i18n-lint` checks).

## Sign your commits (DCO)

There is no CLA. Instead every commit carries a sign-off line, which says you wrote the change or have the right
to submit it under the project's license ([Developer Certificate of Origin](https://developercertificate.org)):

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds it for you. Contributions to the core are licensed under the AGPL-3.0, like the rest of it.

## Code of Conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security issues

Not in public issues, please: see [SECURITY.md](SECURITY.md).
