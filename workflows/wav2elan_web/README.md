# OmniScribe (Web App)

Minimal web UI for Gemini-based transcription with diarization, language detection, and emotion analysis.

## Install

```bash
pip install -e ".[web]"
```

## Run

```bash
export GEMINI_API_KEY="your_api_key_here"
uvicorn workflows.wav2elan_web.app:app --reload
```

Open `http://localhost:8000` and upload a `.wav`/`.mp3`/`.flac`.

