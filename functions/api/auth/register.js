import { hashPassword, createJWT, getJwtSecret, ensureSchema } from "../_auth.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

// GET — diagnostic ping (handy for quick checks from the browser address bar)
export async function onRequestGet({ env }) {
  const hasDB = !!env.DB;
  const hasKey = !!getJwtSecret(env);
  return jsonResp({
    ok: hasDB && hasKey,
    db: hasDB,
    signingKey: hasKey,
    ts: new Date().toISOString(),
  });
}

// POST — create account
export async function onRequestPost({ request, env }) {
  try {
    const jwtSecret = getJwtSecret(env);
    if (!env.DB || !jwtSecret) {
      return jsonResp({
        error: "Server misconfigured.",
        detail: { db: !!env.DB, signingKey: !!jwtSecret },
      }, 500);
    }

    // Auto-create users table if it doesn't exist yet
    await ensureSchema(env.DB);

    // Read body as text first, then parse — avoids silent stream-consumed issues
    let rawBody;
    try {
      rawBody = await request.text();
    } catch (e) {
      return jsonResp({ error: "Could not read request body.", detail: e.message }, 400);
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return jsonResp({
        error: "Invalid JSON body.",
        detail: { received: rawBody.slice(0, 200), length: rawBody.length },
      }, 400);
    }

    // Validate access code (server-side gate)
    const ACCESS_CODE = "sesquip";
    const accessCode = (body.access_code || "").trim().toLowerCase();
    if (accessCode !== ACCESS_CODE) {
      return jsonResp({ error: "Invalid access code." }, 403);
    }

    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    // Validate email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResp({
        error: "Valid email is required.",
        detail: { receivedEmail: email || "(empty)" },
      }, 400);
    }

    // Validate password
    if (password.length < 8) {
      return jsonResp({
        error: "Password must be at least 8 characters.",
        detail: { receivedLength: password.length },
      }, 400);
    }

    // Check if email already exists
    const existing = await env.DB.prepare(
      "SELECT id FROM users WHERE email = ?"
    )
      .bind(email)
      .first();

    if (existing) {
      return jsonResp(
        { error: "An account with this email already exists." },
        409
      );
    }

    // Create user
    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)"
    )
      .bind(userId, email, passwordHash)
      .run();

    // Issue JWT
    const token = await createJWT({ sub: userId, email }, jwtSecret);

    return jsonResp(
      { token, user: { id: userId, email } },
      201
    );
  } catch (err) {
    console.error("Register error:", err);
    return jsonResp(
      { error: err.message || "Registration failed.", stack: String(err.stack || "").slice(0, 300) },
      500
    );
  }
}
