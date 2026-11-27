export const WIDTH = 9;
export const HEIGHT = 16;
export const TURNS = 12;

type Cell = readonly [x: number, y: number];
export type Piece = (typeof pieces)[number];
export type Board = ReadonlySet<number>;

const pieces = ["Pair", "Corner", "Step"] as const;
const shapes: Record<Piece, readonly Cell[]> = {
  Pair: [[0, 0], [1, 0]],
  Corner: [[0, 0], [0, 1], [1, 1]],
  Step: [[0, 0], [1, 0], [2, 0], [2, 1]],
};
const neighbors: readonly Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function pieceSequence(seed: number): Piece[] {
  let state = seed >>> 0;
  return Array.from({ length: TURNS }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return pieces[Math.floor(state / 2 ** 32 * pieces.length)];
  });
}

export function orientation(piece: Piece, turns: number): Cell[] {
  let cells = [...shapes[piece]];
  for (let turn = 0; turn < turns; turn++) {
    cells = cells.map(([x, y]) => [-y, x]);
  }
  const minX = Math.min(...cells.map(([x]) => x));
  const minY = Math.min(...cells.map(([, y]) => y));
  return cells.map(([x, y]) => [x - minX, y - minY]);
}

export function height(board: Board): number {
  return Math.max(0, ...Array.from(board, (cell) => Math.floor(cell / WIDTH) + 1));
}

export function supportMargin(board: Board): number {
  let margin = Infinity;
  const top = height(board);
  for (let cut = 0; cut < top; cut++) {
    const unvisited = new Set([...board].filter((cell) => cell >= cut * WIDTH));
    for (const first of unvisited) {
      const component = [first];
      unvisited.delete(first);
      let centerSum = 0;
      let left = Infinity;
      let right = -Infinity;
      for (const cell of component) {
        const x = cell % WIDTH;
        const y = Math.floor(cell / WIDTH);
        centerSum += 2 * x + 1;
        if (y === cut && (cut === 0 || board.has(cell - WIDTH))) {
          left = Math.min(left, 2 * x);
          right = Math.max(right, 2 * x + 2);
        }
        for (const [dx, dy] of neighbors) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < WIDTH && ny >= cut && unvisited.delete(ny * WIDTH + nx)) {
            component.push(ny * WIDTH + nx);
          }
        }
      }
      const mass = component.length;
      const edgeDistance = Math.min(centerSum - left * mass, right * mass - centerSum);
      margin = Math.min(margin, edgeDistance / (2 * mass));
    }
  }
  return margin;
}

export function isStable(board: Board): boolean {
  return supportMargin(board) >= 0;
}

type Drop =
  | { kind: "invalid"; reason: string }
  | { kind: "bust"; reason: string }
  | { kind: "placed"; board: Board; margin: number };

export function landingRow(board: Board, cells: readonly Cell[], column: number): number {
  let bottom = HEIGHT;
  while (cells.every(([x, y]) => y + bottom > 0 && !board.has((y + bottom - 1) * WIDTH + x + column))) {
    bottom--;
  }
  return bottom;
}

export function drop(board: Board, piece: Piece, column: number, turns: number): Drop {
  if (!Number.isInteger(turns) || turns < 0 || turns > 3) {
    return { kind: "invalid", reason: "Orientation must be 0, 90, 180, or 270 degrees." };
  }
  const cells = orientation(piece, turns);
  if (!Number.isInteger(column) || column < 0 || cells.some(([x]) => x + column >= WIDTH)) {
    return { kind: "invalid", reason: "The piece must fit within the board's columns." };
  }

  const bottom = landingRow(board, cells, column);
  if (cells.some(([, y]) => y + bottom >= HEIGHT)) {
    return { kind: "bust", reason: "The piece landed above the top of the board." };
  }

  // Only count cells on the piece's underside, including raised feet.
  const feet = cells.filter(([x, y]) => !cells.some(([cx, cy]) => cx === x && cy === y - 1));
  const supported = feet.filter(([x, y]) => bottom + y === 0 ||
    board.has((bottom + y - 1) * WIDTH + column + x));
  if (supported.length * 2 < feet.length) {
    return { kind: "bust", reason: "Fewer than half of the piece's underside cells were supported." };
  }

  const next = new Set(board);
  for (const [x, y] of cells) {
    next.add((bottom + y) * WIDTH + column + x);
  }
  const margin = supportMargin(next);
  if (margin < 0) {
    return { kind: "bust", reason: "The tower's weight shifted beyond its support." };
  }
  return { kind: "placed", board: next, margin };
}
