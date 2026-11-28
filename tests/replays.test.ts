import assert from "node:assert/strict";
import test from "node:test";
import { validateReplay } from "../src/game/replays.ts";
import { runBotMatch } from "../src/matches/bot-match.ts";

const base = { id: "af779e2a-1b66-43fd-b6b0-522678439008", seed: 42, seat: 1, mode: "online" };

test("replay validation preserves the seat and derives the result instead of trusting the client", () => {
  const replay = { ...base, game: "tictactoe", moves: [0, 3, 1, 4, 2] };
  assert.deepEqual(validateReplay({ ...replay, outcome: 1 }), { replay, outcome: 0 });
  assert.equal(validateReplay({ ...replay, moves: [0, 0, 1, 4, 2] }), undefined);
  assert.equal(validateReplay({ ...replay, moves: [0, 3] }), undefined);
  assert.equal(validateReplay({ ...replay, moves: [...replay.moves, 8] }), undefined);
});

test("completed stacking logs can be saved and out-of-order moves are rejected", () => {
  const match = runBotMatch(42, ["height", "stability"]);
  const replay = { ...base, game: "stacking", moves: match.moves };
  assert.deepEqual(validateReplay(replay), { replay, outcome: match.duel.outcome });
  assert.equal(validateReplay({ ...replay, moves: [{ ...replay.moves[0], player: 1 }, ...replay.moves.slice(1)] }), undefined);
});
