import { transcribeWithGemini } from "./_gemini.js";
import { putHistory } from "./_history.js";

function sseEvent(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function onRequestPost({ request, env }) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
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
          controller.enqueue(encoder.encode(sseEvent("error", { message: "File too large for inline transcription. Use smaller files or chunking." })));
          controller.close();
          return;
        }

        const language = form.get("language") || null;
        const speakerCount = form.get("speaker_count") || null;

        controller.enqueue(encoder.encode(sseEvent("progress", { step: "transcribing", index: 1 })));

        const audioBuffer = await file.arrayBuffer();
        const result = await transcribeWithGemini({
          apiKey: env.GEMINI_API_KEY,
          audioBuffer,
          filename: file.name,
          language,
          speakerCount,
        });

        controller.enqueue(encoder.encode(sseEvent("progress", { step: "processing", index: 2 })));

        const entry = {
          id: crypto.randomUUID(),
          file_name: file.name,
          created_at: new Date().toISOString(),
          audio_url: null,
          summary: result.summary,
          detected_languages: result.detected_languages,
          segments: result.segments,
        };

        putHistory(entry);

        controller.enqueue(encoder.encode(sseEvent("progress", { step: "done", index: 3 })));
        controller.enqueue(encoder.encode(sseEvent("result", entry)));
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            sseEvent("error", { message: err.message || "Transcription failed." })
          )
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
