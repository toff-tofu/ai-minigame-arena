import assert from "node:assert/strict";
import test from "node:test";
import { playTurn, startDuel } from "../src/game/duel.ts";
import { runBotMatch } from "../src/matches/bot-match.ts";

test("a seeded bot match is reproducible and its moves replay to the same outcome", () => {
  const strategies = ["height", "stability"] as const;
  const match = runBotMatch(42, strategies);
  assert.deepEqual(runBotMatch(42, strategies), match);
  assert.notEqual(match.duel.outcome, "playing");
  let replay = startDuel(match.seed);
  for (const move of match.moves) {
    assert.equal(replay.active, move.player);
    const result = playTurn(replay, move.column, move.turns);
    assert.equal(result.error, undefined);
    replay = result.duel;
  }
  assert.deepEqual(replay, match.duel);
});

test("identical bots draw on the same pieces, including when both bust", () => {
  const match = runBotMatch(42, ["height", "height"]);
  assert.deepEqual(match.duel.players[0], match.duel.players[1]);
  assert.equal(match.duel.outcome, "draw");
});
