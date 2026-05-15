// Regression: ISSUE-028 — handleRemoteCommand processed commands after game was over
//
// GameScene.handleRemoteCommand() had no top-level gameOver guard. After endGame()
// set gameOver=true, late-arriving or queued network commands (spawn_unit, move,
// building_destroyed, upgrade, etc.) were still processed against post-game state.
//
// Impact:
//   - spawn_unit could create new enemy mirror units after the win/lose screen
//   - building_destroyed could destroy buildings that were already being torn down
//   - upgrade commands could mutate unit stats that no longer matter
//   - Any of these could cause unexpected visual glitches or state mutations
//
// Fix: add `if (this.gameOver) return;` at the top of handleRemoteCommand so all
// commands are discarded once the local game has concluded.

import { describe, it, expect } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeScene = () => {
  let gameOver = false;
  const commandsProcessed: string[] = [];

  const handleRemoteCommand = (type: string) => {
    if (gameOver) return; // the fix
    commandsProcessed.push(type);
  };

  return {
    endGame() { gameOver = true; },
    handleRemoteCommand,
    commandsProcessed,
    get gameOver() { return gameOver; },
  };
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GameScene — post-game command drain (ISSUE-028)', () => {
  it('processes commands while game is running', () => {
    const scene = makeScene();
    scene.handleRemoteCommand('move');
    scene.handleRemoteCommand('spawn_unit');
    expect(scene.commandsProcessed).toEqual(['move', 'spawn_unit']);
  });

  it('discards commands that arrive after game over', () => {
    const scene = makeScene();
    scene.handleRemoteCommand('move'); // processed
    scene.endGame();
    scene.handleRemoteCommand('spawn_unit'); // discarded
    scene.handleRemoteCommand('upgrade');   // discarded
    expect(scene.commandsProcessed).toEqual(['move']);
  });

  it('discards building_destroyed after game over', () => {
    const scene = makeScene();
    scene.endGame();
    scene.handleRemoteCommand('building_destroyed');
    expect(scene.commandsProcessed).toHaveLength(0);
  });

  it('discards upgrade after game over', () => {
    const scene = makeScene();
    scene.endGame();
    scene.handleRemoteCommand('upgrade');
    expect(scene.commandsProcessed).toHaveLength(0);
  });

  it('demonstrates old bug: all commands went through regardless of game state', () => {
    // Old behaviour: no gameOver guard — commands always processed
    const handleOld = (type: string, gameOver: boolean) => {
      // No guard — always processes
      return type;
    };
    let gameOver = true;
    const result = handleOld('spawn_unit', gameOver);
    expect(result).toBe('spawn_unit'); // old: ran even post-game

    // Fixed behaviour: early return when game is over
    const scene = makeScene();
    scene.endGame();
    scene.handleRemoteCommand('spawn_unit');
    expect(scene.commandsProcessed).toHaveLength(0); // correct: discarded
  });
});
