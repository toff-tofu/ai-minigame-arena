import { strategies, type Strategy } from "./ai/baselines.ts";
import { runBotMatch } from "./matches/bot-match.ts";

function isStrategy(value: string): value is Strategy {
  return strategies.some((strategy) => strategy === value);
}

const [seedArg = "42", countArg = "1", first = "height", second = "stability", ...extra] = process.argv.slice(2);
const seed = Number(seedArg);
const count = Number(countArg);
if (!/^\d+$/.test(seedArg) || seed > 0xffffffff || !/^\d+$/.test(countArg) ||
    !Number.isSafeInteger(count) || count < 1 || count > 0x100000000 - seed ||
    !isStrategy(first) || !isStrategy(second) || extra.length) {
  console.error("Usage: npm run bots -- [seed] [match count] [height|stability] [height|stability]");
  console.error("Use a positive match count and seeds from 0 through 4294967295.");
  process.exitCode = 1;
} else {
  const bots = [first, second] as const;
  const stats = bots.map((strategy) => ({ strategy, wins: 0, busts: 0, totalScore: 0 }));
  let draws = 0;
  let totalMoves = 0;
  for (let offset = 0; offset < count; offset++) {
    const match = runBotMatch(seed + offset, bots);
    const { players, outcome } = match.duel;
    totalMoves += match.moves.length;
    if (outcome === "draw") draws++;
    else if (outcome !== "playing") stats[outcome].wins++;
    for (const [index, player] of players.entries()) {
      stats[index].totalScore += player.score;
      if (player.bust) stats[index].busts++;
    }
    if (count === 1) {
      console.log("Moves (player, column, rotation)");
      for (const move of match.moves) {
        console.log(move.player + 1, move.column + 1, move.turns * 90);
      }
      for (const [index, player] of players.entries()) {
        if (player.bust) console.log(`Player ${index + 1} busts. ${player.bust}`);
      }
      console.log(outcome === "draw" ? "Draw." : `Player ${Number(outcome) + 1} wins.`);
    }
  }
  console.log(`Matches: ${count} | First seed: ${seed} | Draws: ${draws} | Avg. moves: ${(totalMoves / count).toFixed(2)}`);
  for (const [index, { strategy, wins, busts, totalScore }] of stats.entries()) {
    console.log(`Player ${index + 1} (${strategy}) | Wins: ${wins} | Busts: ${busts} | Avg. height: ${(totalScore / count).toFixed(2)}`);
  }
}
