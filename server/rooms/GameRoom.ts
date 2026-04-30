import { Room, Client } from '@colyseus/core';

// ── Plain-JS state (no schema sync needed — everything goes via messages) ─────

interface PlayerData {
  id:          string;
  race:        string;
  isReady:     boolean;
  name:        string;
  playerIndex: number;
}

interface RoomData {
  players:      Map<string, PlayerData>;
  gameState:    string;
  roomCode:     string;
  hostId:       string;
  difficulty:   string;
  winCondition: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// ── Room ──────────────────────────────────────────────────────────────────────

export class GameRoom extends Room {
  maxClients = 2;

  private _state: RoomData = {
    players:      new Map(),
    gameState:    'lobby',
    roomCode:     '',
    hostId:       '',
    difficulty:   'normal',
    winCondition: 'hq',
  };

  onCreate(options: Record<string, unknown>): void {
    const code = generateRoomCode();
    this._state.roomCode     = code;
    this._state.difficulty   = (options.difficulty   as string) ?? 'normal';
    this._state.winCondition = (options.winCondition as string) ?? 'hq';
    this.setMetadata({ roomCode: code });

    this.onMessage('command', (client, data: unknown) => {
      this.broadcast('command', data, { except: client });
    });

    this.onMessage('player:update', (client, data: { race?: string; name?: string }) => {
      const p = this._state.players.get(client.sessionId);
      if (!p) return;
      if (data.race) p.race = data.race;
      if (data.name) p.name = data.name;
      this.broadcastLobbyUpdate();
    });

    this.onMessage('player:ready', (client) => {
      const p = this._state.players.get(client.sessionId);
      if (p) {
        p.isReady = !p.isReady;
        this.broadcastLobbyUpdate();
      }
    });

    this.onMessage('start', (client) => {
      if (client.sessionId !== this._state.hostId) return;
      if (this._state.players.size < 2) return;
      const allReady = [...this._state.players.values()].every(p => p.isReady);
      if (!allReady) return;
      this._state.gameState = 'playing';
      this.broadcast('game:start', {
        difficulty:   this._state.difficulty,
        winCondition: this._state.winCondition,
        players: [...this._state.players.entries()].map(([sid, p]) => ({
          sessionId:   sid,
          race:        p.race,
          name:        p.name,
          isHost:      sid === this._state.hostId,
          playerIndex: p.playerIndex,
        })),
      });
    });

    this.onMessage('game:over', (_client, data: { winnerId?: string }) => {
      this._state.gameState = 'finished';
      this.broadcast('game:over', data);
    });

    this.onMessage('chat', (client, data: { text: string }) => {
      const p = this._state.players.get(client.sessionId);
      if (!p) return;
      this.broadcast('chat', { from: p.name, text: String(data.text).substring(0, 200) });
    });
  }

  onJoin(client: Client, options: Record<string, unknown>): void {
    const p: PlayerData = {
      id:          client.sessionId,
      name:        (options.playerName as string) ?? `Player ${this._state.players.size + 1}`,
      race:        (options.race       as string) ?? 'architects',
      isReady:     false,
      playerIndex: this._state.players.size,
    };
    this._state.players.set(client.sessionId, p);

    if (this._state.players.size === 1) {
      this._state.hostId = client.sessionId;
    }

    // Defer one tick so this arrives after the Colyseus JOIN_ROOM protocol
    // message — the client sets up its onMessage handlers only after that.
    setTimeout(() => {
      client.send('joined', {
        sessionId:   client.sessionId,
        roomCode:    this._state.roomCode,
        isHost:      client.sessionId === this._state.hostId,
        playerIndex: p.playerIndex,
      });
      this.broadcastLobbyUpdate();
    }, 0);

    console.log(`[${this._state.roomCode}] ${p.name} joined (index ${p.playerIndex})`);
  }

  onLeave(client: Client, _consented?: boolean): void {
    this._state.players.delete(client.sessionId);

    if (this._state.hostId === client.sessionId && this.clients.length > 0) {
      this._state.hostId = this.clients[0].sessionId;
    }

    if (this._state.gameState === 'playing') {
      this.broadcast('player:left', { sessionId: client.sessionId });
    }

    this.broadcastLobbyUpdate();
  }

  onDispose(): void {
    console.log(`[GameRoom] ${this._state.roomCode} disposed`);
  }

  private broadcastLobbyUpdate(): void {
    this.broadcast('lobby:update', {
      players: [...this._state.players.entries()].map(([sid, pl]) => ({
        sessionId:   sid,
        race:        pl.race,
        name:        pl.name,
        isReady:     pl.isReady,
        isHost:      sid === this._state.hostId,
        playerIndex: pl.playerIndex,
      })),
      hostId: this._state.hostId,
    });
  }
}
