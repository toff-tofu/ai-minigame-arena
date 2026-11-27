import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import pg from "pg";
import { isWeights } from "../ai/coaching.ts";

const token = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
const secretPattern = /^[\w-]{43}$/;
const lifetime = 30 * 24 * 60 * 60;

function cookie(request: IncomingMessage, name: string) {
  return request.headers.cookie?.split("; ").find((part) => part.startsWith(name + "="))?.slice(name.length + 1);
}

function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

export async function connectAccounts() {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, APP_ORIGIN,
    DATABASE_URL: database } = process.env;
  if (!clientId || !clientSecret || !APP_ORIGIN || !database) return;
  const origin = new URL(APP_ORIGIN);
  if (origin.protocol !== "https:" && !(origin.protocol === "http:" && origin.hostname === "127.0.0.1")) {
    throw Error("APP_ORIGIN must use HTTPS, except on 127.0.0.1.");
  }
  const secure = origin.protocol === "https:" ? "; Secure" : "";
  const callback = new URL("/auth/google/callback", origin).href;
  const pool = new pg.Pool({ connectionString: database, connectionTimeoutMillis: 5000, max: 4 });
  pool.on("error", (error) => console.error("Account database connection error", error.code));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS arena_accounts (
      google_sub text PRIMARY KEY,
      weights jsonb,
      version integer NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS arena_sessions (
      digest text PRIMARY KEY,
      google_sub text NOT NULL REFERENCES arena_accounts(google_sub),
      expires_at timestamptz NOT NULL
    );
  `);
  function setCookie(name: string, value: string, maxAge: number) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }
  function redirect(response: ServerResponse, location: string, cookies: string[] = []) {
    response.writeHead(303, { Location: location, "Set-Cookie": cookies, "Cache-Control":"no-store" });
    response.end();
  }
  async function account(request: IncomingMessage) {
    const session = cookie(request, "arena_session");
    if (!session || !secretPattern.test(session)) return;
    const { rows } = await pool.query(
      `SELECT a.google_sub, a.weights, a.version FROM arena_accounts a JOIN arena_sessions s
      ON a.google_sub = s.google_sub WHERE s.digest = $1 AND s.expires_at > now()`, [hash(session)],
    );
    return rows[0];
  }

  return async (request: IncomingMessage, response: ServerResponse, path: string) => {
    if (path === "/auth/google" && request.method === "GET") {
      const state = token();
      const verifier = token();
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: clientId, redirect_uri: callback, response_type: "code", scope: "openid",
        state, code_challenge: hash(verifier), code_challenge_method: "S256",
      }).toString();
      return redirect(response, url.href, [setCookie("arena_oauth", state + "." + verifier, 600)]);
    }
    if (path === "/auth/google/callback" && request.method === "GET") {
      const url = new URL(request.url!, origin);
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const [expected, verifier] = (cookie(request, "arena_oauth") ?? "").split(".");
      const expired = setCookie("arena_oauth", "", 0);
      if (!state || !code || !secretPattern.test(state) || !secretPattern.test(expected) ||
          !verifier || !secretPattern.test(verifier) ||
          !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
        return redirect(response, "/?signin=failed", [expired]);
      }
      const exchange = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", signal: AbortSignal.timeout(8000), body: new URLSearchParams({
          code, client_id: clientId, client_secret: clientSecret, redirect_uri: callback,
          grant_type: "authorization_code", code_verifier: verifier,
        }),
      });
      if (!exchange.ok) return redirect(response, "/?signin=failed", [expired]);
      const { access_token: accessToken } = await exchange.json();
      const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000),
      });
      if (!info.ok) return redirect(response, "/?signin=failed", [expired]);
      const { sub } = await info.json();
      if (typeof sub !== "string" || !sub) return redirect(response, "/?signin=failed", [expired]);
      const session = token();
      const previous = cookie(request, "arena_session");
      if (previous && secretPattern.test(previous)) {
        await pool.query("DELETE FROM arena_sessions WHERE digest = $1", [hash(previous)]);
      }
      await pool.query("DELETE FROM arena_sessions WHERE expires_at <= now()");
      await pool.query("INSERT INTO arena_accounts (google_sub) VALUES ($1) ON CONFLICT DO NOTHING", [sub]);
      await pool.query("INSERT INTO arena_sessions VALUES ($1, $2, now() + interval '30 days')", [hash(session), sub]);
      return redirect(response, "/", [expired, setCookie("arena_session", session, lifetime)]);
    }

    if (path === "/api/account" && request.method === "GET") {
      const row = await account(request);
      return json(response, 200, { enabled: true, signedIn: Boolean(row), weights: row?.weights, version: row?.version });
    }
    if (path === "/api/account/logout" && request.method === "POST" && request.headers.origin === origin.origin) {
      const session = cookie(request, "arena_session");
      if (session && secretPattern.test(session)) {
        await pool.query("DELETE FROM arena_sessions WHERE digest = $1", [hash(session)]);
      }
      response.setHeader("Set-Cookie", setCookie("arena_session", "", 0));
      return json(response, 200, { signedIn: false });
    }
    if (path === "/api/account" && request.method === "PUT" && request.headers.origin === origin.origin) {
      const row = await account(request);
      if (!row) return json(response, 401, { error: "Sign in first." });
      let raw = "";
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        raw += chunk.toString();
        if (raw.length > 256) return json(response, 400, { error: "Invalid training save." });
      }
      let body;
      try { body = JSON.parse(raw); } catch { return json(response, 400, { error: "Invalid training save." }); }
      if (!body || !isWeights(body.weights) || !Number.isInteger(body.version) || body.version < 0) {
        return json(response, 400, { error: "Invalid training save." });
      }
      const result = await pool.query(`UPDATE arena_accounts SET weights = $1, version = version + 1
        WHERE google_sub = $2 AND version = $3 RETURNING version`, [JSON.stringify(body.weights), row.google_sub, body.version]);
      if (!result.rowCount) return json(response, 409, { error: "Another device saved first. Load the account bot to continue." });
      return json(response, 200, { version: result.rows[0].version });
    }
    return json(response, 404, { error: "Unknown account action." });
  };
}
