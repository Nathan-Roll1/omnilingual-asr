# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
#
# This source code is licensed under the BSD-style license found in the
# LICENSE file in the root directory of this source tree.

"""Gemini-based diarization and transcription pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Optional


@dataclass(frozen=True)
class WordTimestamp:
    """Word-level timestamp information."""
    word: str
    start: float
    end: float


@dataclass(frozen=True)
class DiarizedTranscriptSegment:
    """A transcribed segment with speaker and timing information."""
    start: float
    end: float
    speaker: str
    text: str
    words: list[WordTimestamp] | None = None
    # Gemini-specific fields
    language: str | None = None
    language_code: str | None = None
    languages: list[dict] | None = None  # For code-switching: [{"name": "English", "code": "en"}, ...]
    emotion: str | None = None
    translation: str | None = None


class GeminiDiarizedTranscriptionPipeline:
    """Gemini API-based transcription pipeline with built-in diarization.

    This pipeline uses the Gemini Speech API for transcription with speaker
    diarization, language detection, emotion analysis, and translation.
    """

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        model: str = "gemini-3-flash-preview",
    ) -> None:
        """Initialize the Gemini transcription pipeline.

        Args:
            api_key: Gemini API key. If not provided, uses GEMINI_API_KEY env var.
            model: Gemini model to use (default: gemini-3-flash-preview)
        """
        from omnilingual_asr.models.inference.gemini_pipeline import GeminiASRPipeline

        self.gemini = GeminiASRPipeline(api_key=api_key, model=model)
        self._summary: Optional[str] = None
        self._detected_languages: Optional[List[dict]] = None

    @property
    def summary(self) -> Optional[str]:
        """Get the summary from the last transcription."""
        return self._summary

    @property
    def detected_languages(self) -> Optional[List[dict]]:
        """Get detected languages from the last transcription."""
        return self._detected_languages

    def transcribe(
        self,
        audio_path: str,
        *,
        word_timestamps: bool = False,  # Kept for API compatibility
        progress_callback: Optional[Callable[[str, int], None]] = None,
        language: Optional[str] = None,
        speaker_count: Optional[str] = None,
        **kwargs,  # Accept other args for compatibility but ignore them
    ) -> List[DiarizedTranscriptSegment]:
        """Transcribe audio using Gemini API with speaker diarization.

        Args:
            audio_path: Path to the audio file
            word_timestamps: Kept for API compatibility (not used)
            progress_callback: Optional callback(step_name, step_index) to report progress.
                Steps: "uploading" (0), "transcribing" (1), "processing" (2), "done" (3)
            language: Optional language hint (e.g., 'en', 'es', 'fr')
            speaker_count: Optional speaker count hint (e.g., '1', '2', '3')

        Returns:
            List of transcribed segments with speaker, language, emotion, and translation
        """
        result = self.gemini.transcribe_with_retry(
            audio_path,
            progress_callback=progress_callback,
            language=language,
            speaker_count=speaker_count,
        )

        # Store summary and detected languages for access
        self._summary = result.summary
        self._detected_languages = result.detected_languages

        # Convert Gemini segments to DiarizedTranscriptSegment
        segments: List[DiarizedTranscriptSegment] = []
        for seg in result.segments:
            segments.append(
                DiarizedTranscriptSegment(
                    start=seg.start,
                    end=seg.end,
                    speaker=seg.speaker,
                    text=seg.text,
                    words=None,  # Gemini doesn't provide word-level timestamps
                    language=seg.language,
                    language_code=seg.language_code,
                    languages=seg.languages,  # For code-switching support
                    emotion=seg.emotion,
                    translation=seg.translation,
                )
            )

        return segments
