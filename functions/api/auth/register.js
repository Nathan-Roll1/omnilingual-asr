import { hashPassword, createJWT, getJwtSecret, ensureSchema } from "../_auth.js";

export async function onRequestPost({ request, env }) {
  try {
    const jwtSecret = getJwtSecret(env);
    if (!env.DB || !jwtSecret) {
      return new Response(
        JSON.stringify({
          error: "Server misconfigured — DB or signing key unavailable.",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Auto-create users table if it doesn't exist yet
    await ensureSchema(env.DB);

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    // Validate email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ error: "Valid email is required." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate password
    if (password.length < 8) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 8 characters." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Check if email already exists
    const existing = await env.DB.prepare(
      "SELECT id FROM users WHERE email = ?"
    )
      .bind(email)
      .first();

    if (existing) {
      return new Response(
        JSON.stringify({ error: "An account with this email already exists." }),
        { status: 409, headers: { "Content-Type": "application/json" } }
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

    return new Response(
      JSON.stringify({
        token,
        user: { id: userId, email },
      }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Register error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Registration failed." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
