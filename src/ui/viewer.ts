import type { Replay } from "../game/replays.ts";
import { rankGameMoves, searchGame, teachGame } from "../ai/game-policy.ts";
import { games, isGameId, type GameId, type Position } from "../game/catalog.ts";
import { isWeights, placements, rankMoves, sameMove, starter, teach, type Weights } from "../ai/coaching.ts";
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
let practiceSeed = seedInput.valueAsNumber;
let archivedSeat: 0 | 1 | undefined;
const currentSeat = () => online?.seat ?? archivedSeat ?? 0;
let turn: Turn | undefined;
let mode: "paused" | "play" | "step" = "paused";
let timer: number | undefined;

const storageKey = "stacking-arena-weights-v1";
function loadWeights(): Weights {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (isWeights(value)) return value;
  } catch {
    // The viewer can still run when browser storage is unavailable.
  }
  return starter;
}
let weights = loadWeights();
let matchWeights = weights;
const columnInput = element<HTMLInputElement>("coach-column");
const rotationInput = element<HTMLSelectElement>("coach-rotation");
const coachLast = element<HTMLButtonElement>("coach-last");
const teachButton = element<HTMLButtonElement>("teach");
const feedback = element("coach-feedback");
let teachingFrame: Frame | undefined;

type OnlinePose = Pose & { player: 0 | 1; piece: Piece; dropping: boolean };
const gameSelect = element<HTMLSelectElement>("game");
for (const [id, rules] of Object.entries(games)) gameSelect.add(new Option(rules.title, id));
type CatalogMatch = { id: GameId; positions: Position[]; moves: number[]; candidate?: number;
  search?: Generator<number, number> };
let catalog: CatalogMatch | undefined;

function startCatalog(id: GameId, seed: number): CatalogMatch {
  return { id, positions: [games[id].start(seed)], moves: [] };
}

function appendCatalogMove(match: CatalogMatch, move: number) {
  match.moves.push(move);
  match.positions.push(games[match.id].apply(match.positions.at(-1)!, move));
}

type OnlineSnapshot = {
  catalogMoves?: number[];
  candidate?: number;
  seed: number;
  moves: (Move & { player: 0 | 1 })[];
  pose?: OnlinePose;
  phase: "waiting" | "playing" | "finished";
};
type OnlineBattle = { code: string; seed: number; seat: 0 | 1; stream: EventSource;
  pose?: OnlinePose; phase: OnlineSnapshot["phase"] };
let online: OnlineBattle | undefined;
let requestPending = false;
const battleNote = element("battle-note");
const quickMatch = element<HTMLButtonElement>("quick-match");
let matchSearch: AbortController | undefined;
const createBattle = element<HTMLButtonElement>("create-battle");
const joinBattle = element<HTMLFormElement>("join-battle");
const battleCode = element<HTMLInputElement>("battle-code");

