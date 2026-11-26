import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { playTurn, startDuel, type Duel } from "./game/duel.ts";
import { HEIGHT, orientation, WIDTH } from "./game/stacking.ts";

function render(duel: Duel): void {
  console.log(duel.players.map(({ score, bust }, index) =>
    `Player ${index + 1} (${score})${bust ? " [bust]" : ""}`).join("   "));
  for (let y = HEIGHT - 1; y >= 0; y--) {
    console.log(duel.players.map(({ board }) => {
      const row = Array.from({ length: WIDTH }, (_, x) => board.has(y * WIDTH + x) ? "#" : ".");
      return `|${row.join("")}|`;
    }).join("   "));
  }
  console.log(" 123456789     123456789");
  for (const [index, player] of duel.players.entries()) {
    if (player.bust) console.log(`Player ${index + 1} busts. ${player.bust}`);
  }
}

function showPiece(duel: Duel): void {
  const piece = duel.pieces[duel.players[duel.active].turns];
  console.log(`Player ${duel.active + 1} to move. Next piece is ${piece}.`);
  const rotations = [0, 1, 2, 3].map((turn) => orientation(piece, turn));
  const rows = Math.max(...rotations.flatMap((cells) => cells.map(([, y]) => y))) + 1;
  console.log("  0°    90°   180°  270°");
  for (let y = rows - 1; y >= 0; y--) {
    console.log(rotations.map((cells) => Array.from({ length: 6 }, (_, x) =>
      cells.some(([cx, cy]) => x === cx && y === cy) ? "#" : " ").join("")).join(""));
  }
}

const seedArg = process.argv[2];
const seed = seedArg === undefined ? Math.floor(Math.random() * 2 ** 32) : Number(seedArg);
if (!/^\d+$/.test(seedArg ?? String(seed)) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
  console.error("Provide a seed from 0 through 4294967295.");
  process.exitCode = 1;
} else {
  let duel = startDuel(seed);
  const input = createInterface({ input: stdin, output: stdout });
  input.setPrompt("Column and rotation (e.g. 3 90), or q to quit> ");
  console.log(`Block-stacking duel. Seed ${seed}.`);
  render(duel);
  showPiece(duel);
  if (stdin.isTTY) input.prompt();

  for await (const line of input) {
    const command = line.trim();
    if (command.toLowerCase() === "q") break;
    const match = /^(\d+)\s+(0|90|180|270)$/.exec(command);
    if (!match) {
      console.log("Enter a column from 1 to 9 and a rotation of 0, 90, 180, or 270.");
    } else {
      const result = playTurn(duel, Number(match[1]) - 1, Number(match[2]) / 90);
      if (result.error) {
        console.log(result.error);
      } else {
        duel = result.duel;
        render(duel);
        if (duel.outcome !== "playing") {
          console.log(duel.outcome === "draw" ? "Draw." : `Player ${duel.outcome + 1} wins.`);
          break;
        }
        showPiece(duel);
      }
    }
    if (stdin.isTTY) input.prompt();
  }
  input.close();
}
