import Phaser from 'phaser';
import { UnitManager } from '@/units/UnitManager';
import { PathfinderService } from '@/pathfinding/PathfinderService';
import { SelectionBox } from '@/ui/SelectionBox';
import { TILE_SIZE, CAMERA_PAN_SPEED, EDGE_SCROLL_MARGIN, BASE_TILE } from '@/constants';

export class InputHandler {
  private scene: Phaser.Scene;
  private unitManager: UnitManager;
  private pathfinder: PathfinderService;
  private selectionBox: SelectionBox;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key; };
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private ctrlKey!: Phaser.Input.Keyboard.Key;
  private altKey!: Phaser.Input.Keyboard.Key;
  private aKey!: Phaser.Input.Keyboard.Key;
  private bKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;

  /** Tracks last press time per group for double-tap-to-center detection. */
  private lastGroupKeyTime: Map<number, number> = new Map();

  /** When true, next right-click issues an attack-move order instead of a plain move. */
  private attackMoveMode = false;
  private attackModeCursor: Phaser.GameObjects.Text | null = null;

  /**
   * Set when a right-click on an enemy unit has already been handled via
   * unit:rightClicked so that handleRightClick doesn't also issue a move command.
   */
  private attackTargetConsumed = false;

  /** Camera bookmarks for F2-F4 (world-space centre positions). */
  private cameraBookmarks: Map<number, { x: number; y: number }> = new Map();

  /** True when we are waiting for the player to right-click a patrol destination. */
  private patrolMode = false;
  private patrolCursorText: Phaser.GameObjects.Text | null = null;
  private patrolLineGfx: Phaser.GameObjects.Graphics | null = null;

  /**
   * If set, right-click world coordinates are passed here instead of the
   * default moveSelectedUnits behaviour. Return true to consume the click.
   */
  onRightClick: ((worldX: number, worldY: number) => boolean) | null = null;

  constructor(scene: Phaser.Scene, unitManager: UnitManager, pathfinder: PathfinderService) {
    this.scene = scene;
    this.unitManager = unitManager;
    this.pathfinder = pathfinder;
    this.selectionBox = new SelectionBox(scene);

    this.cursors = scene.input.keyboard!.createCursorKeys();
    this.wasd = {
      up:    scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.shiftKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.ctrlKey  = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);
    this.altKey   = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ALT);
    this.aKey    = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.bKey    = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.B);
    this.eKey    = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    scene.events.on('unit:clicked', (unit: import('@/units/Unit').Unit) => {
      unitManager.handleUnitClick(unit, this.shiftKey.isDown);
    });

    scene.events.on('unit:rightClicked', (unit: import('@/units/Unit').Unit) => {
      if (unit.faction === 'enemy' && unit.isAlive() && unitManager.getSelectedCount() > 0) {
        this.attackTargetConsumed = true;
        if (this.attackMoveMode) this.setAttackMoveMode(false);
        unitManager.attackTargetUnit(unit);
      }
    });

    // Space: pause / unpause
    scene.input.keyboard!.on('keydown-SPACE', () => {
      scene.events.emit('input:togglePause');
    });

    // + / = : speed up     - : slow down     0 : reset to 1×
    scene.input.keyboard!.on('keydown-PLUS',  () => scene.events.emit('input:speedUp'));
    scene.input.keyboard!.on('keydown-EQUALS',() => scene.events.emit('input:speedUp'));
    scene.input.keyboard!.on('keydown-MINUS', () => scene.events.emit('input:speedDown'));
    scene.input.keyboard!.on('keydown-ZERO',  () => scene.events.emit('input:speedReset'));

    // A-key: enter attack-move mode (cursor changes to indicate next click is A-move)
    scene.input.keyboard!.on('keydown-A', () => {
      if (unitManager.getSelectedCount() === 0) return;
      this.setAttackMoveMode(true);
    });

    // Command card A-button: same as A-key
    scene.events.on('input:startAttackMove', () => {
      if (unitManager.getSelectedCount() === 0) return;
      this.setAttackMoveMode(true);
    });

    // Command card S-button: stop selected units
    scene.events.on('input:stopUnits', () => {
      unitManager.stopSelectedUnits();
    });

    // ESC: cancel attack-move mode and patrol mode
    scene.input.keyboard!.on('keydown-ESC', () => {
      this.setAttackMoveMode(false);
      this.setPatrolMode(false);
    });

    // P-key: enter patrol mode (right-click sets the patrol endpoint)
    scene.input.keyboard!.on('keydown-P', () => {
      if (unitManager.getSelectedCount() === 0) return;
      this.setAttackMoveMode(false);
      this.setPatrolMode(!this.patrolMode);
    });

    // Command card patrol button
    scene.events.on('input:startPatrol', () => {
      if (unitManager.getSelectedCount() === 0) return;
      this.setPatrolMode(true);
    });

    // B-key: activate stealth on selected Phantom units
    scene.input.keyboard!.on('keydown-B', () => {
      scene.events.emit('input:activateStealth');
    });

    // C-key: activate unit ability (Overcharge / Shield Wall)
    scene.input.keyboard!.on('keydown-C', () => {
      scene.events.emit('input:activateAbility');
    });

    // E-key: activate second ability (Divine Pulse for Devotees, Shadow Step for Phantoms)
    scene.input.keyboard!.on('keydown-E', () => {
      scene.events.emit('input:activateEAbility');
    });

    // T-key: toggle Siege Mode (Bulwark) OR Overcharge Turret (Architects)
    scene.input.keyboard!.on('keydown-T', () => {
      scene.events.emit('input:toggleSiegeMode');
      scene.events.emit('input:overchargeTurret');
    });

    // D-key: Deploy Drone (Architects)
    scene.input.keyboard!.on('keydown-D', () => {
      scene.events.emit('input:deployDrone');
    });

    // Z-key: Aegis Shield (Covenant)
    scene.input.keyboard!.on('keydown-Z', () => {
      if (unitManager.getSelectedCount() > 0) scene.events.emit('input:aegisShield');
    });

    // X-key: EMP Pulse (Architects)
    scene.input.keyboard!.on('keydown-X', () => {
      if (unitManager.getSelectedCount() > 0) scene.events.emit('input:empPulse');
    });

    // U-key: toggle Global Upgrade Panel
    scene.input.keyboard!.on('keydown-U', () => {
      scene.events.emit('input:toggleUpgradePanel');
    });

    // W-key: War Cry (Bulwark) — fires once on keydown; WASD panning uses isDown polling so no conflict
    scene.input.keyboard!.on('keydown-W', () => {
      if (unitManager.getSelectedCount() > 0) scene.events.emit('input:warCry');
    });

    // S-key: Sanctuary Zone (Covenant) — fires once on keydown; WASD panning uses isDown polling so no conflict
    scene.input.keyboard!.on('keydown-S', () => {
      if (unitManager.getSelectedCount() > 0) scene.events.emit('input:sanctuaryZone');
    });

    // R-key: Holy Nova (Covenant Devotees) + Retreat (all other selected units)
    scene.input.keyboard!.on('keydown-R', () => {
      scene.events.emit('input:activateHolyNova');
      if (unitManager.getSelectedCount() > 0) {
        scene.events.emit('input:retreat');
      }
    });

    // F-key: context-sensitive — Fortify (Bulwark), follow cam, or idle worker
    scene.input.keyboard!.on('keydown-F', () => {
      scene.events.emit('input:fKey');
    });

    // TAB: show score/stats overlay while held
    scene.input.keyboard!.on('keydown-TAB', (event: KeyboardEvent) => {
      event.preventDefault(); // stop browser from focusing next element
      scene.events.emit('input:tabDown');
    });
    scene.input.keyboard!.on('keyup-TAB', () => {
      scene.events.emit('input:tabUp');
    });

    // ── Unit stances ─────────────────────────────────────────────────────────
    // H = Hold Position — unit never moves, attacks anything entering weapon range
    scene.input.keyboard!.on('keydown-H', () => {
      if (unitManager.getSelectedCount() > 0) scene.events.emit('input:setStance', 'hold');
    });

    // V = Holy Nova (Covenant units) or Defensive stance (all others)
    scene.input.keyboard!.on('keydown-V', () => {
      if (unitManager.getSelectedCount() > 0) {
        if (unitManager.hasSelectedCovenantUnits()) {
          scene.events.emit('input:holyNovaV');
        } else {
          scene.events.emit('input:setStance', 'defensive');
        }
      }
    });

    // G = Aggressive stance OR Sacred Ground for Covenant units
    scene.input.keyboard!.on('keydown-G', () => {
      if (unitManager.getSelectedCount() > 0) {
        // Check if any selected unit is a Covenant player unit that can use Sacred Ground
        const covenantUnit = Array.from(unitManager.selectedUnits).find(
          u => u.isAlive() && u.faction === 'player' && u.canActivateSacredGround()
        );
        if (covenantUnit) {
          scene.events.emit('input:sacredGround');
        } else {
          scene.events.emit('input:setStance', 'aggressive');
        }
      }
    });

    // Control groups: Ctrl+1-9 to assign, 1-9 to recall, double-tap to center
    const GROUP_KEY_NAMES = ['ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE'];
    GROUP_KEY_NAMES.forEach((keyName, idx) => {
      const n = idx + 1;
      scene.input.keyboard!.on(`keydown-${keyName}`, () => {
        if (this.ctrlKey.isDown) {
          // Assign selection to this group
          unitManager.assignControlGroup(n);
          scene.events.emit('controlGroup:assigned', n);
        } else {
          // Recall group; double-tap within 300 ms centers the camera
          const now = scene.time.now;
          const last = this.lastGroupKeyTime.get(n) ?? 0;
          const doubleTap = (now - last) < 300;
          this.lastGroupKeyTime.set(n, now);

          const units = unitManager.recallControlGroup(n);
          if (units.length > 0) {
            scene.events.emit('controlGroup:recalled', n);
            if (doubleTap) {
              const avgX = units.reduce((s, u) => s + u.getPosition().x, 0) / units.length;
              const avgY = units.reduce((s, u) => s + u.getPosition().y, 0) / units.length;
              scene.cameras.main.pan(avgX, avgY, 300, 'Power2');
            }
          }
        }
      });
    });

    // ── Camera bookmarks (F1-F4) ──────────────────────────────────────────────
    // F1: toggle hotkey help overlay
    scene.input.keyboard!.on('keydown-F1', () => {
      scene.events.emit('input:toggleHelp');
    });

    // F2-F4: Alt+Fn saves current view, Fn recalls
    // F2: Assassinate (Unseen) when Unseen units selected — else camera bookmark
    // F3: Divine Wrath (Covenant) when Covenant units selected — else camera bookmark
    [2, 3, 4].forEach(n => {
      scene.input.keyboard!.on(`keydown-F${n}`, () => {
        if (this.altKey.isDown) {
          // Save the camera's current world-centre
          const cam = scene.cameras.main;
          const cx = cam.scrollX + (cam.width  / 2) / cam.zoom;
          const cy = cam.scrollY + (cam.height / 2) / cam.zoom;
          this.cameraBookmarks.set(n, { x: cx, y: cy });
          scene.events.emit('camera:bookmarkFlash', `F${n} saved`);
          scene.events.emit('camera:bookmarkSet', n, cx, cy);
          return;
        }
        if (n === 2) {
          const hasUnseen = unitManager.getAllUnits().some(
            u => u.isSelected && u.isAlive() && u.faction === 'player' && (u as any).isUnseenUnit
          );
          if (hasUnseen) { scene.events.emit('input:assassinate'); return; }
        }
        if (n === 3) {
          const hasCovenant = unitManager.getAllUnits().some(
            u => u.isSelected && u.isAlive() && u.faction === 'player' && (u as any).isCovenantUnit
          );
          if (hasCovenant) { scene.events.emit('input:divineWrath'); return; }
        }
        const bm = this.cameraBookmarks.get(n);
        if (bm) {
          scene.cameras.main.pan(bm.x, bm.y, 350, 'Power2');
          scene.events.emit('camera:bookmarkFlash', `\u2192 F${n}`);
        } else {
          scene.events.emit('camera:bookmarkFlash', `F${n} not set  (Alt+F${n} to save)`);
        }
      });
    });

    // N-key: Iron Bastion (Bulwark) — place temporary wall
    scene.input.keyboard!.on('keydown-N', () => {
      if (unitManager.getSelectedCount() > 0) scene.events.emit('input:ironBastion');
    });

    this.setupPointerInput();
  }

  private setAttackMoveMode(active: boolean): void {
    this.attackMoveMode = active;
    this.attackModeCursor?.destroy();
    this.attackModeCursor = null;
    if (active) {
      const { width, height } = this.scene.scale;
      this.attackModeCursor = this.scene.add.text(width / 2, height - 38, '\u2694 Attack-Move: right-click target  (ESC to cancel)', {
        fontSize: '13px', color: '#ff8844', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(9999);
    }
  }

  private setPatrolMode(active: boolean): void {
    this.patrolMode = active;
    this.patrolCursorText?.destroy();
    this.patrolCursorText = null;
    this.patrolLineGfx?.destroy();
    this.patrolLineGfx = null;
    if (active) {
      const { width, height } = this.scene.scale;
      this.patrolCursorText = this.scene.add.text(width / 2, height - 38, '⟳ Patrol: right-click patrol endpoint  (ESC to cancel)', {
        fontSize: '13px', color: '#44ffcc', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(9999);
      this.patrolLineGfx = this.scene.add.graphics().setDepth(9998);
    }
  }

  isShiftDown(): boolean { return this.shiftKey.isDown; }

  private setupPointerInput(): void {
    this.scene.game.canvas.addEventListener('contextmenu', e => e.preventDefault());

    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) this.selectionBox.begin(pointer.x, pointer.y);
    });

    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) this.selectionBox.update(pointer.x, pointer.y);
      // Patrol mode: draw dashed line from selected units' average position to cursor
      if (this.patrolMode && this.patrolLineGfx) {
        const units = Array.from(this.unitManager.selectedUnits).filter(u => u.isAlive());
        if (units.length > 0) {
          const avgX = units.reduce((s, u) => s + u.getPosition().x, 0) / units.length;
          const avgY = units.reduce((s, u) => s + u.getPosition().y, 0) / units.length;
          const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
          this.patrolLineGfx.clear();
          this.patrolLineGfx.lineStyle(2, 0x44ffcc, 0.7);
          // Dashed line: draw segments
          const dx = world.x - avgX;
          const dy = world.y - avgY;
          const len = Math.sqrt(dx * dx + dy * dy);
          const dashLen = 12;
          const gapLen  = 8;
          const totalUnit = dashLen + gapLen;
          const segments = Math.floor(len / totalUnit);
          for (let s = 0; s < segments; s++) {
            const t0 = (s * totalUnit) / len;
            const t1 = (s * totalUnit + dashLen) / len;
            this.patrolLineGfx.strokeLineShape(new Phaser.Geom.Line(
              avgX + dx * t0, avgY + dy * t0,
              avgX + dx * t1, avgY + dy * t1,
            ));
          }
        }
      } else if (!this.patrolMode && this.patrolLineGfx) {
        this.patrolLineGfx.clear();
      }
    });

    this.scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonReleased())       this.handleLeftRelease(pointer);
      else if (pointer.rightButtonReleased()) this.handleRightClick(pointer);
    });
  }

  private handleLeftRelease(pointer: Phaser.Input.Pointer): void {
    // Cancel attack-move mode on any left click
    if (this.attackMoveMode) this.setAttackMoveMode(false);

    const rect = this.selectionBox.end();
    if (rect) {
      const cam = this.scene.cameras.main;
      const topLeft     = cam.getWorldPoint(rect.x, rect.y);
      const bottomRight = cam.getWorldPoint(rect.x + rect.w, rect.y + rect.h);
      this.unitManager.selectUnitsInRect(new Phaser.Geom.Rectangle(
        topLeft.x, topLeft.y,
        bottomRight.x - topLeft.x,
        bottomRight.y - topLeft.y
      ));
      if (this.unitManager.getSelectedCount() > 0) {
        this.scene.events.emit('input:unitsSelected');
      }
    }
  }

  private handleRightClick(pointer: Phaser.Input.Pointer): void {
    // Right-click on an enemy unit was already handled via unit:rightClicked
    if (this.attackTargetConsumed) {
      this.attackTargetConsumed = false;
      return;
    }

    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);

    // Patrol mode: right-click sets the patrol endpoint
    if (this.patrolMode) {
      const tileX = Math.floor(world.x / TILE_SIZE);
      const tileY = Math.floor(world.y / TILE_SIZE);
      this.unitManager.startPatrolForSelected(tileX, tileY);
      this.setPatrolMode(false);
      return;
    }

    // Let GameScene intercept first (for rally points, targeting modes, etc.)
    if (this.onRightClick?.(world.x, world.y)) {
      if (this.attackMoveMode) this.setAttackMoveMode(false);
      return;
    }

    if (this.unitManager.getSelectedCount() === 0) {
      this.setAttackMoveMode(false);
      return;
    }

    const tileX = Math.floor(world.x / TILE_SIZE);
    const tileY = Math.floor(world.y / TILE_SIZE);

    if (this.attackMoveMode) {
      this.setAttackMoveMode(false);
      this.unitManager.attackMoveSelectedUnits(tileX, tileY);
      this.scene.events.emit('replay:playerAttackMove', { tileX, tileY });
    } else if (this.shiftKey.isDown) {
      // Shift+right-click: append waypoint to each selected unit's order queue
      this.unitManager.queueMoveSelectedUnits(tileX, tileY);
      this.scene.events.emit('replay:playerMove', { tileX, tileY });
    } else {
      this.unitManager.moveSelectedUnits(tileX, tileY);
      this.scene.events.emit('replay:playerMove', { tileX, tileY });
      // Draw fading lines from selected units to the move target
      const worldTarget = { worldX: tileX * TILE_SIZE + TILE_SIZE / 2, worldY: tileY * TILE_SIZE + TILE_SIZE / 2 };
      this.scene.events.emit('input:moveOrder', worldTarget);
    }
  }

  update(delta: number): void {
    this.handleKeyboardPan(delta);
    this.handleEdgeScroll(delta);
    this.pathfinder.calculate();
  }

  private handleKeyboardPan(delta: number): void {
    if (this.attackMoveMode) return; // A key is consumed; don't pan
    const cam = this.scene.cameras.main;
    const speed = CAMERA_PAN_SPEED * (delta / 1000);
    if (this.cursors.left.isDown  || this.wasd.left.isDown)  cam.scrollX -= speed;
    if (this.cursors.right.isDown || this.wasd.right.isDown) cam.scrollX += speed;
    if (this.cursors.up.isDown    || this.wasd.up.isDown)    cam.scrollY -= speed;
    if (this.cursors.down.isDown  || this.wasd.down.isDown)  cam.scrollY += speed;
  }

  private handleEdgeScroll(delta: number): void {
    const pointer = this.scene.input.activePointer;
    if (!pointer.active) return;
    const cam       = this.scene.cameras.main;
    const baseSpeed = CAMERA_PAN_SPEED * (delta / 1000);
    const W = this.scene.scale.width;
    const H = this.scene.scale.height;
    const m = EDGE_SCROLL_MARGIN;

    // Speed scales with proximity: 1× at margin boundary → 3× at screen edge
    if (pointer.x < m) {
      const f = (m - pointer.x) / m;           // 0 at boundary, 1 at edge
      cam.scrollX -= baseSpeed * (1 + f * 2);
    }
    if (pointer.x > W - m) {
      const f = (pointer.x - (W - m)) / m;
      cam.scrollX += baseSpeed * (1 + f * 2);
    }
    if (pointer.y < m) {
      const f = (m - pointer.y) / m;
      cam.scrollY -= baseSpeed * (1 + f * 2);
    }
    if (pointer.y > H - m) {
      const f = (pointer.y - (H - m)) / m;
      cam.scrollY += baseSpeed * (1 + f * 2);
    }
  }
}
