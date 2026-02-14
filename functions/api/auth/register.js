import { hashPassword, createJWT } from "../_auth.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.JWT_SECRET) {
    return new Response(JSON.stringify({ error: "Server misconfigured." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

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
    return new Response(JSON.stringify({ error: "Valid email is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
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
  const token = await createJWT(
    { sub: userId, email },
    env.JWT_SECRET
  );

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
}
