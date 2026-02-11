/**
 * Groq Whisper forced alignment — get word-level timestamps
 * Uses Groq's free Whisper API with word-level timestamp granularity.
 */

async function alignWithGroq({ apiKey, audioBuffer, filename }) {
  if (!apiKey) {
    console.warn("GROQ_API_KEY not set — skipping forced alignment.");
    return null;
  }

  const mimeType = getAudioMime(filename);

  // Cloudflare Workers support FormData + Blob natively
  const form = new FormData();
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("file", new Blob([audioBuffer], { type: mimeType }), filename);

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Groq API error: ${res.status} ${errText}`);
    return null; // Non-fatal — fall back to no word timestamps
  }

  const data = await res.json();
  return data.words || null;
}

/**
 * Merge Groq word timestamps into Gemini segments.
 * Each Gemini segment has start/end times; we find which Groq words
 * fall within each segment's time range and attach them.
 */
function mergeWordTimestamps(segments, groqWords) {
  if (!groqWords || !groqWords.length || !segments || !segments.length) {
    return segments;
  }

  // Sort words by start time
  const words = [...groqWords].sort((a, b) => a.start - b.start);

  return segments.map((seg) => {
    const segStart = seg.start;
    const segEnd = seg.end;

    // Find words that overlap with this segment's time range
    // Use a generous window (150ms) to catch boundary words
    const matchedWords = words.filter((w) => {
      return w.start < segEnd + 0.15 && w.end > segStart - 0.15;
    });

    if (matchedWords.length > 0) {
      seg.words = matchedWords.map((w) => ({
        word: w.word.trim(),
        start: w.start,
        end: w.end,
      }));
    }

    return seg;
  });
}

function getAudioMime(filename) {
  const name = (filename || "").toLowerCase();
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".flac")) return "audio/flac";
  if (name.endsWith(".ogg")) return "audio/ogg";
  if (name.endsWith(".m4a")) return "audio/mp4";
  return "audio/wav";
}

export { alignWithGroq, mergeWordTimestamps };
