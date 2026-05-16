# Engineering Guardrails

## Quality Gate

### One Local CI Command
- Intent: Keep local and CI validation identical.
- Operator command(s): `make all`
- Enforcement: `.github/workflows/ci.yml` runs `make all`.
- Failure signal: lint or tests exit non-zero.
- Recovery: run `make lint` or `make test`, fix failures, rerun `make all`.

### TypeScript Strictness
- Intent: Catch extension/runtime API mistakes before loading Pi.
- Operator command(s): `make lint`
- Enforcement: `npm run lint` runs `tsc --noEmit` with `strict: true`.
- Failure signal: TypeScript diagnostics.
- Recovery: fix types or add narrow local types; avoid broad `any`.

### Co-located Tests
- Intent: Keep behavior tests near implementation.
- Operator command(s): `make test`
- Enforcement: Vitest discovers `src/**/*.test.ts`.
- Failure signal: failing unit test.
- Recovery: write/adjust focused tests before changing behavior.

## Repository Hygiene

### No Generated Dependencies in Git
- Intent: Keep commits reviewable and small.
- Operator command(s): `git status --short`
- Enforcement: `.gitignore` excludes `node_modules/`, `.tmp/`, `dist/`, `coverage/`.
- Failure signal: generated folders appear in status or staged diff.
- Recovery: unstage generated files and update `.gitignore` if needed.

### Semantic Commits
- Intent: Make history searchable and release-friendly.
- Operator command(s): `git commit -m "feat: add behavior"`
- Enforcement: review convention; no hook yet.
- Failure signal: vague or non-imperative commit message.
- Recovery: create a new corrective commit; do not amend unless explicitly requested.

## Extension Runtime

### Auto Messages Must Wait for Idle
- Intent: Avoid Pi runtime errors from sending while agent is processing.
- Operator command(s): `pi -e ./src/index.ts`, then `/auto 3`
- Enforcement: implementation checks `ctx.isIdle()` before `pi.sendUserMessage()`.
- Failure signal: Pi reports agent already processing.
- Recovery: adjust scheduling; keep idle check covered by tests where practical.

## Anti-patterns

- Do not stage `node_modules/`.
- Do not add CI-only checks without a matching `make` target.
- Do not change `/auto` behavior without co-located tests.
- Do not rely on prose-only process; add commands or enforcement.
