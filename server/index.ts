import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';

const app = express();
const port = 2567;

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
  console.log(`[Colyseus] Server listening on ws://localhost:${port}`);
});
