import { and, eq, gt } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "../db";
import { sessions, users } from "../db/schema";

export const SESSION_COOKIE = "horsch_portal_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
// Cloudflare Workers currently caps PBKDF2 at 100,000 iterations.
export const PASSWORD_ITERATIONS = 100_000;

export type AppUser = {
  displayName: string;
  email: string;
};

export type PasswordCredential = {
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
};

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validatePassword(value: string) {
  if (value.length < 10) return "A senha deve ter pelo menos 10 caracteres.";
  if (value.length > 128) return "A senha deve ter no máximo 128 caracteres.";
  return null;
}

export async function createPasswordCredential(
  password: string,
): Promise<PasswordCredential> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return {
    passwordHash: bytesToBase64(hash),
    passwordSalt: bytesToBase64(salt),
    passwordIterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyPassword(
  password: string,
  credential: PasswordCredential,
) {
  if (!isPasswordCredentialSupported(credential)) {
    return false;
  }

  try {
    const expected = base64ToBytes(credential.passwordHash);
    const actual = await derivePassword(
      password,
      base64ToBytes(credential.passwordSalt),
      credential.passwordIterations,
    );
    return constantTimeBytesEqual(expected, actual);
  } catch {
    return false;
  }
}

export function isPasswordCredentialSupported(
  credential: PasswordCredential,
) {
  return Boolean(
    credential.passwordHash &&
      credential.passwordSalt &&
      credential.passwordIterations >= PASSWORD_ITERATIONS &&
      credential.passwordIterations <= PASSWORD_ITERATIONS,
  );
}

export async function createSession(userEmail: string) {
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  ).toISOString();
  const db = await getDb();
  await db.insert(sessions).values({ tokenHash, userEmail, expiresAt });
  return { token, expiresAt };
}

export async function deleteCurrentSession() {
  const token = await getSessionToken();
  if (!token) return;
  const db = await getDb();
  await db.delete(sessions).where(eq(sessions.tokenHash, await hashToken(token)));
}

export async function getAuthenticatedUser(): Promise<AppUser | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const db = await getDb();
  const [record] = await db
    .select({
      email: users.email,
      name: users.name,
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userEmail, users.email))
    .where(
      and(
        eq(sessions.tokenHash, await hashToken(token)),
        gt(sessions.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);

  if (!record?.active) return null;
  return {
    email: record.email,
    displayName: record.name || record.email,
  };
}

export function sessionCookie(token: string, secure: boolean) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function expiredSessionCookie(secure: boolean) {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");
}

export async function safeSecretEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return constantTimeBytesEqual(
    new Uint8Array(leftHash),
    new Uint8Array(rightHash),
  );
}

async function getSessionToken() {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie") ?? "";
  for (const pair of cookie.split(";")) {
    const [name, ...parts] = pair.trim().split("=");
    if (name === SESSION_COOKIE) {
      try {
        return decodeURIComponent(parts.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
) {
  const saltBuffer = salt.buffer.slice(
    salt.byteOffset,
    salt.byteOffset + salt.byteLength,
  ) as ArrayBuffer;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
