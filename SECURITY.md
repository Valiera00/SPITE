# Security Policy

## Reporting a vulnerability

If you find a security issue in SPITE, **please do not open a public
issue.** Public disclosure gives an attacker a head start while a fix is
still being written.

Instead, report it privately through GitHub Security Advisories:

**[Report a vulnerability](https://github.com/Valiera00/SPITE/security/advisories/new)**

That opens a private channel visible only to you and the maintainer. Include:

- What the issue is and which file or route it affects
- How to reproduce it (steps, a request, or a proof-of-concept)
- What an attacker could do with it

You'll get an acknowledgement as soon as it's seen. Once a fix is out,
you're welcome to be credited in the advisory — or stay anonymous, your call.

## Scope

SPITE is a single-user, self-hosted app. Each deployment is owned and
operated by whoever runs it, with their own API keys, database, and storage.
The things most worth reporting:

- Auth bypass on the password gate or session handling
- Ways to make a deployment spend on its `FAL_KEY` beyond the cost gates
- SSRF, path traversal, or injection in the API routes
- Anything that exposes one deployment's assets or data to an outsider

Because every install is self-hosted with its own secrets, there is no
central service to attack — but a bug in the code would affect everyone who
runs it. That's what this policy is for.

## What is *not* a vulnerability

- Your own misconfiguration (a weak `APP_PASSWORD`, a public R2 bucket, a
  leaked `.env.local`). These are the operator's responsibility — see the
  README disclaimer.
- The known, documented trade-offs of a single-user app (no per-user
  accounts, no audit log).

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the rest of the disclosure flow.
