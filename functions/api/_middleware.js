import { verifyJWT, getBearerToken, getJwtSecret } from "./_auth.js";

// Paths that don't require authentication
const PUBLIC_PATHS = [
  "/api/auth/register",
  "/api/auth/login",
];

function isPublicPath(pathname) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname === p + "/");
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Allow public auth endpoints through without a token
  if (isPublicPath(url.pathname)) {
    return context.next();
  }

  // All other API routes require a valid JWT
  const token = getBearerToken(request);
  if (!token) {
    return new Response(JSON.stringify({ error: "Authentication required." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const jwtSecret = getJwtSecret(env);
  if (!jwtSecret) {
    return new Response(JSON.stringify({ error: "Server misconfigured — no signing key." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const payload = await verifyJWT(token, jwtSecret);
    if (!payload || !payload.sub) {
      return new Response(JSON.stringify({ error: "Invalid or expired token." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Attach user identity to the request context
    context.data = context.data || {};
    context.data.userId = payload.sub;
    context.data.email = payload.email;

    return context.next();
  } catch (err) {
    console.error("Middleware auth error:", err);
    return new Response(JSON.stringify({ error: "Invalid or expired token." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
}
