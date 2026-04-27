# Changelog

## [Unreleased] — feature/fix-elite-memory-leak

### Fixed
- **Memory leak: elite crown listeners never removed** — Every elite unit spawned after
  the 8-minute milestone registered a `scene.events.on('update', fn)` listener that was
  never cleaned up on game-over. After 30+ elites the scene accumulated 30+ dead listeners
  running every frame.
- **Crown text orphaned at game-over** — `EnemyAI.destroy()` now calls `crown.destroy()`
  on any still-active crown Text objects when the game ends, preventing orphaned visible
  sprites from lingering in the scene after game-over.

### Added
- `EnemyAI.destroy()` — cleans up all active crown updater listeners and destroys
  surviving crown Text objects. Called from `GameScene.endGame()`.
- `EnemyAI._crownUpdaters` — tracks `{ fn, crown }` pairs for every live elite so
  `destroy()` can reach both the listener and the sprite.
- `EnemyAI.PHASER_UPDATE` / `EnemyAI.CROWN_Y_OFFSET` — named constants replacing
  the `'update'` string literal and the `-38` magic number.
- `removeSelf` inline helper inside `crownUpdater` — deduplicates the two-line
  listener-removal block that previously appeared verbatim in both early-exit branches.
- vitest v4 test suite (`npm test`) with 5 regression tests in
  `tests/EnemyAI.destroy.test.ts` covering the `destroy()` contract.
- GitHub Actions CI workflow (`.github/workflows/test.yml`) — runs `npm test` on every
  push and pull request.
- `TESTING.md` — documents the test framework, conventions, and coverage strategy.