async function enterBattle(code?: string, random = false) {
  if (requestPending) return;
  requestPending = true;
  createBattle.disabled = true;
  const search = random ? new AbortController() : undefined;
  matchSearch = search;
  quickMatch.textContent = random ? "Cancel search" : "Find opponent";
  quickMatch.disabled = !random;
  battleNote.textContent = random ? "Looking for another player…" : "Connecting…";
  try {
    const response = await fetch(random ? "/api/matchmaking" : code ? `/api/battles/${code}/join` : "/api/battles", {
      signal: search?.signal,
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(!code && isGameId(gameSelect.value) ? { weights, game: gameSelect.value } : weights),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    online?.stream.close();
    resetReplaySave();
    pause();
    turn = undefined;
    cursor = 0;
    frames = [{ duel: startDuel(result.seed) }];
    catalog = isGameId(result.game) ? startCatalog(result.game, result.seed) : undefined;
    gameSelect.value = catalog?.id ?? "stacking";
    const stream = new EventSource(`/api/battles/${result.code}/events`);
    online = { ...result, stream, phase: "waiting" };
    battleCode.value = result.code;
    battleNote.textContent = random ? "Opponent found."
      : `Invite code ${result.code}. Share it with the other player.`;
    stream.onmessage = (event) => {
      if (online?.stream !== stream) return;
      const snapshot: OnlineSnapshot = JSON.parse(event.data);
      if (catalog) {
        const following = cursor === catalog.moves.length;
        for (const move of (snapshot.catalogMoves ?? []).slice(catalog.moves.length)) appendCatalogMove(catalog, move);
        if (following) cursor = catalog.moves.length;
        catalog.candidate = snapshot.candidate;
      } else {
        const following = cursor === frames.length - 1;
        for (const move of snapshot.moves.slice(frames.length - 1)) appendMove(move, move.player);
        if (following) cursor = frames.length - 1;
      }
      online.pose = snapshot.pose;
      online.phase = snapshot.phase;
      battleNote.textContent = online.phase === "waiting" && !random
        ? `Invite code ${online.code}. Waiting for the other player.`
        : `Battle ${online.code} · Seed ${snapshot.seed}`;
      if (online.phase === "finished") stream.close();
      render();
    };
    stream.onerror = () => {
      if (online?.stream === stream) {
        battleNote.textContent = stream.readyState === EventSource.CLOSED
          ? "Battle connection closed. Start or join another battle."
          : "Battle connection interrupted. Reconnecting…";
      }
    };
    render();
  } catch (error) {
    battleNote.textContent = search?.signal.aborted ? "Search canceled."
      : error instanceof Error ? error.message : "Could not connect to battle.";
  } finally {
    requestPending = false;
    createBattle.disabled = false;
    matchSearch = undefined;
    quickMatch.textContent = "Find opponent";
    quickMatch.disabled = false;
  }
}

quickMatch.onclick = () => matchSearch ? matchSearch.abort() : void enterBattle(undefined, true);
createBattle.onclick = () => void enterBattle();
joinBattle.onsubmit = (event) => {
  event.preventDefault();
  void enterBattle(battleCode.value.trim().toUpperCase());
};

function appendMove(move: Move, player: 0 | 1) {
  const duel = frames[frames.length - 1].duel;
  const result = playTurn(duel, move.column, move.turns);
  if (result.error) throw new Error(result.error);
  const before = duel.players[player].board;
  const added = [...result.duel.players[player].board].filter((cell) => !before.has(cell));
  frames.push({ duel: result.duel, player, added, move });
}

function coachingState() {
  const duel = frames[cursor].duel;
  const next = frames[cursor + 1];
  const seat = currentSeat();
  if (mode !== "paused" || duel.active !== seat || next?.player !== seat || !next.move) return;
  const { board, turns } = duel.players[seat];
  return { next, seat, board, piece: duel.pieces[turns], move: {
    column: columnInput.valueAsNumber - 1, turns: Number(rotationInput.value),
  } };
}

function renderCoaching(state: ReturnType<typeof coachingState>) {
  coachLast.disabled = !frames.some((frame) => frame.player === currentSeat());
  columnInput.disabled = !state;
  rotationInput.disabled = !state;
  element("coach-hint").textContent = state
    ? `Try a different drop for this ${state.piece}. Lessons apply the next time you create or join a battle or start a local match.`
    : online
      ? "Choose Coach my last move after your bot has played, or use the timeline to pick an earlier turn."
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

const coachMove = element<HTMLSelectElement>("coach-move");
let coachedPosition: Position | undefined;

function moveLabel(game: GameId, move: number) {
  return games[game].preview?.(move).label.replace(/^Testing taking /, "Take ") ?? `Tile ${move + 1}`;
}

function catalogCoaching(match: CatalogMatch) {
  const position = match.positions[cursor];
  const previous = match.moves[cursor];
  const seat = currentSeat();
  if (mode !== "paused" || previous === undefined || position.active !== seat) return;
  return { position, previous };
}

function renderCatalogCoaching(match: CatalogMatch) {
  const seat = currentSeat();
  coachLast.disabled = !match.moves.some((_, index) => match.positions[index].active === seat);
  const state = catalogCoaching(match);
  if (coachedPosition !== state?.position) {
    coachedPosition = state?.position;
    feedback.textContent = "";
    const legal = state ? games[match.id].legal(state.position) : [];
    coachMove.replaceChildren(...legal.map((move) => new Option(moveLabel(match.id, move), String(move))));
    const otherMove = legal.find((move) => move !== state?.previous);
    if (otherMove !== undefined) coachMove.value = String(otherMove);
  }
  coachMove.disabled = !state;
  teachButton.disabled = !state || !coachMove.value;
  element("coach-hint").textContent = state
    ? "Preview a legal move. A lesson applies to your next match."
    : "Choose Coach my last move after your bot plays.";
  element("coach-preview").textContent = state ? `Bot played ${moveLabel(match.id, state.previous)}.` : "";
  if (state && coachMove.value) return games[match.id].apply(state.position, Number(coachMove.value));
}

function renderCatalog(match: CatalogMatch) {
  const rules = games[match.id];
  const position = match.positions[cursor];
  const last = match.moves.length;
  const live = cursor === last;
  const labels = online || archivedSeat !== undefined ? ["Player 1", "Player 2"] : ["Your bot", "Practice bot"];
  if (online || archivedSeat !== undefined) labels[currentSeat()] += " · Your bot";
  element("catalog-title").textContent = rules.title;
  element("catalog-rules").textContent = rules.instructions;
  const grid = element("catalog-grid");
  grid.style.setProperty("--columns", String(Math.min(rules.columns, position.cells.length)));
  const candidate = live ? match.candidate : undefined;
  const preview = (move: number) => rules.preview?.(move) ?? { cell: move, label: `Testing tile ${move + 1}` };
  const lastMove = match.moves[cursor - 1];
  const lesson = renderCatalogCoaching(match);
  grid.replaceChildren(...position.cells.map((value, i) => {
    const cell = document.createElement("span");
    const proposed = lesson?.cells[i];
    cell.textContent = rules.label(proposed ?? value);
    if (proposed !== undefined && proposed !== value) cell.dataset.lesson = "";
    if (candidate !== undefined && i === preview(candidate).cell) cell.dataset.candidate = "";
    if (lastMove !== undefined && i === preview(lastMove).cell) cell.dataset.last = "";
    return cell;
  }));
  element("catalog-move").textContent = candidate === undefined ? "" : preview(candidate).label;
  const message = online?.phase === "waiting" ? "Waiting for a second bot."
    : position.outcome === "draw" ? "Draw."
    : position.outcome !== "playing" ? `${labels[position.outcome]} wins.`
    : live ? `${labels[position.active]} to move.` : `Reviewing turn ${cursor}.`;
  if (status.textContent !== message) status.textContent = message;
  play.textContent = mode === "paused" ? "Play" : "Pause";
  play.disabled = Boolean(online) || (live && position.outcome !== "playing");
  step.disabled = online ? live : mode !== "paused" || (live && position.outcome !== "playing");
  back.disabled = cursor === 0;
  timeline.disabled = last === 0;
  timeline.max = String(last);
  timeline.value = String(cursor);
  element("turn").textContent = `${cursor} / ${last}`;
}

function advanceCatalog(match: CatalogMatch) {
  let delay = 100;
  if (cursor < match.moves.length) {
    cursor++;
    delay = 350;
    if (mode === "step") mode = "paused";
  } else {
    const position = match.positions[cursor];
    if (position.outcome !== "playing") mode = "paused";
    else {
      match.search ??= searchGame(match.id, position, position.active === 0 ? matchWeights : [2, 7]);
      const next = match.search.next();
      if (next.done) {
        appendCatalogMove(match, next.value);
        cursor++;
        match.search = undefined;
        match.candidate = undefined;
        delay = 430;
        if (mode === "step" || match.positions[cursor].outcome !== "playing") mode = "paused";
      } else {
        match.candidate = next.value;
      }
    }
  }
  render();
  if (mode !== "paused") timer = window.setTimeout(advance, delay);
}

function render() {
  maybeSaveReplay();
  element("catalog-choice").hidden = !catalog;
  columnInput.closest("label")!.hidden = Boolean(catalog);
  rotationInput.closest("label")!.hidden = Boolean(catalog);
  element("boards").hidden = Boolean(catalog);
  element("catalog-board").hidden = !catalog;
  if (catalog) return renderCatalog(catalog);
  coachedPosition = undefined;
  const frame = frames[cursor];
  const live = cursor === frames.length - 1;
  const coaching = coachingState();
  const preview = renderCoaching(coaching);
  const labels = online || archivedSeat !== undefined ? ["Player 1", "Player 2"] : names;
  const remotePose = live ? online?.pose : undefined;
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
    if (coaching?.seat === i && preview?.kind === "placed") {
      for (const cell of preview.board) {
        if (!player.board.has(cell)) drawCell(ctx, cell % WIDTH, Math.floor(cell / WIDTH), "#a9f1ad");
      }
    }
    if (remotePose?.player === i) {
      for (const [x, y] of orientation(remotePose.piece, remotePose.turns)) {
        drawCell(ctx, remotePose.column + x, remotePose.row + y, remotePose.dropping ? "#fff" : colors[i]);
      }
    }
    if (live && turn?.player === i && turn.pose) {
      const { column, turns, row } = turn.pose;
      for (const [x, y] of orientation(turn.piece, turns)) {
        drawCell(ctx, column + x, row + y, turn.selected ? "#ffffff" : colors[i]);
      }
    }
    element(`name-${i}`).textContent = (online || archivedSeat !== undefined) && currentSeat() === i ? `${labels[i]} · Your bot` : labels[i];
    element(`score-${i}`).textContent = String(player.score);
    element(`bust-${i}`).textContent = player.bust ? `Bust. ${player.bust}` : "";
  }
  const { outcome, active } = frame.duel;
  const finished = outcome !== "playing";
  const moving = live && turn;
  const message = online?.phase === "waiting" ? "Waiting for a second bot."
    : remotePose ? `${labels[active]} is ${remotePose.dropping ? "dropping" : "testing placements for"} its ${remotePose.piece}.`
    : finished
    ? outcome === "draw" ? "Draw." : `${labels[outcome]} wins.`
    : !live ? `Turn ${cursor}. Reviewing a completed position.`
    : moving ? `${labels[active]} is ${moving.selected ? "dropping" : "testing placements for"} its ${moving.piece}.`
    : `${labels[active]} to move.`;
  if (status.textContent !== message) status.textContent = message;
  play.textContent = mode === "paused" ? "Play" : "Pause";
  play.disabled = Boolean(online) || finished;
  step.disabled = online ? live : finished || mode !== "paused";
  back.disabled = cursor === 0;
  timeline.max = String(frames.length - 1);
  timeline.value = String(cursor);
  timeline.disabled = frames.length === 1;
  element("turn").textContent = `${cursor} / ${frames.length - 1}`;
}

function advance() {
  timer = undefined;
  if (mode === "paused") return;
  if (catalog) return advanceCatalog(catalog);
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
        appendMove(selected, player);
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
  if (online) {
    if (cursor < (catalog?.moves.length ?? frames.length - 1)) cursor++;
    render();
    return;
  }
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
  if (requestPending) return;
  online?.stream.close();
  online = undefined;
  resetReplaySave();
  battleNote.textContent = "";
  pause();
  turn = undefined;
  cursor = 0;
  matchWeights = weights;
  practiceSeed = seedInput.valueAsNumber;
  frames = [{ duel: startDuel(practiceSeed) }];
  catalog = isGameId(gameSelect.value) ? startCatalog(gameSelect.value, practiceSeed) : undefined;
  render();
};
coachLast.onclick = () => {
  const seat = currentSeat();
  if (catalog) {
    const match = catalog;
    const index = match.moves.findLastIndex((_, turn) => match.positions[turn].active === seat);
    if (index < 0) return;
    pause();
    cursor = index;
    render();
    return;
  }
  const index = frames.findLastIndex((frame) => frame.player === seat);
  if (index <= 0) return;
  pause();
  cursor = index - 1;
  const state = coachingState();
  if (state) {
    const options = placements(state.board, state.piece);
    const alternative = options.find((move) => !sameMove(move, state.next.move!)) ?? options[0];
    if (alternative) {
      columnInput.value = String(alternative.column + 1);
      rotationInput.value = String(alternative.turns);
    }
  }
  feedback.textContent = "";
  render();
};

function previewChange() {
  feedback.textContent = "";
  render();
}
columnInput.oninput = previewChange;
rotationInput.onchange = previewChange;
coachMove.onchange = previewChange;

function saveLearnedWeights(updated: Weights) {
  weights = updated;
  try {
    localStorage.setItem(storageKey, JSON.stringify(weights));
    return "Saved in this browser.";
  } catch {
    return "Saved for this page session.";
  }
}

function teachCatalog(match: CatalogMatch) {
  const state = catalogCoaching(match);
  if (!state || !coachMove.value) return;
  const move = Number(coachMove.value);
  const before = rankGameMoves(match.id, state.position, weights);
  const target = before.find((option) => option.move === move);
  if (!target) return;
  const updated = teachGame(match.id, state.position, move, weights);
  if (updated === weights) {
    feedback.textContent = "This move couldn’t gain preference here. Try another position.";
    return;
  }
  const after = rankGameMoves(match.id, state.position, updated);
  const taught = after.find((option) => option.move === move)!;
  const persistence = saveLearnedWeights(updated);
  feedback.textContent = `Your move ranked ${target.rank} → ${taught.rank} of ${before.length}. ` +
    `Its preference rose from ${(100 * target.preference).toPrecision(3)}% to ${(100 * taught.preference).toPrecision(3)}%. ` +
    `The updated bot would choose ${moveLabel(match.id, after[0].move)}. ${persistence}`;
}
teachButton.onclick = () => {
  if (catalog) return teachCatalog(catalog);
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
  const after = rankMoves(moves, updated);
  const taught = after.find((move) => sameMove(move, state.move))!;
  const previous = state.next.move!;
  const oldRank = before.find((move) => sameMove(move, previous))?.rank;
  const newRank = after.find((move) => sameMove(move, previous))?.rank;
  const persistence = saveLearnedWeights(updated);
  feedback.textContent = `Your move ranked ${target.rank} → ${taught.rank} of ${moves.length}. ` +
    `Its preference weight rose from ${(100 * target.preference).toPrecision(3)}% to ${(100 * taught.preference).toPrecision(3)}%. ` +
    (oldRank && newRank ? `The bot’s original move ranked ${oldRank} → ${newRank}. ` : "") +
    `The updated bot would choose column ${after[0].column + 1}, ${after[0].turns * 90}°. ${persistence}`;
};
const recoveryCode = element<HTMLInputElement>("recovery-code");
const saveBot = element<HTMLButtonElement>("save-bot");
const loadBot = element<HTMLButtonElement>("load-bot-button");
const saveStatus = element("bot-save-status");
let savePending = false;

async function sendBotSave(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

async function runSaveAction(action: () => Promise<void>) {
  if (savePending) return;
  savePending = true;
  saveBot.disabled = true;
  loadBot.disabled = true;
  saveStatus.textContent = "Working…";
  try {
    await action();
  } catch (error) {
    saveStatus.textContent = error instanceof Error ? error.message : "Could not complete the request.";
  } finally {
    savePending = false;
    saveBot.disabled = false;
    loadBot.disabled = false;
  }
}

saveBot.onclick = () => void runSaveAction(async () => {
  const { code } = await sendBotSave("/api/bot-saves", weights);
  recoveryCode.value = code;
  recoveryCode.select();
  saveStatus.textContent = "Saved. Copy this private code and enter it on your other device.";
});

element<HTMLFormElement>("load-bot").onsubmit = (event) => {
  event.preventDefault();
  void runSaveAction(async () => {
    const { weights: restored } = await sendBotSave("/api/bot-saves/load", recoveryCode.value.trim().toLowerCase());
    if (!isWeights(restored)) throw new Error("The server returned an invalid bot.");
    weights = restored;
    try {
      localStorage.setItem(storageKey, JSON.stringify(weights));
      saveStatus.textContent = "Bot loaded. Your next match will use its saved training.";
    } catch {
      saveStatus.textContent = "Bot loaded for this page session. Your next match will use its training.";
    }
    recoveryCode.value = "";
    feedback.textContent = "";
  });
};

let accountVersion: number | undefined;
const accountStatus = element("account-status");
const accountPanel = element("account");
const accountActions = element("account-actions");
const signIn = element("sign-in");

async function accountRequest(method = "GET", path = "/api/account", body?: unknown) {
  const response = await fetch(path, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

type HistoryItem = { replay: Replay; outcome: "draw" | 0 | 1; saved_at: string };
const historyDialog = element<HTMLDialogElement>("match-history");
const historyList = element("history-list");
const historyStatus = element("history-status");
const historyMore = element<HTMLButtonElement>("history-more");
const replayStatus = element("replay-save-status");
let historyOffset = 0;
let loadingHistory = false;
let saveAttempted = false;
let replayGeneration = 0;

function resetReplaySave() {
  saveAttempted = false;
  replayGeneration++;
  archivedSeat = undefined;
  replayStatus.hidden = true;
}

function completedReplay(): Replay | undefined {
  const outcome = catalog ? catalog.positions.at(-1)!.outcome : frames.at(-1)!.duel.outcome;
  if (outcome === "playing") return;
  const metadata = { id: crypto.randomUUID(), seed: practiceSeed, seat: 0 as const, mode: "practice" as const };
  if (catalog) {
    return { ...metadata, game: catalog.id, moves: [...catalog.moves] };
  }
  const moves = frames.slice(1).map(({ move, player }) => ({ ...move!, player: player! }));
  return { ...metadata, game: "stacking", moves };
}

function maybeSaveReplay() {
  if (online || saveAttempted || archivedSeat !== undefined || accountVersion === undefined) return;
  const replay = completedReplay();
  if (!replay) return;
  saveAttempted = true;
  const generation = replayGeneration;
  const save = async () => {
    try {
      await accountRequest("POST", "/api/account/replays", replay);
      if (generation !== replayGeneration) return;
      replayStatus.textContent = "Saved to match history.";
      replayStatus.hidden = false;
    } catch {
      if (generation !== replayGeneration) return;
      const retry = document.createElement("button");
      retry.textContent = "Retry replay save";
      retry.onclick = () => {
        replayStatus.hidden = true;
        void save();
      };
      replayStatus.replaceChildren("Couldn’t save this replay. ", retry);
      replayStatus.hidden = false;
    }
  };
  void save();
}

function openReplay(replay: Replay) {
  pause();
  matchSearch?.abort();
  online?.stream.close();
  online = undefined;
  turn = undefined;
  resetReplaySave();
  archivedSeat = replay.seat;
  gameSelect.value = replay.game;
  frames = [{ duel: startDuel(replay.seed) }];
  if (replay.game === "stacking") {
    catalog = undefined;
    for (const move of replay.moves) appendMove(move, move.player);
    cursor = frames.length - 1;
  } else {
    catalog = startCatalog(replay.game, replay.seed);
    for (const move of replay.moves) appendCatalogMove(catalog, move);
    cursor = catalog.moves.length;
  }
  battleNote.textContent = "Watching a saved replay.";
  historyDialog.close();
  render();
}

async function showHistory(reset: boolean) {
  if (loadingHistory) return;
  loadingHistory = true;
  if (reset) {
    historyOffset = 0;
    historyList.replaceChildren();
  }
  historyMore.disabled = true;
  historyStatus.textContent = "Loading…";
  try {
    const data = await accountRequest("GET", `/api/account/replays?offset=${historyOffset}`);
    const items: HistoryItem[] = data.items;
    for (const item of items) {
      const listItem = document.createElement("li");
      const button = document.createElement("button");
      const { replay, outcome } = item;
      const title = replay.game === "stacking" ? "Block Stacking" : games[replay.game].title;
      const result = outcome === "draw" ? "Draw" : outcome === replay.seat ? "Win" : "Loss";
      const date = new Date(item.saved_at).toLocaleDateString();
      button.textContent = `${title} · ${result} · ${replay.mode === "online" ? "Online" : "Practice"} · ${date}`;
      button.onclick = () => openReplay(replay);
      listItem.append(button);
      historyList.append(listItem);
    }
    historyOffset += items.length;
    historyMore.hidden = !data.more;
    historyStatus.textContent = historyOffset === 0 ? "Finish a match while signed in to see it here." : "";
  } catch {
    historyStatus.textContent = "Couldn’t load match history. Close it and try again.";
  } finally {
    loadingHistory = false;
    historyMore.disabled = false;
  }
}

element("history-open").onclick = () => {
  if (requestPending || historyDialog.open) return;
  historyDialog.showModal();
  void showHistory(true);
};
historyMore.onclick = () => void showHistory(false);

async function loadAccount(restore: boolean) {
  const data = await accountRequest();
  accountPanel.hidden = !data.enabled;
  accountActions.hidden = !data.signedIn;
  signIn.hidden = Boolean(data.signedIn);
  accountVersion = data.version;
  maybeSaveReplay();
  if (restore && isWeights(data.weights)) {
    weights = data.weights;
    try { localStorage.setItem(storageKey, JSON.stringify(weights)); } catch {}
    accountStatus.textContent = "Training loaded. It will apply to your next match.";
  } else if (data.signedIn) {
    accountStatus.textContent = isWeights(data.weights)
      ? "Load saved training or save this device’s current bot."
      : "Save your training to use this bot on another device.";
  } else {
    accountStatus.textContent = new URLSearchParams(location.search).get("signin") === "failed"
      ? "Google sign-in did not complete. Try again." : "";
  }
}

function accountAction(action: () => Promise<void>) {
  return async (event: MouseEvent) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try { await action(); }
    catch (error) { accountStatus.textContent = error instanceof Error ? error.message : "Account request failed."; }
    finally { button.disabled = false; }
  };
}
element("save-account").onclick = accountAction(async () => {
  const data = await accountRequest("PUT", "/api/account", { weights, version: accountVersion });
  accountVersion = data.version;
  accountStatus.textContent = "Training saved to your account.";
});
element("load-account").onclick = accountAction(async () => loadAccount(true));
element("sign-out").onclick = accountAction(async () => {
  await accountRequest("POST", "/api/account/logout");
  await loadAccount(false);
});
void loadAccount(false).catch(() => {});
gameSelect.onchange = () => {
  if (!online && !requestPending) element<HTMLFormElement>("match").requestSubmit();
};
render();
