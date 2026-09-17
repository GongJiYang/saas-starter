# Repository Guidelines

## Project Overview

This repository is a Next.js SaaS starter being extended into a team-based, SKU-focused AI video advertising workflow. Users manage workspaces, Brand Kits, product assets, Campaigns, Shot Cards, asynchronous MiniMax H3 video jobs, reviews, and delivery artifacts.

The product layer is responsible for product facts, brand constraints, controlled creative experiments, generation recipes, QA, and approval. MiniMax H3 is the video executor; BullMQ/Redis handles asynchronous submission and polling.

## Architecture & Data Flow

```text
Next.js App Router UI
  → server actions / route handlers
  → team-scoped Drizzle queries
  → Postgres
  → BullMQ producer → Redis → workers/index.ts
  → MiniMax H3 submit / delayed poll
  → COS archive and signed download
  → Review and Activity Log
```

Important boundaries:

- `requireWorkspace()` establishes the authenticated team context; server actions validate inputs with Zod.
- Every product query and mutation must enforce `teamId` ownership.
- `lib/minimax/video.ts` is the provider boundary; do not call MiniMax directly from UI code.
- `lib/storage/cos.ts` owns private object keys and signed URLs.
- `lib/video-jobs/worker.ts` owns job submission, polling, archiving, and state transitions.
- Shot Skill Card work belongs under `lib/shot-skills/`: validate structured cards, calculate eligibility, compile provider-neutral recipes, adapt to H3, and preserve skill/version/hash snapshots.
- `ShotPlan`/`GenerationRecipe` must be immutable for retries. A retry reuses the frozen recipe and must not silently switch skill versions.
- Legacy `ShotCard` rows remain current persistence during migration, but new behavior must not treat a legacy card as the final customer deliverable.

## Key Directories

- `app/`: Next.js App Router pages, layouts, server actions, API routes, and client components.
- `app/(dashboard)/dashboard/`: authenticated workspace UI for campaigns, Brand Kits, jobs, reviews, activity, and settings.
- `lib/auth/`: session and middleware helpers.
- `lib/workspace/`: workspace membership and access checks.
- `lib/db/`: Drizzle schema, migrations, team-scoped queries, seed/setup scripts.
- `lib/queue/`: Redis/BullMQ connection and queue producers.
- `lib/video-jobs/`: job state machine and worker operations.
- `lib/minimax/`: server-only MiniMax API adapter.
- `lib/storage/`: Tencent COS object storage integration.
- `lib/campaigns/`: current campaign/Shot Card templates.
- `lib/shot-skills/`: A1 internal Shot Skill Card runtime and provider compilation.
- `lib/bulk/`: batch CSV, readiness, reference, Creative Spec, state, Pilot, Wave, remediation, and cost contracts.
- `scripts/`: executable Phase 0 experiments, fixtures, blind review, and smoke tooling.
- `workers/`: independent BullMQ worker entry point.
- `docs/product/`: product contracts and implementation task lists.
- `docs/development/`: external prerequisites and operational setup.

## Development Commands

Install dependencies with the repository package manager:

```bash
pnpm install
pnpm dev
pnpm build
pnpm start
```

Database setup and migrations:

```bash
pnpm db:setup
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:studio
```

Run the asynchronous worker separately when Redis, Postgres, COS, and MiniMax are configured:

```bash
pnpm worker
```

Existing experiments:

Batch contract checks:

```bash
pnpm bulk:contract-check
```

```bash
pnpm phase0:creative-test
pnpm sample:30
pnpm exec tsx scripts/<focused-script>.ts
```

`sample:30` also requires FFmpeg. Networked experiments require valid server secrets and may create external model/storage costs.

## Code Conventions & Common Patterns

