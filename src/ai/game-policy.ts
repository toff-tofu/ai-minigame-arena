import { score, type Weights } from "./coaching.ts";
import { games, type GameId, type Position, type Seat } from "../game/catalog.ts";

export function* searchGame(game: GameId, position: Position, weights: Weights): Generator<number, number> {
  const rules = games[game];
  const player = position.active;
  const opponent: Seat = player === 0 ? 1 : 0;
  function evaluate(next: Position) {
    if (next.outcome === player) return 100;
    if (next.outcome === opponent) return -100;
    if (next.outcome === "draw") return 0;
    return score([rules.potential(next, player), -rules.potential(next, opponent)], weights);
  }
  let best = -1;
  let bestValue = -Infinity;
  for (const move of rules.legal(position)) {
    const next = rules.apply(position, move);
    const replies = rules.legal(next);
    const value = replies.length
      ? Math.min(...replies.map((reply) => evaluate(rules.apply(next, reply)))) : evaluate(next);
    if (value > bestValue) {
      best = move;
      bestValue = value;
    }
    yield move;
  }
  return best;
}
