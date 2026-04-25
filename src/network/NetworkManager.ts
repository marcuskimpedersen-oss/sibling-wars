/**
 * NetworkManager — singleton wrapping the Colyseus client.
 *
 * Usage:
 *   const net = NetworkManager.instance;
 *   await net.createRoom({ race, difficulty, winCondition, playerName });
 *   await net.joinRoom('ABC1', { race, playerName });
 *   net.sendCommand({ type: 'move', unitIds: [...], tx, ty });
 *   net.on('command', handler);
 *   net.disconnect();
 */

import * as Colyseus from 'colyseus.js';

// ── Shared types ─────────────────────────────────────────────────────────────

export interface NetworkPlayer {
  sessionId:   string;
  race:        string;
  name:        string;
  isReady:     boolean;
  isHost:      boolean;
  playerIndex: number;
}

export interface GameStartPayload {
  difficulty:   string;
  winCondition: string;
  players:      NetworkPlayer[];
}

export interface CommandPayload {
  type:     string;
  senderId: string;
  [key: string]:  unknown;
}

export interface LobbyUpdatePayload {
  players: NetworkPlayer[];
  hostId:  string;
}

export type NetworkEventMap = {
  'joined':        { sessionId: string; roomCode: string; isHost: boolean; playerIndex: number };
  'lobby:update':  LobbyUpdatePayload;
  'game:start':    GameStartPayload;
  'game:over':     { winnerId?: string };
  'player:left':   { sessionId: string };
  'command':       CommandPayload;
  'chat':          { from: string; text: string };
  'connect':       undefined;
  'disconnect':    undefined;
  'error':         string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (data: any) => void;

// ── NetworkManager ────────────────────────────────────────────────────────────

export class NetworkManager {
  private static _instance: NetworkManager | null = null;
  static get instance(): NetworkManager {
    if (!NetworkManager._instance) NetworkManager._instance = new NetworkManager();
    return NetworkManager._instance;
  }

  readonly serverUrl: string = window.location.origin.replace(/^http/, 'ws') + '/colyseus';

  private client: Colyseus.Client;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private room: Colyseus.Room<any> | null = null;

  // Local identity (populated once we receive 'joined' from server)
  sessionId:   string  = '';
  roomCode:    string  = '';
  isHost:      boolean = false;
  playerIndex: number  = 0;
  playerName:  string  = 'Player';
  isMultiplayer: boolean = false;

  private handlers: Map<string, AnyHandler[]> = new Map();

  private constructor() {
    this.client = new Colyseus.Client(this.serverUrl);
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  async createRoom(opts: { race: string; difficulty: string; winCondition: string; playerName?: string }): Promise<void> {
    this.playerName = opts.playerName ?? 'Player 1';
    this.room = await this.client.create('game_room', {
      difficulty:   opts.difficulty,
      winCondition: opts.winCondition,
      playerName:   this.playerName,
      race:         opts.race,
    });
    this.isMultiplayer = true;
    this.attachRoomListeners();
  }

  async joinRoom(code: string, opts: { race: string; playerName?: string }): Promise<void> {
    this.playerName = opts.playerName ?? 'Player 2';

    // The server exposes a REST endpoint to resolve a room code → internal room ID
    const resp = await fetch(`/colyseus/room-by-code/${code.toUpperCase()}`);
    if (!resp.ok) throw new Error(`Room "${code}" not found`);
    const { roomId } = (await resp.json()) as { roomId: string };

    this.room = await this.client.joinById(roomId, {
      playerName: this.playerName,
      race:       opts.race,
    });
    this.isMultiplayer = true;
    this.attachRoomListeners();
  }

  private attachRoomListeners(): void {
    if (!this.room) return;
    const room = this.room;

    room.onMessage('joined', (data: NetworkEventMap['joined']) => {
      this.sessionId   = data.sessionId;
      this.roomCode    = data.roomCode;
      this.isHost      = data.isHost;
      this.playerIndex = data.playerIndex;
      this.emit('joined', data);
    });

    room.onMessage('lobby:update', (data: LobbyUpdatePayload) => this.emit('lobby:update', data));
    room.onMessage('game:start',   (data: GameStartPayload)   => this.emit('game:start', data));
    room.onMessage('game:over',    (data: { winnerId?: string }) => this.emit('game:over', data));
    room.onMessage('player:left',  (data: { sessionId: string }) => this.emit('player:left', data));
    room.onMessage('chat',         (data: { from: string; text: string }) => this.emit('chat', data));

    room.onMessage('command', (data: CommandPayload) => {
      this.emit('command', { ...data, senderId: data.senderId ?? '' });
    });

    room.onError((code, message) => {
      console.error('[NetworkManager] Room error', code, message);
      this.emit('error', `Room error ${code}: ${message ?? ''}`);
    });

    room.onLeave(() => {
      this.emit('disconnect', undefined);
    });

    this.emit('connect', undefined);
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  sendCommand(data: Omit<CommandPayload, 'senderId'>): void {
    if (!this.room) return;
    this.room.send('command', { ...data, senderId: this.sessionId });
  }

  setReady(): void {
    this.room?.send('player:ready');
  }

  updatePlayerInfo(info: { race?: string; name?: string }): void {
    this.room?.send('player:update', info);
  }

  startGame(): void {
    this.room?.send('start');
  }

  sendGameOver(winnerId?: string): void {
    this.room?.send('game:over', { winnerId });
  }

  sendChat(text: string): void {
    this.room?.send('chat', { text });
  }

  disconnect(): void {
    this.room?.leave();
    this.room        = null;
    this.sessionId   = '';
    this.roomCode    = '';
    this.isHost      = false;
    this.isMultiplayer = false;
  }

  get isConnected(): boolean { return this.room !== null; }

  // ── Event emitter ──────────────────────────────────────────────────────────

  on<K extends keyof NetworkEventMap>(event: K, handler: (data: NetworkEventMap[K]) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(handler as AnyHandler);
  }

  off<K extends keyof NetworkEventMap>(event: K, handler: (data: NetworkEventMap[K]) => void): void {
    const list = this.handlers.get(event);
    if (!list) return;
    const idx = list.indexOf(handler as AnyHandler);
    if (idx !== -1) list.splice(idx, 1);
  }

  offAllEvents(): void {
    this.handlers.clear();
  }

  private emit<K extends keyof NetworkEventMap>(event: K, data: NetworkEventMap[K]): void {
    this.handlers.get(event)?.forEach(h => h(data));
  }
}
