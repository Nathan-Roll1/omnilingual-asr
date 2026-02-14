// =============================================
// Auth utilities — PBKDF2 password hashing + JWT
// Runs on Cloudflare Workers (Web Crypto API only)
// =============================================

const PBKDF2_ITERATIONS = 100_000;
const HASH_ALGO = "SHA-256";
const KEY_LENGTH = 256; // bits

// ── Helpers ──

function hexEncode(buffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexDecode(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function base64url(input) {
  const str =
    typeof input === "string"
      ? btoa(input)
      : btoa(String.fromCharCode(...new Uint8Array(input)));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Password Hashing (PBKDF2) ──

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALGO,
    },
    keyMaterial,
    KEY_LENGTH
  );

  // Store as "salt_hex:hash_hex"
  return `${hexEncode(salt)}:${hexEncode(hash)}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, expectedHex] = stored.split(":");
  if (!saltHex || !expectedHex) return false;

  const encoder = new TextEncoder();
  const salt = hexDecode(saltHex);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALGO,
    },
    keyMaterial,
    KEY_LENGTH
  );

  return hexEncode(hash) === expectedHex;
}

// ── JWT (HMAC-SHA256) ──

const JWT_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

async function getSigningKey(secret) {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createJWT(payload, secret) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: now + JWT_EXPIRY_SECONDS,
    })
  );

  const data = `${header}.${body}`;
  const key = await getSigningKey(secret);
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));

  return `${data}.${base64url(signature)}`;
}

async function verifyJWT(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const key = await getSigningKey(secret);
  const encoder = new TextEncoder();

  const sigBytes = base64urlDecode(sig);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    encoder.encode(data)
  );

  if (!valid) return null;

  try {
    const padded = body.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(padded));

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

// ── Extract token from request ──

function getBearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

// ── JWT secret with automatic fallback ──

function getJwtSecret(env) {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  // Derive a deterministic signing key from GEMINI_API_KEY so auth works
  // even before the operator sets a dedicated JWT_SECRET.
  if (env.GEMINI_API_KEY) return `omni-jwt-${env.GEMINI_API_KEY}`;
  return null;
}

// ── Auto-migration: ensure users table + user_id column exist ──

async function ensureSchema(db) {
  try {
    // Create users table
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // Add user_id column to transcripts if missing
    const { results: cols } = await db.prepare(
      "PRAGMA table_info(transcripts)"
    ).all();
    const hasUserId = cols.some((c) => c.name === "user_id");
    if (!hasUserId) {
      await db.prepare(
        "ALTER TABLE transcripts ADD COLUMN user_id TEXT REFERENCES users(id)"
      ).run();
      await db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_transcripts_user ON transcripts(user_id)"
      ).run();
    }
  } catch (e) {
    console.error("ensureSchema error:", e);
    // Swallow — table may already exist, column may already exist
  }
}

export {
  hashPassword,
  verifyPassword,
  createJWT,
  verifyJWT,
  getBearerToken,
  getJwtSecret,
  ensureSchema,
};
