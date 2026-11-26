import { chooseMove, type Move, type Strategy } from "../ai/baselines.ts";
import { playTurn, startDuel } from "../game/duel.ts";

export function runBotMatch(seed: number, strategies: readonly [Strategy, Strategy]) {
  let duel = startDuel(seed);
  const moves: (Move & { player: 0 | 1 })[] = [];
  while (duel.outcome === "playing") {
    const player = duel.active;
    const { board, turns } = duel.players[player];
    const move = chooseMove(board, duel.pieces[turns], strategies[player]);
    const result = playTurn(duel, move.column, move.turns);
    if (result.error) throw new Error(result.error);
    moves.push({ player, ...move });
    duel = result.duel;
  }
  return { seed, strategies, moves, duel };
}
