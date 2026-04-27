import Phaser from 'phaser';
import { BootScene } from '@/scenes/BootScene';
import { MenuScene } from '@/scenes/MenuScene';
import { LobbyScene } from '@/scenes/LobbyScene';
import { GameScene } from '@/scenes/GameScene';

window.addEventListener('error', (e) => {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#1a0000;color:#ff6666;padding:16px;font:13px monospace;z-index:99999;white-space:pre-wrap;max-height:50vh;overflow:auto;border-bottom:2px solid #ff4444';
  div.textContent = `JS ERROR: ${e.message}\n${e.filename}:${e.lineno}\n${e.error?.stack ?? ''}`;
  document.body.appendChild(div);
});
window.addEventListener('unhandledrejection', (e) => {
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#1a0000;color:#ff6666;padding:16px;font:13px monospace;z-index:99999;white-space:pre-wrap;max-height:50vh;overflow:auto;border-bottom:2px solid #ff4444';
  div.textContent = `UNHANDLED REJECTION: ${e.reason?.message ?? e.reason}\n${e.reason?.stack ?? ''}`;
  document.body.appendChild(div);
});

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#080818',
  scene: [BootScene, MenuScene, LobbyScene, GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const game = new Phaser.Game(config);

if (import.meta.env.DEV) {
  (window as any).__PHASER_GAME = game;
}

window.addEventListener('resize', () => {
  game.scale.resize(window.innerWidth, window.innerHeight);
});