- TypeScript is strict, `noEmit`, ESNext, and uses the `@/*` alias rooted at the repository.
- Prefer small typed functions and explicit return types at server/provider boundaries.
- Validate external input with Zod before persistence or provider calls; use `safeParse` when returning user-facing action errors.
- Use `requireWorkspace()` in server actions and pass the resulting `workspace.team.id` into every team-scoped query.
- Keep secrets and MiniMax/COS access server-only. Never expose API keys or private object keys to browser code.
- Keep database writes transactional when multiple rows or activity logs must remain consistent.
- Use Drizzle query builders with explicit `and(eq(table.teamId, teamId), ...)` ownership predicates.
- Use `async`/`await`; return provider errors with meaningful typed/error fields and preserve retryability.
- Use BullMQ job IDs and delayed polling rather than busy loops. Workers must handle SIGINT/SIGTERM and close connections gracefully.
- Preserve immutable snapshots for prompts, model parameters, input asset versions, and skill versions. Do not overwrite approved recipes.
- Use `camelCase` for TypeScript variables/functions, `PascalCase` for React components/types, `snake_case` for SQL column names, and descriptive `kebab-case` route directories.
- Follow existing Tailwind/shadcn UI patterns; server pages load data, client components handle form state and interaction.
- Avoid adding abstractions, dependencies, or UI editors before the product contract and a focused validation prove they are needed.

## Important Files

- `package.json`: scripts, runtime dependencies, and package manager expectations.
- `tsconfig.json`: strict compiler settings and `@/*` path alias.
- `next.config.ts`: Next experimental settings.
- `drizzle.config.ts`: PostgreSQL schema and migration configuration.
- `.env.example`: required local environment variables; never commit `.env` or secrets.
- `lib/db/schema.ts`: current Postgres tables/enums and inferred types.
- `lib/db/drizzle.ts`: database client and schema registration.
- `lib/minimax/video.ts`: MiniMax H3 create/query API contract.
- `lib/video-jobs/worker.ts`: submission/polling/archival execution path.
- `lib/video-jobs/state.ts`: legal video job transitions.
- `workers/index.ts`: BullMQ worker process and graceful shutdown.
- `docs/product/market-validation-mvp.md`: current single-SKU product contract.
- `docs/product/bulk-sku-production-atomic-tasks.md`: batch direction and A1 `SKILL-01`–`SKILL-16` tasks.
- `docs/product/shot-skill-card-blueprint.md`: complete Shot Skill Card design and boundaries.
- `scripts/run-phase0-creative-test.ts`: existing MiniMax-M3 planning, H3 submission, and artifact-producing experiment.
- `scripts/review-phase0-creative-test.ts`: blind review schema and quality review experiment.

## Runtime/Tooling Preferences

- Use Node.js-compatible TypeScript through `tsx`; use `pnpm` because `pnpm-lock.yaml` is authoritative.
- The application uses Next.js 15 canary, React 19, TypeScript 5.8, Drizzle ORM, PostgreSQL, Redis/BullMQ, Tencent COS, and MiniMax H3.
- Do not switch package managers or add Bun-specific runtime assumptions without an explicit decision.
- Keep MiniMax, Redis, Postgres, COS, and Stripe secrets in environment variables. `.env` is local-only.
- Use `dotenv/config` in standalone scripts and worker entry points where existing scripts do so.
- Prefer repository tools and focused scripts over ad-hoc global binaries.

## Testing & QA

There is no configured Jest, Vitest, or Playwright suite. Existing verification is script-based:

- Pure Shot Skill Card schema, registry, eligibility, compiler, hash, and precedence checks should be deterministic and network-free.
- Run focused checks with `pnpm exec tsx scripts/<script>.ts`.
- Reuse `scripts/phase0-sku-fixtures.json` for real-SKU-shaped inputs, but do not treat historical `pain/benefit/scene` as the universal product contract.
- Networked MiniMax/COS experiments are smoke tests, not unit tests; record output artifacts, model cost, latency, retries, and QA decisions.
- A1 requires baseline-vs-Skill comparison with the same SKU, assets, model, duration, ratio, and parameters. Track product-fidelity pass rate, shot-structure compliance, first-usable rate, retries, cost, latency, and prompt size.
- A generation success is not a quality pass. Blocking product-fidelity failures must prevent assembly or delivery.
- Before completing a change, run `pnpm exec tsc --noEmit`; run `pnpm build` for changes affecting Next compilation or route behavior.
- Do not claim a live provider or browser flow passed unless it was actually exercised and its artifacts or response were observed.
