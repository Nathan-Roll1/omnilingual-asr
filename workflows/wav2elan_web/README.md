# Wav2ELAN (Local Web App)

Minimal web UI for diarized, word-aligned transcripts with clickable words.

## Install

```bash
pip install -e ".[diarization,web]"
```

## Run

```bash
export HF_TOKEN="your_token_here"
export DYLD_LIBRARY_PATH="workflows/diarization/libiconv_shim:/opt/homebrew/opt/libsndfile/lib:$CONDA_PREFIX/lib"
uvicorn workflows.wav2elan_web.app:app --reload
```

Open `http://localhost:8000` and upload a `.wav`/`.mp3`/`.flac`.

