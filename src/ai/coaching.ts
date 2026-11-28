import { HEIGHT, drop, height, WIDTH, type Board, type Piece } from "../game/stacking.ts";
import type { Move } from "./baselines.ts";

export type Weights = readonly [height: number, support: number];
export const starter: Weights = [0, 0];

export function isWeights(value: unknown): value is Weights {
  return Array.isArray(value) && value.length === 2 &&
    value.every((weight) => typeof weight === "number" && Number.isFinite(weight) && Math.abs(weight) <= 16);
}

export function exploration(weights: Weights, seed: number, turn: number): number | undefined {
  let state = (seed ^ Math.imul(turn + 1, 0x9e3779b9)) >>> 0;
  const random = () => {
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
    return ((state ^ (state >>> 16)) >>> 0) / 2 ** 32;
  };
  const chance = Math.max(0, 1 - (Math.abs(weights[0]) + Math.abs(weights[1])) / 2);
  return random() < chance ? random() : undefined;
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

export function rankCandidates<T extends { values: Weights; offset?: number }>(moves: readonly T[], weights: Weights) {
  const ranked = moves.map((move) => ({ ...move, score: score(move.values, weights) + (move.offset ?? 0) }))
    .sort((a, b) => b.score - a.score);
  const total = ranked.reduce((sum, move) => sum + Math.exp(move.score - ranked[0].score), 0);
  return ranked.map((move, index) => ({
    ...move, rank: index + 1, preference: Math.exp(move.score - ranked[0].score) / total,
  }));
}

export const rankMoves = (moves: readonly Placement[], weights: Weights) => rankCandidates(moves, weights);

export function preferenceStep<T extends { values: Weights; preference: number }>(
  ranked: readonly T[], target: T, weights: Weights,
): Weights {
  const expected = ([0, 1] as const).map((i) =>
    ranked.reduce((sum, move) => sum + move.preference * move.values[i], 0));
  return [
    Math.max(-16, Math.min(16, weights[0] + 2 * (target.values[0] - expected[0]))),
    Math.max(-16, Math.min(16, weights[1] + 2 * (target.values[1] - expected[1]))),
  ];
}

export function teach(moves: readonly Placement[], example: Move, weights: Weights): Weights {
  const ranked = rankMoves(moves, weights);
  const target = ranked.find((move) => sameMove(move, example));
  if (!target) return weights;
  const candidate = preferenceStep(ranked, target, weights);
  const updated = rankMoves(moves, candidate).find((move) => sameMove(move, example));
  return updated && updated.preference > target.preference + 1e-10 ? candidate : weights;
}
