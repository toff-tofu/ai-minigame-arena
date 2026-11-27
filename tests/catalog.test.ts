import assert from "node:assert/strict";
import test from "node:test";
import { games, type GameId } from "../src/game/catalog.ts";
import { searchGame } from "../src/ai/game-policy.ts";
import { starter } from "../src/ai/coaching.ts";

test("the shared policy plays every catalog game through to a legal result", () => {
  for (const id of Object.keys(games) as GameId[]) {
    const rules = games[id];
    let position = rules.start(42);
    for (let turn = 0; position.outcome === "playing" && turn < 100; turn++) {
      const search = searchGame(id, position, starter);
      let result = search.next();
      while (!result.done) result = search.next();
      assert.ok(rules.legal(position).includes(result.value), id);
      position = rules.apply(position, result.value);
    }
    assert.notEqual(position.outcome, "playing", id);
  }
});
