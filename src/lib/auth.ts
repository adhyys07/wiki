import crypto from "node:crypto";
import { ENV } from "./env";

export const SESSION_COOKIE = "wiki_admin";
const MAX_AGE_SECONDS = 60 * 60 * 8;

function secret(): string {
  const s = ENV.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be set and at least 32 chars");
  }
  return s;
}

/** Hash both sides first so timingSafeEqual always gets equal-length buffers. */
export function checkPassword(input: string): boolean {
  const expected = ENV.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function signSession(user: string): string {
  const payload = `${user}|${Date.now() + MAX_AGE_SECONDS * 1000}`;
  const body = Buffer.from(payload).toString("base64url");
  const mac = crypto
    .createHmac("sha256", secret())
    .update(body)
    .digest("base64url");
  return `${body}.${mac}`;
}

export function verifySession(token: string | undefined): string | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;

  const expected = crypto
    .createHmac("sha256", secret())
    .update(body)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const [user, exp] = Buffer.from(body, "base64url").toString().split("|");
  if (!user || !exp || Number(exp) < Date.now()) return null;
  return user;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

/** Cheap CSRF defence: state-changing requests must come from our own origin. */
export function sameOrigin(request: Request, site: URL): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === site.host;
  } catch {
    return false;
  }
}

export const MAX_AGE = MAX_AGE_SECONDS;
