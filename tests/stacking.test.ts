import assert from "node:assert/strict";
import test from "node:test";
import { playTurn, startDuel } from "../src/game/duel.ts";
import { drop, height, isStable, TURNS, WIDTH } from "../src/game/stacking.ts";

test("a horizontal pair drops to the floor and scores one row", () => {
  const board = new Set<number>();
  const result = drop(board, "Pair", 2, 0);
  assert.equal(result.kind, "placed");
  if (result.kind !== "placed") return;
  assert.deepEqual(result.board, new Set([2, 3]));
  assert.equal(height(result.board), 1);
  assert.equal(board.size, 0);
});

test("a pair can overhang when its center is at the support edge", () => {
  const result = drop(new Set([0]), "Pair", 0, 0);
  assert.equal(result.kind, "placed");
});

test("a supported placement busts when its center is beyond the support", () => {
  const result = drop(new Set([0]), "Corner", 0, 2);
  assert.deepEqual(result, { kind: "bust", reason: "The tower's weight shifted beyond its support." });
});

test("a separate unsupported mass fails the stability check", () => {
  assert.equal(isStable(new Set([0, WIDTH + 2])), false);
});

test("overflow busts while an out-of-bounds move leaves the duel intact", () => {
  const board = new Set(Array.from({ length: 16 }, (_, y) => y * WIDTH));
  assert.equal(drop(board, "Pair", 0, 1).kind, "bust");
  const duel = startDuel(42);
  assert.equal(playTurn(duel, WIDTH - 1, 0).duel, duel);
});

test("the remaining player finishes all turns after an opponent busts", () => {
  const start = startDuel(42);
  let duel = { ...start, pieces: Array<typeof start.pieces[number]>(TURNS).fill("Pair") };
  duel = playTurn(duel, 0, 0).duel;
  duel = playTurn(duel, 0, 0).duel;
  duel = playTurn(duel, 1, 0).duel;
  duel = playTurn(duel, 0, 0).duel;
  duel = playTurn(duel, 2, 0).duel;
  assert.ok(duel.players[0].bust);
  for (let turn = 0; turn < TURNS - 2; turn++) {
    duel = playTurn(duel, 0, 0).duel;
  }
  assert.equal(duel.players[1].turns, TURNS);
  assert.equal(duel.outcome, 1);
  assert.deepEqual(startDuel(42).pieces, start.pieces);
});
