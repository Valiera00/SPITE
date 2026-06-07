# Contributing to SPITE

SPITE is early and unfinished. That is intentional.

Contributions are welcome, especially from people using AI tools in
real production workflows — not people who want to theorize about
them. The bar is not perfection. It's honesty and usefulness.

## What's useful right now

- **Bug reports with clear reproduction steps.** Tell us what model,
  what input, what you expected, what happened. Screenshots of the
  canvas state help.
- **Model integrations.** New fal.ai endpoints, support for other
  providers (Replicate, Runway, etc.), better per-model defaults.
- **Workflow improvements.** Anything that removes friction from
  real AI filmmaking — character consistency, batch operations,
  asset organisation, export.
- **Documentation that explains things plainly.** Especially for
  non-technical creators trying to self-host.
- **Performance.** The canvas is React Flow at scale; if you can
  make it faster on a 200-node project, that's worth a lot.

## What's not useful right now

- Rebrand proposals. The brand is settled.
- Feature requests with no production context — "it would be cool if
  SPITE could X" without explaining the workflow problem X solves.
- PRs that solve problems nobody working in AI filmmaking actually
  has.
- Refactors for the sake of refactoring. SPITE prioritises clarity
  for non-coders reading the code, not architectural purity.

## How to contribute

1. **Bug?** Open an issue with reproduction steps. Templates will
   prompt you for what we need.
2. **Feature idea?** Open a **Discussion** first — explain the
   workflow problem it solves, not just the feature itself. This
   saves you the time of building something we won't merge.
3. **Fix or improvement ready?** Open a PR. Reference the issue or
   discussion it solves. Keep changes focused — one fix per PR.
4. **Security issue?** Don't open a public issue. Email the
   maintainer directly (see repo About). We'll coordinate disclosure
   privately.

## Code expectations

- TypeScript everywhere. Strict mode on.
- Comments explain *why*, not *what*. Trust the reader to read the code.
- New env vars go in `.env.example` with a comment explaining where
  to obtain them.
- Database schema changes go in `database-setup.sql` AND are idempotent
  (use `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... IF NOT EXISTS`).
- Server-side spend or auth changes need a corresponding change to
  the pentest checklist — the goal is that no contribution silently
  weakens existing controls.

## License

By contributing, you agree your contribution is licensed under the
same AGPL-3.0 terms as the rest of the project.

---

SPITE is not finished. That is the point. But it should always be
getting more useful, not more complicated.
