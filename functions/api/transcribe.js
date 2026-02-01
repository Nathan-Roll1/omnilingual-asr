import { transcribeWithGemini } from "./_gemini.js";

export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const file = form.get("file");
  if (!file) {
    return new Response(
      JSON.stringify({ error: "Missing audio file." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const sizeLimit = 20 * 1024 * 1024;
  if (file.size > sizeLimit) {
    return new Response(
      JSON.stringify({ error: "File too large for inline transcription. Use smaller files or chunking." }),
      { status: 413, headers: { "Content-Type": "application/json" } }
    );
  }

  const audioBuffer = await file.arrayBuffer();
  const language = form.get("language") || null;
  const speakerCount = form.get("speaker_count") || null;

  try {
    const result = await transcribeWithGemini({
      apiKey: env.GEMINI_API_KEY,
      audioBuffer,
      filename: file.name,
      language,
      speakerCount,
    });

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Transcription failed." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
