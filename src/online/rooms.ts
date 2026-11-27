import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { searchMoves, type Move } from "../ai/baselines.ts";
import type { Weights } from "../ai/coaching.ts";
import { playTurn, startDuel, type Duel } from "../game/duel.ts";
import { HEIGHT, landingRow, orientation, type Piece } from "../game/stacking.ts";

type PlayedMove = Move & { player: 0 | 1 };
type Pose = PlayedMove & { piece: Piece; row: number; dropping: boolean };
type Room = {
  seed: number;
  models: [Weights, Weights?];
  duel: Duel;
  moves: PlayedMove[];
  pose?: Pose;
  viewers: Set<ServerResponse>;
  timer?: ReturnType<typeof setTimeout>;
  expiry?: ReturnType<typeof setTimeout>;
};

function send(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

async function readWeights(request: IncomingMessage): Promise<Weights | undefined> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 256) return;
  }
  try {
    const value: unknown = JSON.parse(body);
    if (Array.isArray(value) && value.length === 2 &&
        value.every((weight) => typeof weight === "number" && Number.isFinite(weight) && Math.abs(weight) <= 16)) {
      return [value[0], value[1]];
    }
  } catch {
    return;
  }
}

function snapshot(room: Room) {
  return { seed: room.seed, moves: room.moves, pose: room.pose,
    phase: !room.models[1] ? "waiting" : room.duel.outcome === "playing" ? "playing" : "finished" };
}

function emit(room: Room, viewer: ServerResponse) {
  if (viewer.writableLength > 16_384) {
    viewer.destroy();
    return;
  }
  viewer.write(`data: ${JSON.stringify(snapshot(room))}\n\n`);
}

function broadcast(room: Room) {
  for (const viewer of room.viewers) emit(room, viewer);
}

function runTurn(room: Room, delay: number) {
  const player = room.duel.active;
  const { board, turns } = room.duel.players[player];
  const piece = room.duel.pieces[turns];
  const search = searchMoves(board, piece, room.models[player]!);
  function schedule(action: () => void, ticks = 1) {
    room.timer = setTimeout(action, delay * ticks);
  }
  function examine() {
    const candidate = search.next();
    const move = candidate.value;
    room.pose = { player, piece, ...move, row: HEIGHT + 1, dropping: candidate.done };
    broadcast(room);
    if (!candidate.done) {
      schedule(examine);
      return;
    }
    const landing = landingRow(board, orientation(piece, move.turns), move.column);
    function descend() {
      if (room.pose!.row > landing) {
        room.pose!.row--;
        broadcast(room);
        schedule(descend);
        return;
      }
      room.duel = playTurn(room.duel, move.column, move.turns).duel;
      room.moves.push({ player, ...move });
      room.pose = undefined;
      broadcast(room);
      if (room.duel.outcome === "playing") schedule(() => runTurn(room, delay), 10);
    }
    schedule(descend, 4);
  }
  examine();
}

export function createRooms(delay = 38) {
  const rooms = new Map<string, Room>();
  let closed = false;
  return {
    close() {
      closed = true;
      for (const room of rooms.values()) {
        clearTimeout(room.timer);
        clearTimeout(room.expiry);
        for (const viewer of room.viewers) viewer.end();
      }
      rooms.clear();
    },
    async handle(request: IncomingMessage, response: ServerResponse, path: string) {
      if (closed) return send(response, 503, { error: "Server is closing." });
      if (request.method === "POST" && path === "/api/battles") {
        const weights = await readWeights(request);
        if (!weights) return send(response, 400, { error: "Invalid bot model." });
        if (closed) return send(response, 503, { error: "Server is closing." });
        if (rooms.size >= 100) return send(response, 503, { error: "Too many rooms. Try again later." });
        let code: string;
        do { code = randomBytes(6).toString("hex").toUpperCase(); } while (rooms.has(code));
        const seed = randomBytes(4).readUInt32LE();
        const room: Room = { seed, models: [weights], duel: startDuel(seed), moves: [], viewers: new Set() };
        rooms.set(code, room);
        room.expiry = setTimeout(() => {
          rooms.delete(code);
          clearTimeout(room.timer);
          for (const viewer of room.viewers) viewer.end();
        }, 30 * 60 * 1000);
        room.expiry.unref();
        return send(response, 201, { code, seed, seat: 0 });
      }
      const route = /^\/api\/battles\/([A-F0-9]{12})\/(join|events)$/.exec(path);
      const room = route && rooms.get(route[1]);
      if (!room) return send(response, 404, { error: "Battle room not found or expired." });
      if (route[2] === "join" && request.method === "POST") {
        const weights = await readWeights(request);
        if (!weights) return send(response, 400, { error: "Invalid bot model." });
        if (rooms.get(route[1]) !== room) return send(response, 404, { error: "Battle room expired." });
        if (room.models[1]) return send(response, 409, { error: "This battle already has two bots." });
        room.models[1] = weights;
        send(response, 200, { code: route[1], seed: room.seed, seat: 1 });
        room.timer = setTimeout(() => runTurn(room, delay), delay * 10);
        broadcast(room);
        return;
      }
      if (route[2] === "events" && request.method === "GET") {
        if (room.viewers.size >= 8) return send(response, 503, { error: "Too many viewers." });
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no" });
        room.viewers.add(response);
        const heartbeat = setInterval(() => {
          if (response.writableLength > 16_384) response.destroy();
          else response.write(": heartbeat\n\n");
        }, 15_000);
        response.on("close", () => {
          clearInterval(heartbeat);
          room.viewers.delete(response);
        });
        emit(room, response);
        return;
      }
      send(response, 405, { error: "Method not allowed." });
    },
  };
}
