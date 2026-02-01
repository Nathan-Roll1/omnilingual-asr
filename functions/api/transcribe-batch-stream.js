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
        const files = form.getAll("files");
        if (!files || files.length === 0) {
          controller.enqueue(encoder.encode(sseEvent("error", { message: "Missing audio files." })));
          controller.close();
          return;
        }

        const sizeLimit = 20 * 1024 * 1024;
        if (files.some((f) => f.size > sizeLimit)) {
          controller.enqueue(encoder.encode(sseEvent("error", { message: "One or more files are too large for inline transcription." })));
          controller.close();
          return;
        }

        const language = form.get("language") || null;
        const speakerCount = form.get("speaker_count") || null;

        controller.enqueue(encoder.encode(sseEvent("progress", { step: "transcribing", index: 1 })));

        const results = [];
        for (const file of files) {
          const audioBuffer = await file.arrayBuffer();
          const result = await transcribeWithGemini({
            apiKey: env.GEMINI_API_KEY,
            audioBuffer,
            filename: file.name,
            language,
            speakerCount,
          });

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
          results.push(entry);
        }

        controller.enqueue(encoder.encode(sseEvent("progress", { step: "processing", index: 2 })));
        controller.enqueue(encoder.encode(sseEvent("progress", { step: "done", index: 3 })));
        controller.enqueue(encoder.encode(sseEvent("result", { results })));
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            sseEvent("error", { message: err.message || "Batch transcription failed." })
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
