# Architecture — pi-auto

## What it is

A pi extension that adds the `/auto` command: repeat a message N times, waiting for each agent turn to complete before sending the next.

## Stack

- TypeScript (strict, ES2022, NodeNext modules)
- Vitest for testing
- `@mariozechner/pi-coding-agent` SDK

## Structure

```
src/
  index.ts                        # Entrypoint — re-exports from infra/
  index.test.ts                   # Tests (colocated with entrypoint)
  lib/
    auto-helpers.ts               # Pure functions: parse, text extraction
  infra/
    register-auto-command.ts      # Extension registration + timer lifecycle
  domain/
    .gitkeep                      # Placeholder — no domain logic yet
  fixtures/
    .gitkeep                      # Placeholder — no test fixtures yet
docs/
  engineering/                    # Guardrails, commands, landing checklist
  ARCHITECTURE.md                 # This file
```

## Dependency direction

```
index.ts → infra/register-auto-command.ts
                                ↓
         lib/auto-helpers.ts (pure, no SDK runtime deps)
```

**Rule:** `lib/` never imports from `infra/` or the SDK at runtime. `infra/` imports from `lib/`. Domain code (when it appears) imports from `lib/` only.

External coupling is isolated in `infra/`. Pure helpers have zero SDK runtime dependency.

## Module boundaries

| Module                        | Owns                                                         | Side effects             |
| ----------------------------- | ------------------------------------------------------------ | ------------------------ |
| `lib/auto-helpers`            | `parseAutoArgs`, `textFromContent`, `getLastUserMessageText` | None — pure functions    |
| `infra/register-auto-command` | `/auto` command registration, timer lifecycle                | Yes — pi API, setTimeout |
| `domain/`                     | Business rules (when needed)                                 | None                     |
| `fixtures/`                   | Test data files                                              | None                     |

## Config precedence

defaults < package.json `"pi"` config < runtime args

## Quality gates

See [engineering/guardrails.md](engineering/guardrails.md) for full policy → command → enforcement chain.

| Gate       | Command         | CI              |
| ---------- | --------------- | --------------- |
| Type check | `make lint`     | yes             |
| Tests      | `make test`     | yes             |
| Coverage   | `make coverage` | no (local only) |
| Full       | `make all`      | yes             |

## Anti-patterns

- DO NOT add runtime dependencies without justification
- DO NOT import from `infra/` inside `lib/` or `domain/`
- DO NOT introduce mutable state outside `infra/`
- DO NOT skip `make all` before committing
