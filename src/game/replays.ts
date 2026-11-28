import { games, isGameId, type GameId, type Outcome, type Seat } from "./catalog.ts";
import { playTurn, startDuel } from "./duel.ts";
import { TURNS } from "./stacking.ts";
import type { Move } from "../ai/baselines.ts";

export type Replay = {
  id: string;
  seed: number;
  seat: Seat;
  mode: "practice" | "training" | "online";
} & ({ game: "stacking"; moves: (Move & { player: Seat })[] } | { game: GameId; moves: number[] });

export function validateReplay(value: unknown): { replay: Replay; outcome: Exclude<Outcome, "playing"> } | undefined {
  if (!value || typeof value !== "object") return;
  const { id, seed, seat, mode, game, moves } = value as Partial<Replay>;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id) || typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
      (seat !== 0 && seat !== 1) || (mode !== "practice" && mode !== "training" && mode !== "online") ||
      !Array.isArray(moves) || moves.length === 0 || moves.length > 100) return;

  if (game === "stacking") {
    if (moves.length > 2 * TURNS) return;
    let duel = startDuel(seed);
    const accepted: (Move & { player: Seat })[] = [];
    for (const move of moves) {
      if (!move || typeof move !== "object" || move.player !== duel.active) return;
      const { column, turns, player } = move;
      const result = playTurn(duel, column, turns);
      if (result.error) return;
      duel = result.duel;
      accepted.push({ column, turns, player });
    }
    if (duel.outcome === "playing") return;
    return { replay: { id, seed, seat, mode, game, moves: accepted }, outcome: duel.outcome };
  }
  if (!isGameId(game)) return;
  const rules = games[game];
  let position = rules.start(seed);
  const accepted: number[] = [];
  for (const move of moves) {
    if (typeof move !== "number" || !rules.legal(position).includes(move)) return;
    position = rules.apply(position, move);
    accepted.push(move);
  }
  if (position.outcome === "playing") return;
  return { replay: { id, seed, seat, mode, game, moves: accepted }, outcome: position.outcome };
}
