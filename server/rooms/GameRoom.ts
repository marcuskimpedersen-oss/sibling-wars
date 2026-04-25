import { Room, Client } from '@colyseus/core';
import { Schema, MapSchema, type } from '@colyseus/schema';

// ── Schema definitions ────────────────────────────────────────────────────────

export class PlayerState extends Schema {
  @type('string') id: string = '';
  @type('string') race: string = 'architects';
  @type('number') gold: number = 200;
  @type('number') juice: number = 0;
  @type('number') population: number = 0;
  @type('boolean') isReady: boolean = false;
  @type('string') name: string = 'Player';
  @type('number') playerIndex: number = 0;
}

export class GameRoomState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type('string') gameState: string = 'lobby';
  @type('string') roomCode: string = '';
  @type('string') hostId: string = '';
  @type('string') difficulty: string = 'normal';
  @type('string') winCondition: string = 'hq';
}

// ── Room options interface ────────────────────────────────────────────────────

interface GameRoomOptions {
  state: GameRoomState;
  metadata: { roomCode: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// ── Room ──────────────────────────────────────────────────────────────────────

export class GameRoom extends Room<GameRoomOptions> {
  maxClients = 2;

  onCreate(options: Record<string, unknown>): void {
    const state = new GameRoomState();
    const code  = generateRoomCode();
    state.roomCode    = code;
    state.difficulty   = (options.difficulty   as string) ?? 'normal';
    state.winCondition = (options.winCondition as string) ?? 'hq';
    this.setState(state);
    this.setMetadata({ roomCode: code });

    this.onMessage('command', (client, data: unknown) => {
      this.broadcast('command', data, { except: client });
    });

    this.onMessage('player:update', (client, data: { race?: string; name?: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      if (data.race) p.race = data.race;
      if (data.name) p.name = data.name;
      this.broadcastLobbyUpdate();
    });

    this.onMessage('player:ready', (client) => {
      const p = this.state.players.get(client.sessionId);
      if (p) {
        p.isReady = !p.isReady;
        this.broadcastLobbyUpdate();
      }
    });

    this.onMessage('start', (client) => {
      if (client.sessionId !== this.state.hostId) return;
      if (this.state.players.size < 2) return;
      const allReady = [...this.state.players.values()].every(p => p.isReady);
      if (!allReady) return;
      this.state.gameState = 'playing';
      this.broadcast('game:start', {
        difficulty:   this.state.difficulty,
        winCondition: this.state.winCondition,
        players: [...this.state.players.entries()].map(([sid, p]) => ({
          sessionId:   sid,
          race:        p.race,
          name:        p.name,
          isHost:      sid === this.state.hostId,
          playerIndex: p.playerIndex,
        })),
      });
    });

    this.onMessage('game:over', (_client, data: { winnerId?: string }) => {
      this.state.gameState = 'finished';
      this.broadcast('game:over', data);
    });

    this.onMessage('chat', (client, data: { text: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      this.broadcast('chat', { from: p.name, text: String(data.text).substring(0, 200) });
    });
  }

  onJoin(client: Client, options: Record<string, unknown>): void {
    const p = new PlayerState();
    p.id          = client.sessionId;
    p.name        = (options.playerName as string) ?? `Player ${this.state.players.size + 1}`;
    p.race        = (options.race       as string) ?? 'architects';
    p.playerIndex = this.state.players.size;
    this.state.players.set(client.sessionId, p);

    if (this.state.players.size === 1) {
      this.state.hostId = client.sessionId;
    }

    client.send('joined', {
      sessionId:   client.sessionId,
      roomCode:    this.state.roomCode,
      isHost:      client.sessionId === this.state.hostId,
      playerIndex: p.playerIndex,
    });

    this.broadcastLobbyUpdate();
    console.log(`[${this.state.roomCode}] ${p.name} joined (index ${p.playerIndex})`);
  }

  onLeave(client: Client, _code?: number): void {
    this.state.players.delete(client.sessionId);

    if (this.state.hostId === client.sessionId && this.clients.length > 0) {
      this.state.hostId = this.clients[0].sessionId;
    }

    if (this.state.gameState === 'playing') {
      this.broadcast('player:left', { sessionId: client.sessionId });
    }

    this.broadcastLobbyUpdate();
  }

  onDispose(): void {
    console.log(`[GameRoom] ${this.state.roomCode} disposed`);
  }

  private broadcastLobbyUpdate(): void {
    this.broadcast('lobby:update', {
      players: [...this.state.players.entries()].map(([sid, pl]) => ({
        sessionId:   sid,
        race:        pl.race,
        name:        pl.name,
        isReady:     pl.isReady,
        isHost:      sid === this.state.hostId,
        playerIndex: pl.playerIndex,
      })),
      hostId: this.state.hostId,
    });
  }
}
