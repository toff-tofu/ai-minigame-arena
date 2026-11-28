import type { Replay } from "../game/replays.ts";
import { games, isGameId, type GameId, type Position } from "../game/catalog.ts";
import { searchGame } from "../ai/game-policy.ts";
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { searchMoves, type Move } from "../ai/baselines.ts";
import { isWeights, type Weights } from "../ai/coaching.ts";
import { playTurn, startDuel, type Duel } from "../game/duel.ts";
import { HEIGHT, landingRow, orientation, type Piece } from "../game/stacking.ts";

type PlayedMove = Move & { player: 0 | 1 };
type Pose = PlayedMove & { piece: Piece; row: number; dropping: boolean };
type Room = {
  seed: number;
  owners: [string?, string?];
  saveReplay?: SaveReplay;
  catalog?: { id: GameId; position: Position; moves: number[]; candidate?: number };
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

async function readEntry(request: IncomingMessage): Promise<{ weights: Weights; game?: GameId } | undefined> {
  let body = "";
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    body += chunk.toString();
    if (body.length > 256) return;
  }
  try {
    const value: unknown = JSON.parse(body);
    if (isWeights(value)) return { weights: value };
    if (value && typeof value === "object" && "weights" in value && isWeights(value.weights) &&
        "game" in value && isGameId(value.game)) return { weights: value.weights, game: value.game };
  } catch {
    return;
  }
}

function snapshot(room: Room) {
  if (room.catalog) {
    const { id, moves, candidate, position } = room.catalog;
    return { seed: room.seed, game: id, catalogMoves: moves, candidate,
      phase: !room.models[1] ? "waiting" : position.outcome === "playing" ? "playing" : "finished" };
  }
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

type SaveReplay = (owner: string, replay: Replay, outcome: "draw" | 0 | 1) => Promise<void>;

function saveCompletedRoom(room: Room, outcome: "draw" | 0 | 1) {
  if (!room.saveReplay) return;
  for (const seat of [0, 1] as const) {
    const owner = room.owners[seat];
    if (!owner) continue;
    const common = { id: randomUUID(), seed: room.seed, seat, mode: "online" as const };
    const replay: Replay = room.catalog
      ? { ...common, game: room.catalog.id, moves: [...room.catalog.moves] }
      : { ...common, game: "stacking", moves: [...room.moves] };
    void room.saveReplay(owner, replay, outcome).catch(() => console.error("Could not save finished battle"));
  }
}

function runTurn(room: Room, delay: number) {
  const player = room.duel.active;
  const { board, turns } = room.duel.players[player];
  const piece = room.duel.pieces[turns];
  const search = searchMoves(board, piece, room.models[player]!, room.seed, room.moves.length);
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
      else saveCompletedRoom(room, room.duel.outcome);
    }
    schedule(descend, 4);
  }
  examine();
}

function runCatalogTurn(room: Room, delay: number) {
  const catalog = room.catalog!;
  const { position, id } = catalog;
  const search = searchGame(id, position, room.models[position.active]!, room.seed, catalog.moves.length);
  function examine() {
    const next = search.next();
    if (!next.done) {
      catalog.candidate = next.value;
      broadcast(room);
      room.timer = setTimeout(examine, delay * 2);
      return;
    }
    catalog.position = games[id].apply(position, next.value);
    catalog.moves.push(next.value);
    catalog.candidate = undefined;
    broadcast(room);
    if (catalog.position.outcome === "playing") {
      room.timer = setTimeout(() => runCatalogTurn(room, delay), delay * 14);
    } else {
      saveCompletedRoom(room, catalog.position.outcome);
    }
  }
  examine();
}

