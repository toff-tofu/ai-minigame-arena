import assert from "node:assert/strict";
import test from "node:test";
import { searchMoves } from "../src/ai/baselines.ts";
import { placements, rankMoves, sameMove, starter, teach } from "../src/ai/coaching.ts";

test("a demonstration raises the taught drop's preference and the live bot uses the updated ranking", () => {
  const board = new Set<number>();
  const moves = placements(board, "Pair");
  const example = { column: 0, turns: 0 };
  const before = rankMoves(moves, starter).find((move) => sameMove(move, example))!;
  const weights = teach(moves, example, starter);
  const after = rankMoves(moves, weights);
  assert.ok(after.find((move) => sameMove(move, example))!.preference > before.preference);

  const search = searchMoves(board, "Pair", weights);
  let result = search.next();
  while (!result.done) result = search.next();
  assert.ok(sameMove(result.value, after[0]));
});

test("a placement outside the board cannot train the bot", () => {
  const moves = placements(new Set(), "Pair");
  assert.equal(teach(moves, { column: 8, turns: 0 }, starter), starter);
});
