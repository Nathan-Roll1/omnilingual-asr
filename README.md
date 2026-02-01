# OmniScribe - Speech Transcription with Gemini API

OmniScribe is a web-based speech transcription tool powered by Google's Gemini API. Features automatic speaker diarization, language detection, emotion analysis, and translation support for multilingual audio.

## Features

- **Automatic Speaker Diarization** - Identifies and labels different speakers
- **Language Detection** - Detects languages including code-switching support
- **Emotion Analysis** - Identifies speaker emotions (happy, sad, angry, neutral)
- **Translation** - Automatic English translation for non-English content
- **Long Audio Support** - Automatically chunks and processes long audio files in parallel
- **Multiple Export Formats** - EAF (ELAN), TextGrid (Praat), SRT, TXT, JSON

## Installation

```bash
# Install the package
pip install omnilingual-asr

# Or with web interface support
pip install "omnilingual-asr[web]"
```

## Quick Start

### Python API

```python
from omnilingual_asr import GeminiDiarizedTranscriptionPipeline

# Initialize pipeline (uses GEMINI_API_KEY environment variable)
pipeline = GeminiDiarizedTranscriptionPipeline()

# Transcribe audio
segments = pipeline.transcribe("audio.wav")

for segment in segments:
    print(f"[{segment.start:.1f}s - {segment.end:.1f}s] {segment.speaker}")
    print(f"  {segment.text}")
    if segment.emotion:
        print(f"  Emotion: {segment.emotion}")
    if segment.translation:
        print(f"  Translation: {segment.translation}")
```

### Web Interface

1. Get a Gemini API key from https://aistudio.google.com/apikey

2. Start the web server:
```bash
export GEMINI_API_KEY="your-api-key-here"
cd workflows/wav2elan_web
python -m uvicorn app:app --host 0.0.0.0 --port 8000
```

3. Open http://localhost:8000 in your browser

4. Drop audio files to transcribe, or use the "Upload audio" button for advanced options (language hint, speaker count)

## API Reference

### GeminiDiarizedTranscriptionPipeline

```python
from omnilingual_asr import GeminiDiarizedTranscriptionPipeline

pipeline = GeminiDiarizedTranscriptionPipeline(
    api_key="...",  # Optional, defaults to GEMINI_API_KEY env var
    model="gemini-3-flash-preview",  # Gemini model to use
)

segments = pipeline.transcribe(
    "audio.wav",
    language="en",  # Optional language hint
    speaker_count="2",  # Optional speaker count hint
)

# Access summary and detected languages
print(pipeline.summary)
print(pipeline.detected_languages)
```

### DiarizedTranscriptSegment

Each segment contains:
- `start` / `end` - Timestamps in seconds
- `speaker` - Speaker identifier (e.g., "Speaker 1")
- `text` - Transcribed text
- `language` / `language_code` - Detected language
- `languages` - List of languages for code-switched segments
- `emotion` - Detected emotion (happy, sad, angry, neutral)
- `translation` - English translation (if non-English)

## Supported Audio Formats

- WAV, MP3, FLAC, OGG, M4A, AIFF, AAC
- Maximum 9.5 hours per file
- Long files automatically chunked for parallel processing

## Environment Variables

- `GEMINI_API_KEY` - Your Gemini API key (required)

## License

Apache 2.0 - See [LICENSE](./LICENSE)

## Citation

If you use this tool in your research:

```bibtex
@misc{omnilingualasrteam2025omnilingualasropensourcemultilingual,
      title={Omnilingual ASR: Open-Source Multilingual Speech Recognition for 1600+ Languages},
      author={Omnilingual ASR team and others},
      year={2025},
      eprint={2511.09690},
      archivePrefix={arXiv},
      primaryClass={cs.CL},
      url={https://arxiv.org/abs/2511.09690},
}
```
