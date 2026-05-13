import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { Server, matchMaker, ClientState } from '@colyseus/core';
import { WebSocketTransport, WebSocketClient } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';

// ── Fix: Protocol.js reuses a shared packr.buffer for every encoded message,
// returning subarray *views* rather than copies.  When a second message is
// encoded in the same synchronous tick the first view is silently overwritten.
// For JOINING clients those views are stored in _enqueuedMessages and get
// flushed later — by which point they contain garbage.  Store copies instead.
(WebSocketClient.prototype as any).enqueueRaw = function (
  data: Buffer | Uint8Array,
  options?: Record<string, unknown>,
) {
  if (options?.afterNextPatch) {
    (this._afterNextPatchQueue as unknown[]).push([this, [data]]);
    return;
  }
  if (this.state === ClientState.JOINING) {
    (this._enqueuedMessages as Buffer[]).push(Buffer.from(data)); // copy, not view
    return;
  }
  this.raw(data, options);
};

const app = express();
const port = Number(process.env.PORT) || 2567;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('game_room', GameRoom);

// ── REST: resolve room code → internal room ID ────────────────────────────────
app.get('/room-by-code/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  matchMaker.query({ name: 'game_room' })
    .then((list) => {
      const found = list.find((r: { metadata?: { roomCode?: string }; roomId: string }) =>
        r.metadata?.roomCode === code
      );
      if (!found) {
        res.status(404).json({ error: `Room "${code}" not found` });
      } else {
        res.json({ roomId: (found as { roomId: string }).roomId });
      }
    })
    .catch((err: Error) => {
      res.status(500).json({ error: err.message });
    });
});

gameServer.listen(port).then(() => {
  console.log(`[Colyseus] Server listening on port ${port}`);
  console.log(`[Colyseus] process.env.PORT = ${process.env.PORT}`);
}).catch((err: Error) => {
  console.error('[Colyseus] Failed to start:', err);
  process.exit(1);
});
