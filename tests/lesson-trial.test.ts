import assert from "node:assert/strict";
import test from "node:test";
import { starter } from "../src/ai/coaching.ts";
import { games } from "../src/game/catalog.ts";
import { startDuel } from "../src/game/duel.ts";
import { tryLesson } from "../src/game/lesson-trial.ts";

test("lesson trials use the same replay state without modifying it", () => {
  const start = startDuel(42);
  const position = { game: "stacking", state: start } as const;
  const before = tryLesson(position, 0, starter);
  const after = tryLesson(position, 0, [-8, 1]);
  assert.equal(before.moves.length, 6);
  assert.notDeepEqual(before.moves, after.moves);
  assert.deepEqual(tryLesson(position, 0, starter), before);
  assert.deepEqual(position.state, startDuel(42));
});

test("a catalog trial stops at a terminal position", () => {
  const rules = games.tictactoe;
  const state = [0, 3, 1, 4].reduce((state, move) => rules.apply(state, move), rules.start(42));
  const trial = tryLesson({ game: "tictactoe", state }, 0, starter);
  assert.deepEqual(trial.moves, ["Your bot · Tile 3"]);
  assert.equal(trial.outcome, 0);
  assert.equal(state.outcome, "playing");
});
