# Gemini ASR Pipeline

Speech transcription using Google's Gemini API with automatic speaker diarization, language detection, emotion analysis, and translation.

---

## Quick Start

```python
from omnilingual_asr import GeminiASRPipeline

pipeline = GeminiASRPipeline()  # Uses GEMINI_API_KEY env var
result = pipeline.transcribe("audio.wav")

print(f"Summary: {result.summary}")
for segment in result.segments:
    print(f"[{segment.start:.1f}s - {segment.end:.1f}s] {segment.speaker}: {segment.text}")
```

---

## Features

- **Speaker Diarization** - Automatic speaker identification
- **Language Detection** - Detects all languages including code-switching
- **Emotion Detection** - Happy, sad, angry, neutral
- **Translation** - Automatic English translation for non-English content
- **Long Audio Support** - Automatically chunks files > 6 minutes for parallel processing

---

## API Reference

### GeminiASRPipeline

```python
from omnilingual_asr import GeminiASRPipeline

pipeline = GeminiASRPipeline(
    api_key="...",  # Optional, defaults to GEMINI_API_KEY env var
    model="gemini-3-flash-preview",  # Gemini model to use
)

result = pipeline.transcribe(
    "audio.wav",
    language="en",  # Optional language hint
    speaker_count="2",  # Optional speaker count hint
    progress_callback=lambda step, idx: print(f"{step}: {idx}"),
)
```

### GeminiTranscriptionResult

- `summary` - Brief summary of the audio content
- `segments` - List of `GeminiTranscriptSegment`
- `detected_languages` - List of detected languages

### GeminiTranscriptSegment

- `start` / `end` - Timestamps in seconds
- `speaker` - Speaker identifier
- `text` - Transcribed text
- `language` / `language_code` - Primary detected language
- `languages` - All languages for code-switched segments
- `emotion` - Detected emotion
- `translation` - English translation (if non-English)

---

## Supported Audio Formats

- WAV, MP3, FLAC, OGG, M4A, AIFF, AAC
- Maximum 9.5 hours per file
- Files > 6 minutes automatically chunked for parallel processing
