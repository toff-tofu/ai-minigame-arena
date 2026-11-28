import { preferenceStep, rankCandidates, score, type Weights } from "./coaching.ts";
import { games, type GameId, type Position, type Seat } from "../game/catalog.ts";

type Evaluation = { values: Weights; offset: number };
function evaluate(game: GameId, next: Position, player: Seat): Evaluation {
  const opponent = player === 0 ? 1 : 0;
  if (next.outcome !== "playing") {
    return { values: [0, 0], offset: next.outcome === player ? 100 : next.outcome === opponent ? -100 : 0 };
  }
  const rules = games[game];
  return { values: [rules.potential(next, player), -rules.potential(next, opponent)], offset: 0 };
}

function value(candidate: Evaluation, weights: Weights) {
  return score(candidate.values, weights) + candidate.offset;
}

function evaluateMove(game: GameId, position: Position, move: number, weights: Weights): Evaluation {
  const rules = games[game];
  const next = rules.apply(position, move);
  const replies = rules.legal(next);
  let worst: Evaluation | undefined;
  for (const reply of replies) {
    const result = evaluate(game, rules.apply(next, reply), position.active);
    if (!worst || value(result, weights) < value(worst, weights)) worst = result;
  }
  return worst ?? evaluate(game, next, position.active);
}

export function rankGameMoves(game: GameId, position: Position, weights: Weights) {
  const moves = games[game].legal(position).map((move) => ({ move, ...evaluateMove(game, position, move, weights) }));
  return rankCandidates(moves, weights);
}

export function teachGame(game: GameId, position: Position, move: number, weights: Weights): Weights {
  const before = rankGameMoves(game, position, weights);
  const target = before.find((candidate) => candidate.move === move);
  if (!target) return weights;
  const updated = preferenceStep(before, target, weights);
  const after = rankGameMoves(game, position, updated).find((candidate) => candidate.move === move);
  return after && after.preference > target.preference + 1e-10 ? updated : weights;
}

export function* searchGame(game: GameId, position: Position, weights: Weights): Generator<number, number> {
  let best = -1;
  let bestValue = -Infinity;
  for (const move of games[game].legal(position)) {
    const rating = value(evaluateMove(game, position, move, weights), weights);
    if (rating > bestValue) {
      best = move;
      bestValue = rating;
    }
    yield move;
  }
  return best;
}
