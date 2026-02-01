"""Gemini API-based ASR pipeline for speech transcription with diarization."""

from __future__ import annotations

import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, List, Optional

# Lazy import for google.genai to avoid import errors when not installed
_genai = None
_types = None


def _ensure_genai():
    """Ensure google-genai is installed and import it."""
    global _genai, _types
    if _genai is None:
        try:
            from google import genai
            from google.genai import types

            _genai = genai
            _types = types
        except ImportError as exc:
            raise RuntimeError(
                "google-genai is required for Gemini API integration. "
                "Install with: pip install 'omnilingual-asr[gemini]'"
            ) from exc
    return _genai, _types


@dataclass(frozen=True)
class WordTimestamp:
    """Word-level timestamp information."""

    word: str
    start: float
    end: float


@dataclass
class GeminiTranscriptSegment:
    """A single transcription segment from Gemini API."""

    start: float
    end: float
    speaker: str
    text: str
    language: Optional[str] = None
    language_code: Optional[str] = None
    languages: Optional[List[dict]] = None  # For code-switching: [{"name": "English", "code": "en"}, ...]
    emotion: Optional[str] = None
    translation: Optional[str] = None
    words: Optional[List[WordTimestamp]] = None


@dataclass
class GeminiTranscriptionResult:
    """Complete transcription result from Gemini API."""

    summary: Optional[str] = None
    segments: List[GeminiTranscriptSegment] = field(default_factory=list)
    detected_languages: Optional[List[dict]] = None


def parse_timestamp(timestamp_str: str) -> float:
    """Parse MM:SS or HH:MM:SS timestamp format to seconds.

    Args:
        timestamp_str: Timestamp string in MM:SS or HH:MM:SS format

    Returns:
        Time in seconds as float
    """
    if not timestamp_str:
        return 0.0

    # Handle various formats
    parts = timestamp_str.strip().split(":")
    try:
        if len(parts) == 2:
            # MM:SS format
            minutes = int(parts[0])
            seconds = float(parts[1])
            return minutes * 60.0 + seconds
        elif len(parts) == 3:
            # HH:MM:SS format
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds = float(parts[2])
            return hours * 3600.0 + minutes * 60.0 + seconds
        else:
            # Try parsing as raw seconds
            return float(timestamp_str)
    except ValueError:
        return 0.0


def get_mime_type(file_path: Path) -> str:
    """Get MIME type for audio file based on extension."""
    ext = file_path.suffix.lower()
    mime_types = {
        ".wav": "audio/wav",
        ".mp3": "audio/mp3",
        ".aiff": "audio/aiff",
        ".aac": "audio/aac",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".m4a": "audio/mp4",
    }
    return mime_types.get(ext, "audio/wav")


# JSON Schema for structured output
# Note: Word-level timestamps are synthesized client-side since Gemini doesn't provide them natively
TRANSCRIPTION_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {
            "type": "string",
            "description": "A concise summary of the audio content including number of speakers and overall tone/emotion.",
        },
        "detected_emotions": {
            "type": "array",
            "description": "List of all emotions detected across the entire audio",
            "items": {
                "type": "string",
                "enum": ["happy", "sad", "angry", "neutral"],
            },
        },
        "speaker_count": {
            "type": "integer",
            "description": "Total number of distinct speakers in the audio",
        },
        "segments": {
            "type": "array",
            "description": "List of transcribed segments with speaker and timestamp.",
            "items": {
                "type": "object",
                "properties": {
                    "speaker": {
                        "type": "string",
                        "description": "Speaker identifier (e.g., 'Speaker 1', 'Speaker 2')",
                    },
                    "timestamp_start": {
                        "type": "string",
                        "description": "Segment start timestamp in MM:SS format",
                    },
                    "timestamp_end": {
                        "type": "string",
                        "description": "Segment end timestamp in MM:SS format",
                    },
                    "content": {
                        "type": "string",
                        "description": "The transcribed text content",
                    },
                    "languages": {
                        "type": "array",
                        "description": "All languages used in this segment (for code-switching). List primary language first.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "Language name (e.g., 'English')"},
                                "code": {"type": "string", "description": "ISO code (e.g., 'en')"},
                            },
                            "required": ["name", "code"],
                        },
                    },
                    "translation": {
                        "type": "string",
                        "description": "English translation if the segment contains non-English, otherwise null",
                    },
                    "emotion": {
                        "type": "string",
                        "enum": ["happy", "sad", "angry", "neutral"],
                        "description": "The primary emotion detected in this segment",
                    },
                },
                "required": [
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
    "required": ["summary", "detected_emotions", "speaker_count", "segments"],
}

