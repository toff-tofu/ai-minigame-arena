import { searchMoves, type Move } from "../ai/baselines.ts";
import { startDuel, playTurn, type Duel } from "../game/duel.ts";
import { HEIGHT, WIDTH, orientation, landingRow, type Piece } from "../game/stacking.ts";

const strategies = ["height", "stability"] as const;
const names = ["Height bot", "Stability bot"];
const colors = ["#65b6ff", "#ffbc69"];
const cellSize = 32;
const spawn = HEIGHT + 1;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const play = element<HTMLButtonElement>("play");
const back = element<HTMLButtonElement>("back");
const step = element<HTMLButtonElement>("step");
const timeline = element<HTMLInputElement>("timeline");
const seedInput = element<HTMLInputElement>("seed");
const status = element("status");
const contexts = strategies.map((_, i) => element<HTMLCanvasElement>(`board-${i}`).getContext("2d")!);

type Frame = { duel: Duel; player?: 0 | 1; added?: number[] };
type Pose = Move & { row: number };
type Turn = {
  player: 0 | 1;
  piece: Piece;
  search: Generator<Move, Move>;
  pose?: Pose;
  selected?: Move;
  landing?: number;
};

let frames: Frame[] = [{ duel: startDuel(seedInput.valueAsNumber) }];
let cursor = 0;
let turn: Turn | undefined;
let mode: "paused" | "play" | "step" = "paused";
let timer: number | undefined;

function drawCell(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, inset = 2) {
  ctx.fillStyle = color;
  ctx.fillRect(x * cellSize + inset, (HEIGHT + 3 - y) * cellSize + inset,
    cellSize - 2 * inset, cellSize - 2 * inset);
}

function render() {
  const frame = frames[cursor];
  const live = cursor === frames.length - 1;
  for (const [i, ctx] of contexts.entries()) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const player = frame.duel.players[i];
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) drawCell(ctx, x, y, "#172235", 1);
    }
    for (const cell of player.board) {
      const fresh = frame.player === i && frame.added?.includes(cell);
      drawCell(ctx, cell % WIDTH, Math.floor(cell / WIDTH), fresh ? "#f3f8ff" : colors[i]);
    }
    if (live && turn?.player === i && turn.pose) {
      const { column, turns, row } = turn.pose;
      for (const [x, y] of orientation(turn.piece, turns)) {
        drawCell(ctx, column + x, row + y, turn.selected ? "#ffffff" : colors[i]);
      }
    }
    element(`score-${i}`).textContent = String(player.score);
    element(`bust-${i}`).textContent = player.bust ? `Bust. ${player.bust}` : "";
  }
  const { outcome, active } = frame.duel;
  const finished = outcome !== "playing";
  const moving = live && turn;
  const message = finished
    ? outcome === "draw" ? "Draw." : `${names[outcome]} wins.`
    : !live ? `Turn ${cursor}. Reviewing a completed position.`
    : moving ? `${names[active]} is ${moving.selected ? "dropping" : "testing placements for"} its ${moving.piece}.`
    : `${names[active]} to move.`;
  if (status.textContent !== message) status.textContent = message;
  play.textContent = mode === "paused" ? "Play" : "Pause";
  play.disabled = finished;
  step.disabled = finished || mode !== "paused";
  back.disabled = cursor === 0;
  timeline.max = String(frames.length - 1);
  timeline.value = String(cursor);
  timeline.disabled = frames.length === 1;
  element("turn").textContent = `${cursor} / ${frames.length - 1}`;
}

function advance() {
  timer = undefined;
  if (mode === "paused") return;
  let delay = 38;
  if (cursor < frames.length - 1) {
    cursor++;
    delay = 350;
    if (mode === "step") mode = "paused";
  } else {
    const duel = frames[cursor].duel;
    if (duel.outcome === "playing") {
      if (!turn) {
        const player = duel.active;
        const { board, turns } = duel.players[player];
        const piece = duel.pieces[turns];
        turn = { player, piece, search: searchMoves(board, piece, strategies[player]) };
      }

      if (!turn.selected) {
        const candidate = turn.search.next();
        turn.pose = { ...candidate.value, row: spawn };
        if (candidate.done) {
          turn.selected = candidate.value;
          turn.landing = landingRow(duel.players[turn.player].board,
            orientation(turn.piece, candidate.value.turns), candidate.value.column);
          delay = 150;
        }
      } else if (turn.pose!.row > turn.landing!) {
        turn.pose!.row--;
      } else {
        const { player, selected } = turn;
        const result = playTurn(duel, selected.column, selected.turns);
        if (result.error) throw new Error(result.error);
        const before = duel.players[player].board;
        const added = [...result.duel.players[player].board].filter((cell) => !before.has(cell));
        frames.push({ duel: result.duel, player, added });
        cursor++;
        turn = undefined;
        delay = 420;
        if (mode === "step") mode = "paused";
      }
    }
  }

  if (frames[cursor].duel.outcome !== "playing") mode = "paused";
  render();
  if (mode !== "paused") timer = window.setTimeout(advance, delay);
}

function pause() {
  window.clearTimeout(timer);
  timer = undefined;
  mode = "paused";
}

play.onclick = () => {
  if (mode !== "paused") {
    pause();
    render();
  } else {
    mode = "play";
    advance();
  }
};
step.onclick = () => {
  mode = "step";
  advance();
};
back.onclick = () => {
  pause();
  cursor--;
  render();
};
timeline.oninput = () => {
  pause();
  cursor = timeline.valueAsNumber;
  render();
};
element<HTMLFormElement>("match").onsubmit = (event) => {
  event.preventDefault();
  pause();
  turn = undefined;
  cursor = 0;
  frames = [{ duel: startDuel(seedInput.valueAsNumber) }];
  render();
};
render();
