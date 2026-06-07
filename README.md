# SPITE

**Built out of spite. Made for control.**

An open-source, node-based visual canvas for AI filmmaking. Bring your own
API keys. Pay providers directly. Own your workflow.

SPITE was built because every AI filmmaking tool either traps you in a
credit system you can't audit, or assumes you're an ML engineer who enjoys
wiring up diffusion models by hand. This is neither. It's a production
canvas for people who think in shots and scenes — characters, prompts,
references, generated images, generated video, all on one infinite plane,
all owned by you.

---

## What it does

- **Node canvas.** Drag prompts, references, image generators, and video
  generators onto an infinite plane. Connect them. Hit Generate on any
  node and SPITE orchestrates the right model call.
- **Character consistency.** Tag images to a named folder
  (Character / Prop / Location), use `@FolderName` in any prompt, and
  SPITE wires the reference into every generation that mentions it.
- **Multi-model.** Nano Banana Pro, FLUX, Kling, Seedance, Luma Ray2,
  MiniMax Hailuo, Wan — all in one canvas, switchable per node, all
  routed through fal.ai with your own key.
- **Scenes and shots.** First-class production primitives. Tag a node as
  Shot 1 of Scene A; the scene strip at the top of the canvas keeps the
  structure visible.
- **Asset library.** Every generation persists, organised by date, model,
  and project. Protected from cleanup if used on a canvas.
- **Generation recovery.** When fal.ai stalls or the page reloads
  mid-generation, the recovery system pulls completed jobs back from fal
  within their 24h retention window. No other tool does this.
- **Cost-aware UX.** Estimated cost on every Generate button. Live fal.ai
  balance badge. `$25` confirmation threshold. Staggered batch submission.
  All built after a real $200-in-24-hours incident.
- **Export.** Storyboard zip with one folder per scene, files named by shot
  order. Drop it straight into Premiere or Resolve.
- **Snapshots.** Canvas state saves every three seconds. Point-in-time
  snapshots kept separately for recovery.
- **Auth.** Single-user password gate. The internet does not need to see
  your work.

## What it deliberately doesn't do

- No video editing — SPITE is pre-production.
- No real-time multi-user collaboration — single-user by design.
- No automation that makes creative decisions for you.
- No credit system, no markup, no subscription.

---

## Self-host

### Prerequisites

- Node 20+ and [pnpm](https://pnpm.io/) (or npm/yarn — pnpm is what we
  develop against)
- A free [Neon](https://neon.tech) account (Postgres)
- A [Cloudflare](https://dash.cloudflare.com) account with R2 enabled
  (S3-compatible storage; free tier covers most personal use)
- A [fal.ai](https://fal.ai) account with a funded key (the generation
  provider — you pay them directly per generation)

### Install

```bash
git clone <your-fork-url>
cd spite
pnpm install
```

### Configure

Copy the template and fill in real values:

```bash
cp .env.example .env.local
```

Every field is required except the ones marked optional. SPITE refuses to
boot with missing variables — it will route every request to a `/setup`
page listing what's missing, with hints. You won't be guessing.

Where to find each value:

| Variable | Source |
|---|---|
| `DATABASE_URL` | neon.tech → your project → Connection string |
| `R2_ACCOUNT_ID` | Cloudflare dashboard → R2 (right sidebar) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Cloudflare R2 → Manage API tokens → Create API token |
| `R2_BUCKET_NAME` | Whatever you named the bucket you created |
| `FAL_KEY` | fal.ai → Dashboard → Keys |
| `APP_PASSWORD` | You pick — strong, your responsibility |

### Database

Open your Neon project's SQL editor and paste the contents of
[`database-setup.sql`](./database-setup.sql). Hit Run. The script is
idempotent — re-running it is safe and won't touch existing data.

### Run

```bash
pnpm dev
```

Open `http://localhost:3000`, type the `APP_PASSWORD` you set, and you're
in.

---

## Deploy to Vercel

1. Push your fork to GitHub.
2. Import the repo on [vercel.com/new](https://vercel.com/new).
3. Vercel → Project → Settings → Environment Variables. Add every name
   from `.env.example` with its real value. (Don't commit `.env.local`
   to git — `.gitignore` should already block it. The included
   [`scripts/check-no-secrets.sh`](./scripts/check-no-secrets.sh) will
   catch you if you try.)
4. Trigger a deploy. The first deploy will route to `/setup` if anything
   is missing.

### Optional: cron cleanup

There's a scheduled cleanup endpoint at `/api/assets/cleanup` that
deletes old, unprotected generated assets after 30 days. To wire it up
on Vercel, add a `vercel.json` cron entry pointing at that path, and set
`CRON_SECRET` to a long random string (the endpoint requires it in the
`Authorization` header). Safe to skip entirely if you don't need
automatic cleanup.

---

## Project structure

```
app/                  Next.js App Router pages + API routes
  api/                Server-side endpoints (auth, generate, assets, R2 proxy)
  login/              The password gate
  setup/              Shown when required env vars are missing
  project/[id]/       The canvas for one project
components/
  canvas/             The node-based workspace (nodes, edges, toolbars)
  ui/                 shadcn/ui primitives
lib/
  env-check.ts        Refuse-to-boot env validation
  r2-upload.ts        R2 SDK wrapper + HMAC URL signing for the proxy
  fal-models.ts       Per-model config: endpoint, input shape, cost
  fal-cost.ts         Cost estimation + confirmation threshold
  mention-prompt.ts   Model-aware reference grammar compilation
docs/                 Brand guide + overview (background reading)
scripts/              Tooling (secret check, etc.)
database-setup.sql    Idempotent schema for first-time setup
middleware.ts         Auth gate + env-check redirect
```

## Contributing

Contributions are welcome — especially from people using AI tools in
real production workflows. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
how, what's useful, and what isn't.

If something is broken, file an issue with reproduction steps. If you
added a feature, explain what production problem it solves, not just what
it does.

The bar isn't perfection. It's honesty and usefulness.

## Disclaimer

SPITE is provided **as-is, with no warranty of any kind** (see
[`LICENSE`](./LICENSE) for the legal version — AGPL §15 and §16).
You're responsible for:

- **Your fal.ai bill.** The cost gates (per-button estimates, $25
  confirm dialog, live balance badge, server-side per-hour ceiling,
  kill switch) are best-effort. A bug, a misconfiguration, or a
  bypass we haven't anticipated could still result in unexpected
  charges. The hourly ceiling defaults to $100 and can be tuned via
  `SPEND_LIMIT_USD_PER_HOUR`.
- **The content you generate.** SPITE doesn't filter prompts or
  outputs. Whatever your chosen models do, you've made.
- **Your data.** Your assets live in your R2 bucket; your projects
  and metadata live in your Neon database. Nobody else has access.
  If SPITE breaks, the worst case is you redeploy and possibly drop
  a couple of tables. There's no central service that can lose your
  work — it's already in your storage.

If you find a security issue, report it via [GitHub Security
Advisories](https://github.com/Valiera00/SPITE/security/advisories/new),
not a public issue. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for
the rest of the disclosure flow.

## License

[AGPL-3.0-only](./LICENSE). If you fork SPITE and run it as a service,
your modified source must be available to your users. Self-hosting for
yourself or your team has no such obligation.

This license exists because the whole point of SPITE is that creative
infrastructure shouldn't disappear behind closed doors. Forking SPITE
and making it closed-source would defeat the project's reason for
existing.

---

> SPITE is not finished. That is the point. But it should always be
> getting more useful, not more complicated.
