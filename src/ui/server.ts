import { connectAccounts } from "../online/accounts.ts";
import { connectBotSaves, handleBotSave } from "../online/bot-saves.ts";
import { createRooms } from "../online/rooms.ts";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const routes = new Map([
  ["/", ["./index.html", "text/html"]],
  ["/ui/style.css", ["./style.css", "text/css"]],
  ["/ui/viewer.ts", ["./viewer.ts", "text/javascript"]],
  ["/game/lesson-trial.ts", ["../game/lesson-trial.ts", "text/javascript"]],
  ["/game/catalog.ts", ["../game/catalog.ts", "text/javascript"]],
  ["/ai/game-policy.ts", ["../ai/game-policy.ts", "text/javascript"]],
  ["/game/duel.ts", ["../game/duel.ts", "text/javascript"]],
  ["/game/stacking.ts", ["../game/stacking.ts", "text/javascript"]],
  ["/ai/coaching.ts", ["../ai/coaching.ts", "text/javascript"]],
  ["/ai/baselines.ts", ["../ai/baselines.ts", "text/javascript"]],
]);

const saves = process.env.DATABASE_URL ? await connectBotSaves(process.env.DATABASE_URL) : undefined;
const accounts = await connectAccounts();
const rooms = createRooms(undefined, accounts?.saveReplay);
const server = createServer(async (request, response) => {
  const path = request.url?.split("?")[0] ?? "";
  if (path.startsWith("/api/") || path.startsWith("/auth/")) {
    try {
      if (path.startsWith("/api/account") || path.startsWith("/auth/")) {
        if (accounts) await accounts.handle(request, response, path);
        else {
          response.writeHead(path === "/api/account" && request.method === "GET" ? 200 : 503,
            { "Content-Type": "application/json", "Cache-Control": "no-store" });
          response.end(JSON.stringify({ enabled: false, error: "Google sign-in is not configured." }));
        }
      } else if (path.startsWith("/api/bot-saves")) {
        await handleBotSave(request, response, path, saves);
      } else {
        const owner = request.method === "POST" ? await accounts?.owner(request) : undefined;
        await rooms.handle(request, response, path, owner);
      }
    } catch (error) {
      console.error(error);
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ error: "Server request failed. Try again." }));
      } else {
        response.end();
      }
    }
    return;
  }
  const route = routes.get(path);
  if (request.method !== "GET" || !route) {
    response.writeHead(404).end();
    return;
  }
  try {
    const source = await readFile(new URL(route[0], import.meta.url), "utf8");
    const body = path.endsWith(".ts") ? stripTypeScriptTypes(source) : source;
    response.writeHead(200, { "Content-Type": `${route[1]}; charset=utf-8` });
    response.end(body);
  } catch (error) {
    console.error(error);
    response.writeHead(500).end();
  }
});

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
server.listen(port, host, () => {
  const address = server.address();
  if (address && typeof address !== "string") console.log(`Arena listening on http://${host}:${address.port}`);
});
