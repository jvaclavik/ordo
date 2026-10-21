// @ts-check
// Google Calendar sign-in for Ordo. One Vercel function serves four paths:
//   GET  /api/gcal/login     redirect to Google consent
//   GET  /api/gcal/callback  exchange the code, store the refresh token
//   POST /api/gcal/token     hand the browser a short-lived access token
//   POST /api/gcal/logout    revoke and forget the refresh token
// The refresh token never reaches page scripts. It lives AES-GCM sealed in an
// httpOnly cookie scoped to /api/gcal, so the function itself stays stateless.
// Plain JavaScript on purpose: Vercel deploys it without a TypeScript step.

// Read every calendar, but write only to calendars this app created.
const READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const FULL_SCOPE = "https://www.googleapis.com/auth/calendar";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SESSION_COOKIE = "ordo_gcal";
const FLOW_COOKIE = "ordo_gcal_flow";
const SESSION_PATH = "/api/gcal";
const CALLBACK_PATH = "/api/gcal/callback";
const SESSION_AGE = 400 * 24 * 60 * 60;
const FLOW_AGE = 10 * 60;

/** @typedef {{ clientId: string, clientSecret: string, secret: string }} Config */
/** @typedef {{ refreshToken: string, since: string }} Session */
/** @typedef {{ access_token?: string, expires_in?: number, refresh_token?: string, scope?: string, error?: string }} TokenReply */

/** @returns {Config | null} */
function readConfig() {
  const env = process.env;
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const secret =
    env.GCAL_COOKIE_SECRET?.trim() || `client-secret:${clientSecret}`;
  return { clientId, clientSecret, secret };
}

/** @param {Request} request */
export async function GET(request) {
  const op = operation(request);
  if (op === "login") return login(request);
  if (op === "callback") return callback(request);
  return reply({ error: "not_found" }, 404);
}

/** @param {Request} request */
export async function POST(request) {
  if (!sameOrigin(request)) return reply({ error: "forbidden" }, 403);
  const op = operation(request);
  if (op === "token") return token(request);
  if (op === "logout") return logout(request);
  return reply({ error: "not_found" }, 404);
}

/** @param {Request} request */
function operation(request) {
  const url = new URL(request.url);
  const named = url.searchParams.get("op");
  if (named) return named;
  return url.pathname.split("/").filter(Boolean).at(-1) ?? "";
}

/** @param {Request} request */
function publicOrigin(request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** @param {Request} request */
function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === publicOrigin(request);
}

/** @param {Request} request */
function isSecure(request) {
  return publicOrigin(request).startsWith("https:");
}

