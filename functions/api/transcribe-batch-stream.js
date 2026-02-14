import { transcribeWithGemini, getMimeType } from "./_gemini.js";
import { putHistory, storeAudio } from "./_history.js";

function sseEvent(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Concurrency-limited parallel execution
async function parallelMap(items, fn, concurrency = 3) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

export async function onRequestPost({ request, env, data }) {
  const encoder = new TextEncoder();
  const userId = data.userId;

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
          controller.enqueue(encoder.encode(sseEvent("error", { message: "One or more files are too large." })));
          controller.close();
          return;
        }

        const language = form.get("language") || null;
        const orthography = form.get("orthography") || null;
        const speakerCount = form.get("speaker_count") || null;

        controller.enqueue(encoder.encode(sseEvent("progress", { step: "transcribing", index: 1 })));

        // Process files in parallel (up to 3 concurrent Gemini requests)
        const results = await parallelMap(files, async (file) => {
          const audioBuffer = await file.arrayBuffer();
          const result = await transcribeWithGemini({
            apiKey: env.GEMINI_API_KEY,
            audioBuffer,
            filename: file.name,
            language,
            orthography,
            speakerCount,
          });

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
            await putHistory(env.DB, entry, userId);
          }

          return entry;
        }, 3);

        controller.enqueue(encoder.encode(sseEvent("progress", { step: "processing", index: 2 })));
        controller.enqueue(encoder.encode(sseEvent("progress", { step: "done", index: 3 })));
        controller.enqueue(encoder.encode(sseEvent("result", { results })));
      } catch (err) {
        controller.enqueue(
          encoder.encode(sseEvent("error", { message: err.message || "Batch transcription failed." }))
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
