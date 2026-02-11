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
 * Refine Gemini segment timestamps using Groq word-level timestamps.
 *
 * Strategy: Gemini provides the authoritative text, speaker, language,
 * emotion, and translation. Groq provides accurate acoustic timestamps.
 * We use Groq's word boundaries to snap each Gemini segment's start/end
 * to the nearest actual speech boundary, without replacing any text.
 *
 * Algorithm:
 * 1. Collect all Groq word boundaries into a sorted timeline
 * 2. For each Gemini segment, find the cluster of Groq words that
 *    best overlaps its time range
 * 3. Snap segment start to the earliest matching word start,
 *    and segment end to the latest matching word end
 */
function refineTimestamps(segments, groqWords) {
  if (!groqWords || !groqWords.length || !segments || !segments.length) {
    return segments;
  }

  // Sort words by start time
  const words = [...groqWords].sort((a, b) => a.start - b.start);

  // Build a consumed set so each Groq word is only used once
  const consumed = new Set();

  return segments.map((seg, segIdx) => {
    const segStart = seg.start;
    const segEnd = seg.end;
    const segDuration = segEnd - segStart;

    // Find Groq words overlapping this segment's time range
    // Use a window proportional to segment length (min 0.3s, max 2s)
    const tolerance = Math.min(2.0, Math.max(0.3, segDuration * 0.15));

    const candidates = [];
    for (let i = 0; i < words.length; i++) {
      if (consumed.has(i)) continue;
      const w = words[i];
      // Word overlaps segment if it starts before segment ends
      // and ends after segment starts (with tolerance)
      if (w.start < segEnd + tolerance && w.end > segStart - tolerance) {
        candidates.push(i);
      }
    }

    if (candidates.length > 0) {
      // Mark these words as consumed
      candidates.forEach((i) => consumed.add(i));

      // Snap segment boundaries to Groq word boundaries
      const firstWord = words[candidates[0]];
      const lastWord = words[candidates[candidates.length - 1]];

      seg.start = firstWord.start;
      seg.end = lastWord.end;
    }

    // Ensure segment text is from Gemini (never replaced)
    // words array stays null — we display Gemini's seg.text as-is
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

export { alignWithGroq, refineTimestamps };
