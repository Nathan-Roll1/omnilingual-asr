import { verifyPassword, createJWT } from "../_auth.js";

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
    env.JWT_SECRET
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
}
