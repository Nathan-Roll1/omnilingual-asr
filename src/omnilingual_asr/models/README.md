# Omnilingual ASR Models

This package provides speech transcription using Google's Gemini API.

## Available Pipelines

### GeminiASRPipeline

Low-level pipeline for direct Gemini API access:

```python
from omnilingual_asr.models.inference import GeminiASRPipeline

pipeline = GeminiASRPipeline()
result = pipeline.transcribe("audio.wav")
```

### GeminiDiarizedTranscriptionPipeline

High-level pipeline with structured segment output:

```python
from omnilingual_asr import GeminiDiarizedTranscriptionPipeline

pipeline = GeminiDiarizedTranscriptionPipeline()
segments = pipeline.transcribe("audio.wav")

for seg in segments:
    print(f"{seg.speaker}: {seg.text}")
```

## Features

- Automatic speaker diarization
- Language detection (including code-switching)
- Emotion detection (happy, sad, angry, neutral)
- Translation to English
- Long audio chunking with parallel processing
