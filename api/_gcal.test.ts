import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./gcal/[op].js";

const ORIGIN = "https://ordo.example";

function cookieValue(response: Response, name: string): string | null {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|, )${name}=([^;]*)`));
  return match ? match[1] ?? "" : null;
}

function tokenReply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BOTH_SCOPES =
  "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.app.created";

async function connect(scope = BOTH_SCOPES) {
  const started = await GET(new Request(`${ORIGIN}/api/gcal/login`));
  const location = new URL(started.headers.get("location") ?? "");
  const flow = cookieValue(started, "ordo_gcal_flow") ?? "";
  const fetchMock = vi.fn(async () =>
    tokenReply({ access_token: "a1", refresh_token: "r1", expires_in: 3599, scope })
  );
  vi.stubGlobal("fetch", fetchMock);
  const done = await GET(
    new Request(
      `${ORIGIN}/api/gcal/callback?code=c1&state=${location.searchParams.get("state")}`,
      { headers: { cookie: `ordo_gcal_flow=${flow}` } }
    )
  );
  return { started, location, done, fetchMock };
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-1");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret-1");
  vi.stubEnv("GCAL_COOKIE_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Google Calendar sign-in function", () => {
  it("asks Google for reading all calendars and writing only its own", async () => {
    const { started, location } = await connect();
    expect(started.status).toBe(302);
    expect(location.origin + location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/gcal/callback`
    );
    expect(location.searchParams.get("scope")).toBe(BOTH_SCOPES);
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    const header = started.headers.get("set-cookie") ?? "";
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("Path=/api/gcal/callback");
  });

  it("stores a sealed refresh token and returns to the app after consent", async () => {
    const { done, fetchMock } = await connect();
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe(`${ORIGIN}/?gcal=connected`);
    const sealed = cookieValue(done, "ordo_gcal");
    expect(sealed).toBeTruthy();
    expect(sealed).not.toContain("r1");
    const body = String(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body
    );
    expect(body).toContain("code_verifier=");
    expect(body).toContain("grant_type=authorization_code");
  });

  it("rejects a callback whose state does not match the started flow", async () => {
    const started = await GET(new Request(`${ORIGIN}/api/gcal/login`));
    const flow = cookieValue(started, "ordo_gcal_flow") ?? "";
    const done = await GET(
      new Request(`${ORIGIN}/api/gcal/callback?code=c1&state=forged`, {
        headers: { cookie: `ordo_gcal_flow=${flow}` },
      })
    );
    expect(done.headers.get("location")).toBe(`${ORIGIN}/?gcal=error`);
    expect(done.headers.get("set-cookie")).toBeNull();
  });

  it("reports a refused consent and a consent without calendar access", async () => {
    const denied = await GET(
      new Request(`${ORIGIN}/api/gcal/callback?error=access_denied`)
    );
    expect(denied.headers.get("location")).toBe(`${ORIGIN}/?gcal=denied`);
    const { done } = await connect("openid");
    expect(done.headers.get("location")).toBe(`${ORIGIN}/?gcal=scope`);
    const readOnly = await connect("https://www.googleapis.com/auth/calendar.readonly");
    expect(readOnly.done.headers.get("location")).toBe(`${ORIGIN}/?gcal=scope`);
    const full = await connect("https://www.googleapis.com/auth/calendar");
    expect(full.done.headers.get("location")).toBe(`${ORIGIN}/?gcal=connected`);
  });

  it("trades the cookie for a fresh access token", async () => {
    const { done } = await connect();
    const sealed = cookieValue(done, "ordo_gcal");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => tokenReply({ access_token: "a2", expires_in: 3599 }))
    );
    const response = await POST(
      new Request(`${ORIGIN}/api/gcal/token`, {
        method: "POST",
        headers: { cookie: `ordo_gcal=${sealed}`, origin: ORIGIN },
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accessToken: "a2", expiresIn: 3599 });
    expect(cookieValue(response, "ordo_gcal")).toBe(sealed);
  });

  it("forgets a refresh token that Google no longer accepts", async () => {
    const { done } = await connect();
    const sealed = cookieValue(done, "ordo_gcal");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => tokenReply({ error: "invalid_grant" }, 400))
    );
    const response = await POST(
      new Request(`${ORIGIN}/api/gcal/token`, {
        method: "POST",
        headers: { cookie: `ordo_gcal=${sealed}` },
      })
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("refuses tampered cookies, missing cookies and foreign origins", async () => {
    const tampered = await POST(
      new Request(`${ORIGIN}/api/gcal/token`, {
        method: "POST",
        headers: { cookie: "ordo_gcal=AAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
      })
    );
    expect(tampered.status).toBe(401);
    const missing = await POST(
      new Request(`${ORIGIN}/api/gcal/token`, { method: "POST" })
    );
    expect(missing.status).toBe(401);
    const foreign = await POST(
      new Request(`${ORIGIN}/api/gcal/token`, {
        method: "POST",
        headers: { origin: "https://evil.example" },
      })
    );
    expect(foreign.status).toBe(403);
  });

  it("revokes the grant on logout and clears the cookie", async () => {
    const { done } = await connect();
    const sealed = cookieValue(done, "ordo_gcal");
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      new Request(`${ORIGIN}/api/gcal/logout`, {
        method: "POST",
        headers: { cookie: `ordo_gcal=${sealed}`, origin: ORIGIN },
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(call[1].body)).toBe("token=r1");
  });

  it("says so when the server has no Google credentials", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    const started = await GET(new Request(`${ORIGIN}/api/gcal/login`));
    expect(started.headers.get("location")).toBe(`${ORIGIN}/?gcal=unconfigured`);
    const response = await POST(
      new Request(`${ORIGIN}/api/gcal/token`, { method: "POST" })
    );
    expect(response.status).toBe(501);
  });

  it("drops the Secure flag on plain-http localhost", async () => {
    const started = await GET(new Request("http://localhost:5173/api/gcal/login"));
    expect(started.headers.get("set-cookie")).not.toContain("Secure");
    const location = new URL(started.headers.get("location") ?? "");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/api/gcal/callback"
    );
  });
});