TRANSCRIPTION_PROMPT = """
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
"""

# Audio chunking constants
CHUNK_DURATION_SECONDS = 300  # 5 minutes per chunk
MIN_DURATION_FOR_CHUNKING = 360  # Only chunk files > 6 minutes
MAX_PARALLEL_CHUNKS = 4  # Maximum concurrent API calls


def get_audio_duration(audio_path: Path) -> float:
    """Get audio duration in seconds using ffprobe."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "quiet",
                "-show_entries", "format=duration",
                "-of", "csv=p=0",
                str(audio_path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return float(result.stdout.strip())
    except (subprocess.CalledProcessError, ValueError, FileNotFoundError):
        # Fallback: assume short file if ffprobe fails
        return 0.0


def split_audio_into_chunks(
    audio_path: Path,
    chunk_duration: float = CHUNK_DURATION_SECONDS,
    output_dir: Optional[Path] = None,
) -> List[tuple[Path, float]]:
    """Split audio file into chunks using ffmpeg.
    
    Returns:
        List of (chunk_path, start_offset) tuples
    """
    if output_dir is None:
        output_dir = Path(tempfile.mkdtemp(prefix="audio_chunks_"))
    
    total_duration = get_audio_duration(audio_path)
    if total_duration <= 0:
        # Can't determine duration, return original file
        return [(audio_path, 0.0)]
    
    chunks = []
    start_time = 0.0
    chunk_idx = 0
    
    # Get file extension
    ext = audio_path.suffix or ".wav"
    
    while start_time < total_duration:
        chunk_path = output_dir / f"chunk_{chunk_idx:04d}{ext}"
        
        # Use ffmpeg to extract chunk
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",  # Overwrite
                    "-i", str(audio_path),
                    "-ss", str(start_time),
                    "-t", str(chunk_duration),
                    "-c", "copy",  # Fast copy without re-encoding
                    str(chunk_path),
                ],
                capture_output=True,
                check=True,
            )
            chunks.append((chunk_path, start_time))
        except subprocess.CalledProcessError:
            # If copy fails, try with re-encoding
            try:
                subprocess.run(
                    [
                        "ffmpeg",
                        "-y",
                        "-i", str(audio_path),
                        "-ss", str(start_time),
                        "-t", str(chunk_duration),
                        str(chunk_path),
                    ],
                    capture_output=True,
                    check=True,
                )
                chunks.append((chunk_path, start_time))
            except subprocess.CalledProcessError:
                # Skip this chunk on failure
                pass
        
        start_time += chunk_duration
        chunk_idx += 1
    
    return chunks if chunks else [(audio_path, 0.0)]


class GeminiASRPipeline:
    """Gemini API-based ASR pipeline with diarization support."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "gemini-3-flash-preview",
    ) -> None:
        """Initialize the Gemini ASR pipeline.

        Args:
            api_key: Gemini API key. If not provided, will use GEMINI_API_KEY env var.
            model: Gemini model to use (default: gemini-3-flash-preview)
        """
        genai, types = _ensure_genai()

        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "GEMINI_API_KEY environment variable not set. "
                "Get your API key from https://aistudio.google.com/apikey"
            )

        self.model = model
        self.client = genai.Client(api_key=self.api_key)
        self._types = types

    def _prepare_audio_input(self, audio_path: Path) -> Any:
        """Prepare audio input for Gemini API.

        Uses inline data for files < 20MB, otherwise uploads via Files API.

        Args:
            audio_path: Path to the audio file

        Returns:
            Audio input ready for Gemini API
        """
        file_size_mb = audio_path.stat().st_size / (1024 * 1024)
        mime_type = get_mime_type(audio_path)

        if file_size_mb < 20:
            # Use inline data for smaller files
            with open(audio_path, "rb") as f:
                audio_bytes = f.read()
            return self._types.Part.from_bytes(data=audio_bytes, mime_type=mime_type)
        else:
            # Use Files API for larger files
            uploaded_file = self.client.files.upload(file=str(audio_path))
            return uploaded_file

    def _parse_response(self, response_text: str) -> GeminiTranscriptionResult:
        """Parse Gemini API response into structured result.

        Args:
            response_text: JSON response from Gemini API

        Returns:
            Parsed transcription result
        """
        try:
            data = json.loads(response_text)
        except json.JSONDecodeError:
            # Try to extract JSON from response if it's wrapped in markdown
            json_match = re.search(r"```json\s*(.*?)\s*```", response_text, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group(1))
            else:
                # Fallback: create empty result
                return GeminiTranscriptionResult(
                    summary="Failed to parse transcription",
                    segments=[],
                )

        segments = []
        all_languages = []
        seen_lang_codes = set()
        
        for seg in data.get("segments", []):
            start_time = parse_timestamp(seg.get("timestamp_start", "0:00"))
            end_time = parse_timestamp(seg.get("timestamp_end", "0:00"))

            # Ensure end time is after start time
            if end_time <= start_time:
                end_time = start_time + 1.0

            # Handle new languages array format or legacy single language format
            languages = seg.get("languages", [])
            if languages:
                # New format: array of language objects
                primary_lang = languages[0] if languages else {}
                language_name = primary_lang.get("name")
                language_code = primary_lang.get("code")
                # Store languages for this segment (for code-switching)
                segment_languages = [
                    {"name": lang.get("name", ""), "code": lang.get("code", "")}
                    for lang in languages
                ]
                # Collect all languages for global detection
                for lang in languages:
                    code = lang.get("code", "")
                    if code and code not in seen_lang_codes:
                        seen_lang_codes.add(code)
                        all_languages.append({
                            "code": code,
                            "language": lang.get("name", code),
                        })
            else:
                # Legacy format: single language/language_code fields
                language_name = seg.get("language")
                language_code = seg.get("language_code")
                segment_languages = None
                if language_code and language_code not in seen_lang_codes:
                    seen_lang_codes.add(language_code)
                    all_languages.append({
                        "code": language_code,
                        "language": language_name or language_code,
                    })

            segment = GeminiTranscriptSegment(
                start=start_time,
                end=end_time,
                speaker=seg.get("speaker", "Speaker 1"),
                text=seg.get("content", ""),
                language=language_name,
                language_code=language_code,
                languages=segment_languages,  # Store all languages for code-switching
                emotion=seg.get("emotion", "neutral"),
                translation=seg.get("translation"),
                words=None,
            )
            segments.append(segment)

        # Just use the summary text, frontend handles metadata badges
        summary = data.get("summary", "")

        return GeminiTranscriptionResult(
            summary=summary if summary else None,
            segments=segments,
            detected_languages=all_languages if all_languages else None,
        )

    def _build_prompt(
        self,
        language: Optional[str] = None,
        speaker_count: Optional[str] = None,
    ) -> str:
        """Build the transcription prompt with optional hints."""
        prompt = TRANSCRIPTION_PROMPT

        hints = []
        if language:
            hints.append(f"The audio is primarily in {language}.")
        if speaker_count:
            hints.append(f"There are approximately {speaker_count} speaker(s) in the audio.")

        if hints:
            prompt = prompt.strip() + "\n\nAdditional hints:\n" + "\n".join(f"- {h}" for h in hints)

        return prompt

    def transcribe(
        self,
        audio_path: str | Path,
        *,
        progress_callback: Optional[Callable[[str, int], None]] = None,
        language: Optional[str] = None,
        speaker_count: Optional[str] = None,
    ) -> GeminiTranscriptionResult:
        """Transcribe audio file using Gemini API.

        Args:
            audio_path: Path to the audio file
            progress_callback: Optional callback(step_name, step_index) to report progress.
                Steps: "uploading" (0), "transcribing" (1), "processing" (2), "done" (3)
            language: Optional language hint (e.g., 'en', 'es', 'fr')
            speaker_count: Optional speaker count hint (e.g., '1', '2', '3')

        Returns:
            Transcription result with segments, summary, and metadata
        """
        genai, types = _ensure_genai()

        def _report(step: str, idx: int) -> None:
            if progress_callback:
                progress_callback(step, idx)

        audio_path = Path(audio_path)

        # Step 0: Prepare audio
        _report("uploading", 0)
        audio_input = self._prepare_audio_input(audio_path)

        # Build prompt with optional hints
        prompt = self._build_prompt(language=language, speaker_count=speaker_count)

        # Step 1: Call Gemini API
        _report("transcribing", 1)

        response = self.client.models.generate_content(
            model=self.model,
            contents=[
                types.Content(
                    parts=[
                        types.Part(
                            file_data=types.FileData(file_uri=audio_input.uri)
                        )
                        if hasattr(audio_input, "uri")
                        else audio_input,
                        types.Part(text=prompt),
                    ]
                )
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=TRANSCRIPTION_SCHEMA,
            ),
        )

        # Step 2: Parse response
        _report("processing", 2)
        result = self._parse_response(response.text)

        # Step 3: Done
        _report("done", 3)

        return result

    def _transcribe_chunk(
        self,
        chunk_path: Path,
        start_offset: float,
        language: Optional[str] = None,
        speaker_count: Optional[str] = None,
    ) -> GeminiTranscriptionResult:
        """Transcribe a single chunk and adjust timestamps."""
        result = self.transcribe(
            chunk_path,
            language=language,
            speaker_count=speaker_count,
        )
        
        # Adjust timestamps by adding the start offset
        adjusted_segments = []
        for seg in result.segments:
            adjusted_seg = GeminiTranscriptSegment(
                start=seg.start + start_offset,
                end=seg.end + start_offset,
                speaker=seg.speaker,
                text=seg.text,
                language=seg.language,
                language_code=seg.language_code,
                emotion=seg.emotion,
                translation=seg.translation,
                words=seg.words,
            )
            adjusted_segments.append(adjusted_seg)
        
        return GeminiTranscriptionResult(
            summary=result.summary,
            segments=adjusted_segments,
            detected_languages=result.detected_languages,
        )

    def transcribe_chunked(
        self,
        audio_path: str | Path,
        *,
        progress_callback: Optional[Callable[[str, int], None]] = None,
        language: Optional[str] = None,
        speaker_count: Optional[str] = None,
    ) -> GeminiTranscriptionResult:
        """Transcribe long audio by splitting into chunks and processing in parallel.
        
        Args:
            audio_path: Path to the audio file
            progress_callback: Optional progress callback
            language: Optional language hint
            speaker_count: Optional speaker count hint
            
        Returns:
            Merged transcription result
        """
        audio_path = Path(audio_path)
        
        def _report(step: str, idx: int) -> None:
            if progress_callback:
                progress_callback(step, idx)
        
        # Step 0: Split audio into chunks
        _report("uploading", 0)
        temp_dir = Path(tempfile.mkdtemp(prefix="gemini_chunks_"))
        
        try:
            chunks = split_audio_into_chunks(audio_path, output_dir=temp_dir)
            
            if len(chunks) <= 1:
                # No chunking needed, use regular transcription
                return self.transcribe(
                    audio_path,
                    progress_callback=progress_callback,
                    language=language,
                    speaker_count=speaker_count,
                )
            
            # Step 1: Transcribe chunks in parallel
            _report("transcribing", 1)
            
            all_results: List[GeminiTranscriptionResult] = []
            
            with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_PARALLEL_CHUNKS) as executor:
                futures = {
                    executor.submit(
                        self._transcribe_chunk,
                        chunk_path,
                        start_offset,
                        language,
                        speaker_count,
                    ): (chunk_path, start_offset)
                    for chunk_path, start_offset in chunks
                }
                
                for future in concurrent.futures.as_completed(futures):
                    try:
                        result = future.result()
                        all_results.append(result)
                    except Exception as e:
                        # Log but continue with other chunks
                        print(f"Chunk transcription failed: {e}")
            
            # Step 2: Merge results
            _report("processing", 2)
            
            # Sort by first segment's start time
            all_results.sort(
                key=lambda r: r.segments[0].start if r.segments else float('inf')
            )
            
            # Merge segments
            merged_segments: List[GeminiTranscriptSegment] = []
            for result in all_results:
                merged_segments.extend(result.segments)
            
            # Collect all unique languages
            all_languages: List[dict] = []
            seen_lang_codes = set()
            for result in all_results:
                if result.detected_languages:
                    for lang in result.detected_languages:
                        code = lang.get("code", "")
                        if code and code not in seen_lang_codes:
                            seen_lang_codes.add(code)
                            all_languages.append(lang)
            
            # Combine summaries
            summaries = [r.summary for r in all_results if r.summary]
            combined_summary = " ".join(summaries) if summaries else None
            
            # Step 3: Done
            _report("done", 3)
            
            return GeminiTranscriptionResult(
                summary=combined_summary,
                segments=merged_segments,
                detected_languages=all_languages if all_languages else None,
            )
            
        finally:
            # Cleanup temp files
            shutil.rmtree(temp_dir, ignore_errors=True)

    def transcribe_with_retry(
        self,
        audio_path: str | Path,
        *,
        max_retries: int = 3,
        progress_callback: Optional[Callable[[str, int], None]] = None,
        language: Optional[str] = None,
        speaker_count: Optional[str] = None,
    ) -> GeminiTranscriptionResult:
        """Transcribe with automatic retry on transient failures.
        
        For long audio files (> 6 minutes), automatically uses chunked
        parallel processing for faster transcription.

        Args:
            audio_path: Path to the audio file
            max_retries: Maximum number of retry attempts
            progress_callback: Optional progress callback
            language: Optional language hint (e.g., 'en', 'es', 'fr')
            speaker_count: Optional speaker count hint (e.g., '1', '2', '3')

        Returns:
            Transcription result
        """
        import time
        
        audio_path = Path(audio_path)
        
        # Check if we should use chunked processing
        duration = get_audio_duration(audio_path)
        use_chunking = duration > MIN_DURATION_FOR_CHUNKING

        last_error = None
        for attempt in range(max_retries):
            try:
                if use_chunking:
                    return self.transcribe_chunked(
                        audio_path,
                        progress_callback=progress_callback,
                        language=language,
                        speaker_count=speaker_count,
                    )
                else:
                    return self.transcribe(
                        audio_path,
                        progress_callback=progress_callback,
                        language=language,
                        speaker_count=speaker_count,
                    )
            except Exception as e:
                last_error = e
                if attempt < max_retries - 1:
                    wait_time = 2**attempt  # Exponential backoff
                    time.sleep(wait_time)

        raise RuntimeError(
            f"Failed to transcribe after {max_retries} attempts: {last_error}"
        )
