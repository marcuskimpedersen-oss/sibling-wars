# Testing — Sibling Wars

100% test coverage is the goal. Tests let you move fast, trust your instincts, and ship with confidence — without them, vibe coding is just yolo coding. With tests, it's a superpower.

## Framework

**vitest v4** — integrates natively with the existing Vite build. Same path aliases (`@/`), same TypeScript config, zero extra overhead.

## How to run

```bash
npm test           # run all tests once
npm run test:watch # watch mode while developing
```

## Test layers

### Unit tests (`tests/`)

Pure TypeScript logic with Phaser and project dependencies mocked. Good for:
- AI behavior (EnemyAI.ts)
- Combat calculations (CombatSystem.ts)
- Utility functions

### What can't be unit-tested easily

Anything that calls `scene.add.*`, `sprite.x`, or other Phaser renderer internals needs a full Phaser instance. For those, manual playtesting or a Playwright E2E harness is the right tool.

## Conventions

- Test files live in `tests/` and are named `*.test.ts`
- Use `vi.mock()` to isolate Phaser and project module dependencies
- Every regression test gets a comment block: `// Regression: ISSUE-NNN — what broke`
- Assert on *behavior*, not just "it doesn't throw" — test what the code *does*
