# Diarization + ASR Pipeline

This workflow runs speaker diarization first, then transcribes each diarized
segment with the smallest CTC model (`omniASR_CTC_300M`), and returns a
speaker-labeled transcript with segment-level timestamps.

## Install extras

```bash
pip install "omnilingual-asr[diarization]"
```

You will also need a Hugging Face access token to download the diarization model:

```bash
export HF_TOKEN="your_token_here"
```

## Run

```bash
python -m workflows.diarization.diarize_transcribe /path/to/audio.wav \
  --output-jsonl /path/to/output.jsonl
```
```bash
python -m workflows.diarization.diarize_transcribe /path/to/audio.wav \
  --output-eaf /path/to/output.eaf --word-timestamps
```

## Notes

- Timestamps are **segment-level** (from diarization), not word-level.
- Add `--word-timestamps` to include word-level timestamps computed from CTC
  frame timings (approximate).
- Audio segments are capped to 30s by default to stay within the 40s inference
  limit of the ASR pipeline.

