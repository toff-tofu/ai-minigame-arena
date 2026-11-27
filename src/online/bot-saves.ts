import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import pg from "pg";
import { isWeights, type Weights } from "../ai/coaching.ts";

const recoveryCodePattern = /^[a-f0-9]{48}$/;

function digest(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 512) return;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return;
  }
}

export async function connectBotSaves(connectionString: string) {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5_000, max: 5 });
  pool.on("error", (error) => console.error("PostgreSQL connection error", error.code));
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_saves (
        code_hash text PRIMARY KEY,
        height_weight double precision NOT NULL CHECK (height_weight BETWEEN -16 AND 16),
        support_weight double precision NOT NULL CHECK (support_weight BETWEEN -16 AND 16)
      )
    `);
  } catch (error) {
    await pool.end();
    throw error;
  }

  return {
    async save(weights: Weights): Promise<string> {
      const code = randomBytes(24).toString("hex");
      await pool.query(
        "INSERT INTO bot_saves (code_hash, height_weight, support_weight) VALUES ($1, $2, $3)",
        [digest(code), ...weights],
      );
      return code;
    },
    async load(code: string): Promise<Weights | undefined> {
      const { rows } = await pool.query(
        "SELECT height_weight, support_weight FROM bot_saves WHERE code_hash = $1",
        [digest(code)],
      );
      const row = rows[0];
      return row && [row.height_weight, row.support_weight];
    },
    close: () => pool.end(),
  };
}

type BotSaves = Awaited<ReturnType<typeof connectBotSaves>>;

export async function handleBotSave(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  saves?: BotSaves,
) {
  if (path !== "/api/bot-saves" && path !== "/api/bot-saves/load") {
    return send(response, 404, { error: "Unknown bot save endpoint." });
  }
  if (request.method !== "POST") {
    return send(response, 405, { error: "Use POST for bot saves." });
  }
  if (!saves) return send(response, 503, { error: "Cross-device saves need a connected database." });
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
    return send(response, 415, { error: "Use a JSON request." });
  }

  const body = await readBody(request);
  if (path === "/api/bot-saves/load") {
    if (typeof body !== "string" || !recoveryCodePattern.test(body)) {
      return send(response, 400, { error: "Enter a valid recovery code." });
    }
    const weights = await saves.load(body);
    if (!weights) return send(response, 404, { error: "Recovery code not found." });
    return send(response, 200, { weights });
  }

  if (!isWeights(body)) return send(response, 400, { error: "Invalid bot weights." });
  const code = await saves.save(body);
  send(response, 201, { code });
}
