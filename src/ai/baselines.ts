import { features, score, type Weights } from "./coaching.ts";
import { drop, height, WIDTH, type Board, type Piece } from "../game/stacking.ts";

export const strategies = ["height", "stability"] as const;
export type Strategy = (typeof strategies)[number];
export type Move = { column: number; turns: number };

export function* searchMoves(board: Board, piece: Piece, strategy: Strategy | Weights): Generator<Move, Move> {
  let best: { move: Move; primary: number; secondary: number } | undefined;
  for (let column = 0; column < WIDTH; column++) {
    for (let turns = 0; turns < 4; turns++) {
      const move = { column, turns };
      const result = drop(board, piece, column, turns);
      if (result.kind !== "invalid") yield move;
      if (result.kind !== "placed") continue;
      const top = height(result.board);
      const primary = typeof strategy === "string"
        ? strategy === "height" ? top : result.margin
        : score(features(result.board, result.margin), strategy);
      const secondary = strategy === "height" ? result.margin : strategy === "stability" ? -top : 0;
      if (!best || primary > best.primary || (primary === best.primary && secondary > best.secondary)) {
        best = { move, primary, secondary };
      }
    }
  }

  // Every piece fits at column zero. If no move survives, let the duel record the bust.
  return best?.move ?? { column: 0, turns: 0 };
}

export function chooseMove(board: Board, piece: Piece, strategy: Strategy): Move {
  const search = searchMoves(board, piece, strategy);
  let step = search.next();
  while (!step.done) step = search.next();
  return step.value;
}
