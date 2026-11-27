export type Seat = 0 | 1;
export type Outcome = "playing" | "draw" | Seat;
export type Position = { cells: readonly number[]; active: Seat; outcome: Outcome };
type Rules = {
  title: string;
  instructions: string;
  columns: number;
  start(seed: number): Position;
  legal(position: Position): number[];
  apply(position: Position, move: number): Position;
  label(value: number): string;
  preview?(move: number): { cell: number; label: string };
  potential(position: Position, player: Seat): number;
};

const other = (player: Seat): Seat => player === 0 ? 1 : 0;
const empty = (length: number): Position => ({ cells: Array<number>(length).fill(0), active: 0, outcome: "playing" });

function lineGame(title: string, size: number, length: number, gravity: boolean): Rules {
  const lines: number[][] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
        const endX = x + dx * (length - 1), endY = y + dy * (length - 1);
        if (endX >= 0 && endX < size && endY < size) {
          lines.push(Array.from({ length }, (_, i) => (y + dy * i) * size + x + dx * i));
        }
      }
    }
  }
  function legal({ cells, outcome }: Position) {
    if (outcome !== "playing") return [];
    return cells.flatMap((cell, i) => cell === 0 && (!gravity || i >= size * (size - 1) || cells[i + size] !== 0) ? [i] : []);
  }
  return {
    title, instructions: `Make a line of ${length}.`, columns: size, start: () => empty(size * size), legal,
    apply(position, move) {
      const cells = [...position.cells];
      cells[move] = position.active + 1;
      const outcome = lines.some((line) => line.every((i) => cells[i] === position.active + 1))
        ? position.active : cells.includes(0) ? "playing" : "draw";
      return { cells, active: other(position.active), outcome };
    },
    label: (cell) => ["·", "X", "O"][cell],
    potential({ cells }, player) {
      return lines.reduce((sum, line) => {
        if (line.some((i) => cells[i] === other(player) + 1)) return sum;
        const marks = line.filter((i) => cells[i] === player + 1).length;
        return sum + marks ** 2;
      }, 0) / (lines.length * length ** 2);
    },
  };
}

function pileGame(title: string, piles: (seed: number) => number[], max: number): Rules {
  return {
    title, instructions: `Take 1–${max} from a pile. Take the last counter to win.`, columns: 3,
    start: (seed) => ({ ...empty(0), cells: piles(seed) }),
    legal: ({ cells, outcome }) => outcome === "playing" ? cells.flatMap((pile, index) =>
      Array.from({ length: Math.min(pile, max) }, (_, i) => index * max + i)) : [],
    apply(position, move) {
      const cells = [...position.cells];
      cells[Math.floor(move / max)] -= move % max + 1;
      return { cells, active: other(position.active),
        outcome: cells.every((pile) => pile === 0) ? position.active : "playing" };
    },
    label: String,
    preview: (move) => ({ cell: Math.floor(move / max),
      label: `Testing taking ${move % max + 1} from pile ${Math.floor(move / max) + 1}` }),
    potential: ({ cells, active }, player) =>
      cells.reduce((sum, pile) => sum ^ (pile % (max + 1)), 0) === 0
        ? Number(player !== active) * 0.4 : Number(player === active) * 0.4,
  };
}

function claimGame(): Rules {
  function score(cells: readonly number[], player: Seat) {
    return cells.reduce((sum, cell) => cell % 3 === player + 1 ? sum + Math.floor(cell / 3) : sum, 0);
  }
  return {
    title: "Number Draft", instructions: "Pick one tile each turn. The largest total wins.", columns: 4,
    start(seed) {
      let value = seed >>> 0;
      return { ...empty(0), cells: Array.from({ length: 12 }, () => {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
        return (1 + (value >>> 24) % 9) * 3;
      }) };
    },
    legal: ({ cells, outcome }) => outcome === "playing"
      ? cells.flatMap((cell, i) => cell % 3 === 0 ? [i] : []) : [],
    apply(position, move) {
      const cells = [...position.cells];
      cells[move] += position.active + 1;
      const difference = score(cells, 0) - score(cells, 1);
      return { cells, active: other(position.active), outcome: cells.some((cell) => cell % 3 === 0)
        ? "playing" : difference === 0 ? "draw" : difference > 0 ? 0 : 1 };
    },
    label: (cell) => `${Math.floor(cell / 3)}${["", " · X", " · O"][cell % 3]}`,
    potential: ({ cells }, player) => score(cells, player) / 108,
  };
}

export const games = {
  tictactoe: lineGame("Tic-tac-toe", 3, 3, false),
  four: lineGame("Four in a Row", 6, 4, true),
  takeaway: pileGame("Takeaway", (seed) => [13 + seed % 6], 3),
  heaps: pileGame("Three Heaps", (seed) => [3, 4 + seed % 4, 7], 7),
  draft: claimGame(),
} satisfies Record<string, Rules>;
export type GameId = keyof typeof games;
export function isGameId(value: unknown): value is GameId {
  return typeof value === "string" && Object.hasOwn(games, value);
}
