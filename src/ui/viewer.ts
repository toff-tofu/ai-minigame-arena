import { placements, rankMoves, sameMove, starter, teach, type Weights } from "../ai/coaching.ts";
import { searchMoves, type Move } from "../ai/baselines.ts";
import { startDuel, playTurn, type Duel } from "../game/duel.ts";
import { HEIGHT, WIDTH, height, orientation, landingRow, drop, type Piece } from "../game/stacking.ts";

const strategies = ["height", "stability"] as const;
const names = ["Your bot", "Stability bot"];
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

type Frame = { duel: Duel; player?: 0 | 1; added?: number[]; move?: Move };
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

const storageKey = "stacking-arena-weights-v1";
function loadWeights(): Weights {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (Array.isArray(value) && value.length === 2 &&
        value.every((weight) => typeof weight === "number" && Number.isFinite(weight) && Math.abs(weight) <= 16)) {
      return [value[0], value[1]];
    }
  } catch {
    // The viewer can still run when browser storage is unavailable.
  }
  return starter;
}
let weights = loadWeights();
let matchWeights = weights;
const columnInput = element<HTMLInputElement>("coach-column");
const rotationInput = element<HTMLSelectElement>("coach-rotation");
const teachButton = element<HTMLButtonElement>("teach");
const feedback = element("coach-feedback");
let teachingFrame: Frame | undefined;

function coachingState() {
  const duel = frames[cursor].duel;
  const next = frames[cursor + 1];
  if (mode !== "paused" || duel.active !== 0 || next?.player !== 0 || !next.move) return;
  const { board, turns } = duel.players[0];
  return { next, board, piece: duel.pieces[turns], move: {
    column: columnInput.valueAsNumber - 1, turns: Number(rotationInput.value),
  } };
}

function renderCoaching(state: ReturnType<typeof coachingState>) {
  element("coach-controls").hidden = !state;
  element("coach-hint").textContent = state
    ? `Try a different drop for this ${state.piece}. Lessons apply to your next new match.`
    : "Pause and rewind to just before one of your bot’s completed turns.";
  if (teachingFrame !== state?.next) {
    teachingFrame = state?.next;
    feedback.textContent = "";
  }
  const result = state && drop(state.board, state.piece, state.move.column, state.move.turns);
  teachButton.disabled = result?.kind !== "placed";
  const original = state?.next.move;
  const originalText = original ? `Bot played column ${original.column + 1}, ${90 * original.turns}°. ` : "";
  element("coach-preview").textContent = result
    ? originalText + (result.kind === "placed"
      ? `Your drop reaches height ${height(result.board)}, with ${result.margin.toFixed(2)} cells of support margin.`
      : result.reason)
    : "";
  return result;
}

function drawCell(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, inset = 2) {
  ctx.fillStyle = color;
  ctx.fillRect(x * cellSize + inset, (HEIGHT + 3 - y) * cellSize + inset,
    cellSize - 2 * inset, cellSize - 2 * inset);
}

function render() {
  const frame = frames[cursor];
  const live = cursor === frames.length - 1;
  const coaching = coachingState();
  const preview = renderCoaching(coaching);
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
    if (i === 0 && coaching && preview?.kind === "placed") {
      for (const cell of preview.board) {
        if (!player.board.has(cell)) drawCell(ctx, cell % WIDTH, Math.floor(cell / WIDTH), "#a9f1ad");
      }
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
        turn = { player, piece, search: searchMoves(board, piece, player === 0 ? matchWeights : "stability") };
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
        frames.push({ duel: result.duel, player, added, move: selected });
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
  matchWeights = weights;
  frames = [{ duel: startDuel(seedInput.valueAsNumber) }];
  render();
};
function previewChange() {
  feedback.textContent = "";
  render();
}
columnInput.oninput = previewChange;
rotationInput.onchange = previewChange;
teachButton.onclick = () => {
  const state = coachingState();
  if (!state) return;
  const moves = placements(state.board, state.piece);
  const before = rankMoves(moves, weights);
  const target = before.find((move) => sameMove(move, state.move));
  if (!target) return;
  const updated = teach(moves, state.move, weights);
  if (updated === weights) {
    feedback.textContent = "This example can't raise the preference further. Try a different placement or position.";
    return;
  }
  weights = updated;
  const after = rankMoves(moves, weights);
  const taught = after.find((move) => sameMove(move, state.move))!;
  const previous = state.next.move!;
  const oldRank = before.find((move) => sameMove(move, previous))?.rank;
  const newRank = after.find((move) => sameMove(move, previous))?.rank;
  let persistence = "Saved in this browser.";
  try {
    localStorage.setItem(storageKey, JSON.stringify(weights));
  } catch {
    persistence = "Saved for this page session.";
  }
  feedback.textContent = `Your move ranked ${target.rank} → ${taught.rank} of ${moves.length}. ` +
    `Its preference weight rose from ${(100 * target.preference).toPrecision(3)}% to ${(100 * taught.preference).toPrecision(3)}%. ` +
    (oldRank && newRank ? `The bot’s original move ranked ${oldRank} → ${newRank}. ` : "") +
    `The updated bot would choose column ${after[0].column + 1}, ${after[0].turns * 90}°. ${persistence}`;
};
render();
