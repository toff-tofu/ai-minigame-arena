import { drop, height, pieceSequence, TURNS, type Board } from "./stacking.ts";

type Player = {
  readonly board: Board;
  readonly turns: number;
  readonly score: number;
  readonly bust: string | null;
};

export type Duel = {
  readonly players: readonly [Player, Player];
  readonly active: 0 | 1;
  readonly pieces: ReturnType<typeof pieceSequence>;
  readonly outcome: "playing" | "draw" | 0 | 1;
};

export function startDuel(seed: number): Duel {
  const player = (): Player => ({ board: new Set(), turns: 0, score: 0, bust: null });
  return { players: [player(), player()], active: 0, pieces: pieceSequence(seed), outcome: "playing" };
}

function finished(player: Player): boolean {
  return player.bust !== null || player.turns === TURNS;
}

export function playTurn(duel: Duel, column: number, turns: number): {
  duel: Duel;
  error?: string;
} {
  if (duel.outcome !== "playing") {
    return { duel, error: "The duel is over." };
  }
  const current = duel.players[duel.active];
  const result = drop(current.board, duel.pieces[current.turns], column, turns);
  if (result.kind === "invalid") {
    return { duel, error: result.reason };
  }

  const players: [Player, Player] = [...duel.players];
  players[duel.active] = result.kind === "bust"
    ? { ...current, turns: current.turns + 1, bust: result.reason }
    : { board: result.board, turns: current.turns + 1, score: Math.max(current.score, height(result.board)), bust: null };
  const [first, second] = players;
  const other = duel.active === 0 ? 1 : 0;
  if (!players.every(finished)) {
    return { duel: { ...duel, players, active: finished(players[other]) ? duel.active : other } };
  }

  let outcome: Duel["outcome"] = "draw";
  if (Boolean(first.bust) !== Boolean(second.bust)) {
    outcome = first.bust ? 1 : 0;
  } else if (first.score !== second.score) {
    outcome = first.score > second.score ? 0 : 1;
  }
  return { duel: { ...duel, players, outcome } };
}
