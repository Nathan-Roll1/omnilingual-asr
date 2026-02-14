import { verifyPassword, createJWT, getJwtSecret, ensureSchema } from "../_auth.js";

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

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Email and password are required." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Look up user
    const user = await env.DB.prepare(
      "SELECT id, email, password_hash FROM users WHERE email = ?"
    )
      .bind(email)
      .first();

    if (!user) {
      return new Response(
        JSON.stringify({ error: "Invalid email or password." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify password
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return new Response(
        JSON.stringify({ error: "Invalid email or password." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Issue JWT
    const token = await createJWT(
      { sub: user.id, email: user.email },
      jwtSecret
    );

    return new Response(
      JSON.stringify({
        token,
        user: { id: user.id, email: user.email },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Login error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Login failed." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
