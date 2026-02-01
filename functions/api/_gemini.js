function getMimeType(filename) {
  const name = (filename || "").toLowerCase();
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".flac")) return "audio/flac";
  if (name.endsWith(".ogg")) return "audio/ogg";
  if (name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".aiff") || name.endsWith(".aif")) return "audio/aiff";
  if (name.endsWith(".aac")) return "audio/aac";
  return "audio/wav";
}

function parseTimestamp(timestamp) {
  if (!timestamp) return 0;
  const parts = String(timestamp).split(":").map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

const TRANSCRIPTION_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    detected_emotions: {
      type: "array",
      items: { type: "string", enum: ["happy", "sad", "angry", "neutral"] },
    },
    speaker_count: { type: "integer" },
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          speaker: { type: "string" },
          timestamp_start: { type: "string" },
          timestamp_end: { type: "string" },
          content: { type: "string" },
          languages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                code: { type: "string" },
              },
              required: ["name", "code"],
            },
          },
          translation: { type: "string" },
          emotion: {
            type: "string",
            enum: ["happy", "sad", "angry", "neutral"],
          },
        },
        required: [
          "speaker",
          "timestamp_start",
          "timestamp_end",
          "content",
          "languages",
          "emotion",
        ],
      },
    },
  },
  required: ["summary", "detected_emotions", "speaker_count", "segments"],
};

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function buildPrompt(language, speakerCount) {
  let prompt = `
Process the audio file and generate a detailed transcription.

Requirements:
1. Identify distinct speakers (e.g., Speaker 1, Speaker 2, or names if context allows). Count and report the total number of speakers.
2. Provide accurate start and end timestamps for each segment (Format: MM:SS).
3. IMPORTANT: Create SHORT segments - one sentence or phrase per segment (typically 2-10 seconds each). Do NOT combine multiple sentences into one segment. Split at natural phrase boundaries, pauses, and sentence endings.
4. For EACH segment, detect ALL languages used (important for code-switching). List them in the "languages" array with the primary language first. If a speaker switches between languages mid-sentence, include ALL languages they use.
5. If the segment contains any non-English content, provide an English translation in the translation field. If it's entirely in English, set translation to null.
6. Identify the primary emotion of the speaker in EACH segment. You MUST choose exactly one of: happy, sad, angry, neutral. Also provide a list of ALL emotions detected across the entire audio in "detected_emotions".
7. Provide a brief summary of the entire audio that includes the number of speakers and the overall emotional tone.
8. PRESERVE all punctuation, hyphens, apostrophes, and special characters exactly as spoken. Do not strip or modify punctuation.

Be precise with timestamps - each segment should have both a start and end time. Prefer many short segments over few long segments.
`;

  if (language) {
    prompt += `\nLanguage hint: ${language}.`;
  }
  if (speakerCount) {
    prompt += `\nExpected speaker count: ${speakerCount}.`;
  }

  return prompt;
}

async function transcribeWithGemini({
  apiKey,
  audioBuffer,
  filename,
  language,
  speakerCount,
  model = "gemini-3-flash-preview",
}) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in the environment.");
  }

  const mimeType = getMimeType(filename);
  const base64Audio = arrayBufferToBase64(audioBuffer);
  const prompt = buildPrompt(language, speakerCount);

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inline_data: { mime_type: mimeType, data: base64Audio } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: "application/json",
      response_schema: TRANSCRIPTION_SCHEMA,
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${errText}`);
  }

  const response = await res.json();
  const text =
    response?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const match = String(text).match(/```json\s*([\s\S]*?)\s*```/);
    if (match) {
      data = JSON.parse(match[1]);
    } else {
      throw new Error("Failed to parse Gemini response JSON.");
    }
  }

  const segments = (data.segments || []).map((seg) => {
    const start = parseTimestamp(seg.timestamp_start);
    let end = parseTimestamp(seg.timestamp_end);
    if (end <= start) end = start + 1.0;

    const languages = seg.languages || null;
    let language = null;
    let language_code = null;
    if (Array.isArray(languages) && languages.length > 0) {
      language = languages[0].name;
      language_code = languages[0].code;
    }

    return {
      start,
      end,
      speaker: seg.speaker || "Speaker 1",
      text: seg.content || "",
      language,
      language_code,
      languages,
      emotion: seg.emotion || "neutral",
      translation: seg.translation ?? null,
      words: null,
    };
  });

  const detected_languages = [];
  const seenCodes = new Set();
  segments.forEach((seg) => {
    if (Array.isArray(seg.languages)) {
      seg.languages.forEach((lang) => {
        if (lang.code && !seenCodes.has(lang.code)) {
          seenCodes.add(lang.code);
          detected_languages.push({
            code: lang.code,
            language: lang.name || lang.code,
          });
        }
      });
    } else if (seg.language_code && !seenCodes.has(seg.language_code)) {
      seenCodes.add(seg.language_code);
      detected_languages.push({
        code: seg.language_code,
        language: seg.language || seg.language_code,
      });
    }
  });

  return {
    summary: data.summary || null,
    detected_languages: detected_languages.length ? detected_languages : null,
    segments,
  };
}

export { transcribeWithGemini };