export function createRooms(delay = 38, saveReplay?: SaveReplay) {
  const rooms = new Map<string, Room>();
  let closed = false;
  const waiting = new Map<ServerResponse, { weights: Weights; game?: GameId; owner?: string }>();
  function createRoom(weights: Weights, game?: GameId, owner?: string) {
    let code: string;
    do { code = randomBytes(6).toString("hex").toUpperCase(); } while (rooms.has(code));
    const seed = randomBytes(4).readUInt32LE();
    const room: Room = { seed, owners: [owner], saveReplay, models: [weights], duel: startDuel(seed), moves: [], viewers: new Set() };
    if (game) room.catalog = { id: game, position: games[game].start(seed), moves: [] };
    rooms.set(code, room);
    room.expiry = setTimeout(() => {
      rooms.delete(code);
      clearTimeout(room.timer);
      for (const viewer of room.viewers) viewer.end();
    }, 30 * 60 * 1000);
    room.expiry.unref();
    return { code, room };
  }
  function start(room: Room, weights: Weights, owner?: string) {
    room.models[1] = weights;
    room.owners[1] = owner;
    room.timer = setTimeout(() => room.catalog ? runCatalogTurn(room, delay) : runTurn(room, delay), delay * 10);
    broadcast(room);
  }
  async function matchmake(request: IncomingMessage, response: ServerResponse, owner?: string) {
    const entry = await readEntry(request);
    if (!entry) return send(response, 400, { error: "Invalid bot model." });
    if (response.destroyed) return;
    if (closed || rooms.size >= 100) return send(response, 503, { error: "Arena is busy. Try again shortly." });

    for (const [partner, queued] of waiting) {
      if (queued.game !== entry.game) continue;
      waiting.delete(partner);
      if (partner.destroyed) continue;
      const { code, room } = createRoom(queued.weights, queued.game, queued.owner);
      send(partner, 200, { code, seed: room.seed, seat: 0, game: room.catalog?.id });
      send(response, 200, { code, seed: room.seed, seat: 1, game: room.catalog?.id });
      start(room, entry.weights, owner);
      return;
    }
    if (waiting.size >= 100) return send(response, 503, { error: "Queue is full." });
    waiting.set(response, { ...entry, owner });
    const expires = setTimeout(() => {
      waiting.delete(response);
      send(response, 408, { error: "Nobody joined yet. Try again or invite a friend." });
    }, 25_000);
    response.once("close", () => {
      clearTimeout(expires);
      waiting.delete(response);
    });
  }
  return {
    close() {
      closed = true;
      for (const response of waiting.keys()) send(response, 503, { error: "Server is closing." });
      waiting.clear();
      for (const room of rooms.values()) {
        clearTimeout(room.timer);
        clearTimeout(room.expiry);
        for (const viewer of room.viewers) viewer.end();
      }
      rooms.clear();
    },
    async handle(request: IncomingMessage, response: ServerResponse, path: string, owner?: string) {
      if (closed) return send(response, 503, { error: "Server is closing." });
      if (request.method === "POST" && path === "/api/matchmaking") return matchmake(request, response, owner);
      if (request.method === "POST" && path === "/api/battles") {
        const entry = await readEntry(request);
        if (!entry) return send(response, 400, { error: "Invalid bot model." });
        if (closed) return send(response, 503, { error: "Server is closing." });
        if (rooms.size >= 100) return send(response, 503, { error: "Too many rooms. Try again later." });
        const { code, room } = createRoom(entry.weights, entry.game, owner);
        return send(response, 201, { code, seed: room.seed, seat: 0, game: room.catalog?.id });
      }
      const route = /^\/api\/battles\/([A-F0-9]{12})\/(join|events)$/.exec(path);
      const room = route && rooms.get(route[1]);
      if (!room) return send(response, 404, { error: "Battle room not found or expired." });
      if (route[2] === "join" && request.method === "POST") {
        const entry = await readEntry(request);
        if (!entry) return send(response, 400, { error: "Invalid bot model." });
        if (rooms.get(route[1]) !== room) return send(response, 404, { error: "Battle room expired." });
        if (room.models[1]) return send(response, 409, { error: "This battle already has two bots." });
        send(response, 200, { code: route[1], seed: room.seed, seat: 1, game: room.catalog?.id });
        start(room, entry.weights, owner);
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
