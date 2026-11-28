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

test("catalog coaching increases preference without teaching illegal moves", async () => {
  const { rankGameMoves, teachGame } = await import("../src/ai/game-policy.ts");
  const position = games.tictactoe.start(42);
  const before = rankGameMoves("tictactoe", position, starter);
  const example = before.at(-1)!;
  const updated = teachGame("tictactoe", position, example.move, starter);
  const after = rankGameMoves("tictactoe", position, updated);
  assert.ok(after.find(({ move }) => move === example.move)!.preference > example.preference);
  assert.equal(teachGame("tictactoe", position, 100, starter), starter);
});

test("fresh bots sometimes miss a direct win and only pick legal moves", () => {
  assert.deepEqual(starter, [0, 0]);
  const rules = games.tictactoe;
  const position = [0, 3, 1, 4].reduce((state, move) => rules.apply(state, move), rules.start(42));
  const choices = new Set<number>();
  for (let seed = 0; seed < 24; seed++) {
    const search = searchGame("tictactoe", position, starter, seed);
    let step = search.next();
    while (!step.done) step = search.next();
    assert.ok(rules.legal(position).includes(step.value));
    choices.add(step.value);
  }
  assert.ok(choices.has(2));
  assert.ok(choices.size > 1);
});
