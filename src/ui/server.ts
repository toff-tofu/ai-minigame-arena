import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const routes = new Map([
  ["/", ["./index.html", "text/html"]],
  ["/ui/style.css", ["./style.css", "text/css"]],
  ["/ui/viewer.ts", ["./viewer.ts", "text/javascript"]],
  ["/game/duel.ts", ["../game/duel.ts", "text/javascript"]],
  ["/game/stacking.ts", ["../game/stacking.ts", "text/javascript"]],
  ["/ai/baselines.ts", ["../ai/baselines.ts", "text/javascript"]],
]);

const server = createServer(async (request, response) => {
  const path = request.url?.split("?")[0] ?? "";
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

server.listen(4173, "127.0.0.1", () => console.log("Open http://127.0.0.1:4173"));
