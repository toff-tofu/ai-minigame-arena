import { chooseMove } from "../ai/baselines.ts";
import type { Weights } from "../ai/coaching.ts";
import { searchGame } from "../ai/game-policy.ts";
import { games, type GameId, type Outcome, type Position, type Seat } from "./catalog.ts";
import { playTurn, type Duel } from "./duel.ts";

export type LessonPosition = { game: "stacking"; state: Duel } | { game: GameId; state: Position };
type Trial = { moves: string[]; outcome: Outcome; scores?: [number, number] };
const turns = 6;

export function tryLesson(position: LessonPosition, seat: Seat, weights: Weights): Trial {
  const moves: string[] = [];
  const actor = (player: Seat) => player === seat ? "Your bot" : "Practice bot";
  if (position.game === "stacking") {
    let duel = position.state;
    for (let i = 0; i < turns && duel.outcome === "playing"; i++) {
      const player = duel.active;
      const current = duel.players[player];
      const move = chooseMove(current.board, duel.pieces[current.turns], player === seat ? weights : "stability");
      const { duel: next, error } = playTurn(duel, move.column, move.turns);
      if (error) throw Error(error);
      const bust = next.players[player].bust;
      moves.push(`${actor(player)} · Column ${move.column + 1}, ${move.turns * 90}°${bust ? " · Bust" : ""}`);
      duel = next;
    }
    return { moves, outcome: duel.outcome, scores: [duel.players[seat].score, duel.players[seat === 0 ? 1 : 0].score] };
  }

  const { game } = position;
  const rules = games[game];
  let state = position.state;
  for (let i = 0; i < turns && state.outcome === "playing"; i++) {
    const player = state.active;
    const search = searchGame(game, state, player === seat ? weights : [2, 7]);
    let step = search.next();
    while (!step.done) step = search.next();
    const move = step.value;
    moves.push(`${actor(player)} · ${rules.preview?.(move).label.replace(/^Testing taking /, "Take ") ?? `Tile ${move + 1}`}`);
    state = rules.apply(state, move);
  }
  return { moves, outcome: state.outcome };
}
