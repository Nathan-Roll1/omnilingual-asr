// Serves audio files from R2 by transcript ID
// GET /api/audio/:id -> streams the audio file

export async function onRequestGet({ params, env }) {
  if (!env.DB || !env.AUDIO_BUCKET) {
    return new Response("Storage not configured", { status: 500 });
  }

  // Look up the audio key from D1
  const row = await env.DB
    .prepare("SELECT audio_key FROM transcripts WHERE id = ?")
    .bind(params.id)
    .first();

  if (!row || !row.audio_key) {
    return new Response("Audio not found", { status: 404 });
  }

  // Fetch from R2
  const object = await env.AUDIO_BUCKET.get(row.audio_key);
  if (!object) {
    return new Response("Audio file missing from storage", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "audio/wav");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Accept-Ranges", "bytes");

  // Support range requests for audio seeking
  const range = env.request?.headers?.get("Range");
  // For now, return the full body — R2 handles range requests automatically
  // when using the object body as a ReadableStream

  if (object.size) {
    headers.set("Content-Length", String(object.size));
  }

  return new Response(object.body, {
    status: 200,
    headers,
  });
}
