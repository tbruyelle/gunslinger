import { Server } from "colyseus";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { GameRoom } from "./rooms/GameRoom";

const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(cors());
app.use(express.json());

app.get("/healthz", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);

const gameServer = new Server({ server: httpServer });
gameServer.define("game", GameRoom, { maxClients: 6 });

httpServer.listen(PORT, () => {
  console.log(`Gunslinger server listening on :${PORT}`);
});