/** @param {Request} request */
async function login(request) {
  const origin = publicOrigin(request);
  const config = readConfig();
  if (!config) return redirect(`${origin}/?gcal=unconfigured`);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    )
  );
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    response_type: "code",
    scope: `${READ_SCOPE} ${WRITE_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return redirect(
    `${AUTH_URL}?${params}`,
    cookie(FLOW_COOKIE, `${state}.${verifier}`, {
      path: CALLBACK_PATH,
      maxAge: FLOW_AGE,
      secure: isSecure(request),
    })
  );
}

/** @param {Request} request */
async function callback(request) {
  const url = new URL(request.url);
  const origin = publicOrigin(request);
  /** @param {string} result @param {string | null} [setCookie] */
  const back = (result, setCookie = null) =>
    redirect(`${origin}/?gcal=${result}`, setCookie);
  const config = readConfig();
  if (!config) return back("unconfigured");
  if (url.searchParams.get("error")) return back("denied");
  const [state, verifier] = (readCookie(request, FLOW_COOKIE) ?? "").split(".");
  const code = url.searchParams.get("code");
  if (!state || !verifier || !code || state !== url.searchParams.get("state"))
    return back("error");
  /** @type {TokenReply | null} */
  let data = null;
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: `${origin}${CALLBACK_PATH}`,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    if (!response.ok) return back("error");
    data = /** @type {TokenReply} */ (await response.json());
  } catch {
    return back("error");
  }
  const granted = (data.scope ?? "").split(" ");
  const full = granted.includes(FULL_SCOPE);
  if (!full && !(granted.includes(READ_SCOPE) && granted.includes(WRITE_SCOPE)))
    return back("scope");
  if (!data.refresh_token) return back("error");
  const sealed = await seal(config.secret, {
    refreshToken: data.refresh_token,
    since: new Date().toISOString(),
  });
  return back(
    "connected",
    cookie(SESSION_COOKIE, sealed, {
      path: SESSION_PATH,
      maxAge: SESSION_AGE,
      secure: isSecure(request),
    })
  );
}

/** @param {Request} request */
async function token(request) {
  const config = readConfig();
  if (!config) return reply({ error: "unconfigured" }, 501);
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw) return reply({ error: "disconnected" }, 401);
  const session = await unseal(config.secret, raw);
  const forget = cookie(SESSION_COOKIE, "", {
    path: SESSION_PATH,
    maxAge: 0,
    secure: isSecure(request),
  });
  if (!session) return reply({ error: "disconnected" }, 401, forget);
  /** @type {Response} */
  let response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: session.refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    return reply({ error: "upstream" }, 502);
  }
  /** @type {TokenReply | null} */
  const data = await response.json().catch(() => null);
  if (data?.error === "invalid_grant")
    return reply({ error: "disconnected" }, 401, forget);
  if (data?.error === "invalid_client" || data?.error === "unauthorized_client")
    return reply({ error: "unconfigured" }, 501);
  if (!response.ok || !data?.access_token)
    return reply({ error: "upstream" }, 502);
  const sealed = data.refresh_token
    ? await seal(config.secret, {
        refreshToken: data.refresh_token,
        since: session.since,
      })
    : raw;
  return reply(
    { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 },
    200,
    cookie(SESSION_COOKIE, sealed, {
      path: SESSION_PATH,
      maxAge: SESSION_AGE,
      secure: isSecure(request),
    })
  );
}

/** @param {Request} request */
async function logout(request) {
  const config = readConfig();
  const raw = readCookie(request, SESSION_COOKIE);
  const session = config && raw ? await unseal(config.secret, raw) : null;
  if (session) {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: session.refreshToken }),
    }).catch(() => undefined);
  }
  return reply(
    { ok: true },
    200,
    cookie(SESSION_COOKIE, "", {
      path: SESSION_PATH,
      maxAge: 0,
      secure: isSecure(request),
    })
  );
}

/**
 * @param {unknown} body
 * @param {number} status
 * @param {string | null} [setCookie]
 */
function reply(body, status, setCookie = null) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

/** @param {string} location @param {string | null} [setCookie] */
function redirect(location, setCookie = null) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(null, { status: 302, headers });
}

/**
 * @param {string} name
 * @param {string} value
 * @param {{ path: string, maxAge: number, secure: boolean }} options
 */
function cookie(name, value, options) {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/** @param {Request} request @param {string} name */
function readCookie(request, name) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const split = part.indexOf("=");
    if (split < 0) continue;
    if (part.slice(0, split).trim() !== name) continue;
    return part.slice(split + 1).trim() || null;
  }
  return null;
}

/** @param {number} size */
function randomToken(size) {
  return base64url(crypto.getRandomValues(new Uint8Array(size)));
}

/** @param {Uint8Array} bytes */
function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** @param {string} text */
function fromBase64url(text) {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** @param {string} secret */
async function sealKey(secret) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`ordo-gcal-cookie:${secret}`)
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** @param {string} secret @param {Session} session */
async function seal(secret, session) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await sealKey(secret),
      new TextEncoder().encode(JSON.stringify(session))
    )
  );
  const joined = new Uint8Array(iv.length + data.length);
  joined.set(iv);
  joined.set(data, iv.length);
  return base64url(joined);
}

/**
 * @param {string} secret
 * @param {string} value
 * @returns {Promise<Session | null>}
 */
async function unseal(secret, value) {
  try {
    const bytes = fromBase64url(value);
    if (bytes.length < 13) return null;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      await sealKey(secret),
      bytes.slice(12)
    );
    /** @type {unknown} */
    const parsed = JSON.parse(new TextDecoder().decode(plain));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("refreshToken" in parsed) ||
      typeof parsed.refreshToken !== "string"
    )
      return null;
    const since =
      "since" in parsed && typeof parsed.since === "string" ? parsed.since : "";
    return { refreshToken: parsed.refreshToken, since };
  } catch {
    return null;
  }
}
