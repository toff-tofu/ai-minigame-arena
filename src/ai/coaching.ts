import { HEIGHT, drop, height, WIDTH, type Board, type Piece } from "../game/stacking.ts";
import type { Move } from "./baselines.ts";

export type Weights = readonly [height: number, support: number];
export const starter: Weights = [8, 1];

export function isWeights(value: unknown): value is Weights {
  return Array.isArray(value) && value.length === 2 &&
    value.every((weight) => typeof weight === "number" && Number.isFinite(weight) && Math.abs(weight) <= 16);
}

export function features(board: Board, margin: number): Weights {
  return [height(board) / HEIGHT, margin / WIDTH];
}

export function score(values: Weights, weights: Weights): number {
  return values[0] * weights[0] + values[1] * weights[1];
}

export function placements(board: Board, piece: Piece) {
  const moves = [];
  for (let column = 0; column < WIDTH; column++) {
    for (let turns = 0; turns < 4; turns++) {
      const result = drop(board, piece, column, turns);
      if (result.kind === "placed") {
        moves.push({ column, turns, height: height(result.board), margin: result.margin,
          values: features(result.board, result.margin) });
      }
    }
  }
  return moves;
}

type Placement = ReturnType<typeof placements>[number];
export function sameMove(left: Move, right: Move): boolean {
  return left.column === right.column && left.turns === right.turns;
}

export function rankMoves(moves: readonly Placement[], weights: Weights) {
  const ranked = moves.map((move) => ({ ...move, score: score(move.values, weights) }))
    .sort((a, b) => b.score - a.score);
  const total = ranked.reduce((sum, move) => sum + Math.exp(move.score - ranked[0].score), 0);
  return ranked.map((move, index) => ({
    ...move, rank: index + 1, preference: Math.exp(move.score - ranked[0].score) / total,
  }));
}

export function teach(moves: readonly Placement[], example: Move, weights: Weights): Weights {
  const ranked = rankMoves(moves, weights);
  const target = ranked.find((move) => sameMove(move, example));
  if (!target) return weights;
  const expected = ([0, 1] as const).map((i) =>
    ranked.reduce((sum, move) => sum + move.preference * move.values[i], 0));
  const candidate: Weights = [
    Math.max(-16, Math.min(16, weights[0] + 2 * (target.values[0] - expected[0]))),
    Math.max(-16, Math.min(16, weights[1] + 2 * (target.values[1] - expected[1]))),
  ];
  const updated = rankMoves(moves, candidate).find((move) => sameMove(move, example));
  return updated && updated.preference > target.preference + 1e-10 ? candidate : weights;
}
