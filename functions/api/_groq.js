/**
 * Groq Whisper forced alignment — get word-level timestamps
 * Uses Groq's free Whisper API with word-level timestamp granularity.
 */

async function alignWithGroq({ apiKey, audioBuffer, filename }) {
  if (!apiKey) {
    console.warn("GROQ_API_KEY not set — skipping forced alignment.");
    return null;
  }

  // Build multipart form data manually (no FormData in CF Workers for blobs)
  const boundary = "----GroqBoundary" + Date.now();
  const mimeType = getAudioMime(filename);

  const parts = [];

  // model field
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo`
  );

  // response_format field
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json`
  );

  // timestamp_granularities[] field
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword`
  );

  // audio file field
  const fileHeader =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const fileFooter = `\r\n--${boundary}--\r\n`;

  // Assemble the text parts
  const textPart = parts.join("\r\n") + "\r\n";

  // Concatenate: textPart + fileHeader + audioBuffer + fileFooter
  const enc = new TextEncoder();
  const textBytes = enc.encode(textPart);
  const headerBytes = enc.encode(fileHeader);
  const footerBytes = enc.encode(fileFooter);
  const audioBytes = new Uint8Array(audioBuffer);

  const totalLength = textBytes.length + headerBytes.length + audioBytes.length + footerBytes.length;
  const body = new Uint8Array(totalLength);
  let offset = 0;
  body.set(textBytes, offset); offset += textBytes.length;
  body.set(headerBytes, offset); offset += headerBytes.length;
  body.set(audioBytes, offset); offset += audioBytes.length;
  body.set(footerBytes, offset);

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: body.buffer,
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
    // Find words that overlap with this segment's time range
    // Use a generous window: words starting within segment bounds,
    // or words that overlap the segment range
    const segStart = seg.start;
    const segEnd = seg.end;

    const matchedWords = words.filter((w) => {
      const wStart = w.start;
      const wEnd = w.end;
      // Word overlaps with segment if word starts before segment ends
      // and word ends after segment starts
      return wStart < segEnd + 0.15 && wEnd > segStart - 0.15;
    });

    if (matchedWords.length > 0) {
      seg.words = matchedWords.map((w) => ({
        word: w.word,
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
