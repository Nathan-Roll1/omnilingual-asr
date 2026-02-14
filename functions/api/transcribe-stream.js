import { transcribeWithGemini, getMimeType } from "./_gemini.js";
import { putHistory, storeAudio, getSessionKey } from "./_history.js";

function sseEvent(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function onRequestPost({ request, env }) {
  const encoder = new TextEncoder();
  const sessionKey = getSessionKey(request);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (!sessionKey) {
          controller.enqueue(encoder.encode(sseEvent("error", { message: "Missing session key." })));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(sseEvent("progress", { step: "uploading", index: 0 })));

        const form = await request.formData();
        const file = form.get("file");
        if (!file) {
          controller.enqueue(encoder.encode(sseEvent("error", { message: "Missing audio file." })));
          controller.close();
          return;
        }

        const sizeLimit = 20 * 1024 * 1024;
        if (file.size > sizeLimit) {
          controller.enqueue(encoder.encode(sseEvent("error", { message: "File too large. Max 20 MB." })));
          controller.close();
          return;
        }

        const language = form.get("language") || null;
        const orthography = form.get("orthography") || null;
        const speakerCount = form.get("speaker_count") || null;

        controller.enqueue(encoder.encode(sseEvent("progress", { step: "transcribing", index: 1 })));

        const audioBuffer = await file.arrayBuffer();
        const result = await transcribeWithGemini({
          apiKey: env.GEMINI_API_KEY,
          audioBuffer,
          filename: file.name,
          language,
          orthography,
          speakerCount,
        });

        controller.enqueue(encoder.encode(sseEvent("progress", { step: "processing", index: 2 })));

        const id = crypto.randomUUID();

        let audioKey = null;
        if (env.AUDIO_BUCKET) {
          const mimeType = getMimeType(file.name);
          audioKey = await storeAudio(env.AUDIO_BUCKET, id, file.name, audioBuffer, mimeType);
        }

        const entry = {
          id,
          file_name: file.name,
          created_at: new Date().toISOString(),
          audio_key: audioKey,
          audio_url: audioKey ? `/api/audio/${id}` : null,
          summary: result.summary,
          detected_languages: result.detected_languages,
          segments: result.segments,
        };

        if (env.DB) {
          await putHistory(env.DB, entry, sessionKey);
        }

        controller.enqueue(encoder.encode(sseEvent("progress", { step: "done", index: 3 })));
        controller.enqueue(encoder.encode(sseEvent("result", entry)));
      } catch (err) {
        controller.enqueue(
          encoder.encode(sseEvent("error", { message: err.message || "Transcription failed." }))
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
