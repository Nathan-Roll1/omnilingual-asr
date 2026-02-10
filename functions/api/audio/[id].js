import { getAudioForSession, getSessionKey } from "../_history.js";

// GET /api/audio/:id — streams audio from R2, scoped to session
export async function onRequestGet({ params, request, env }) {
  if (!env.DB || !env.AUDIO_BUCKET) {
    return new Response("Storage not configured", { status: 500 });
  }

  const sessionKey = getSessionKey(request);
  if (!sessionKey) {
    return new Response("Unauthorized", { status: 401 });
  }

  const object = await getAudioForSession(env.DB, env.AUDIO_BUCKET, params.id, sessionKey);
  if (!object) {
    return new Response("Audio not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "audio/wav");
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("Accept-Ranges", "bytes");

  if (object.size) {
    headers.set("Content-Length", String(object.size));
  }

  return new Response(object.body, { status: 200, headers });
}
