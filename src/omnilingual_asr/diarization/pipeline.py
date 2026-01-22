from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Callable, Iterable, List, Optional

import torch
import torchaudio

from omnilingual_asr.models.inference.pipeline import (
    ASRInferencePipeline,
    WordTimestamp,
)


@dataclass(frozen=True)
class DiarizationSegment:
    start: float
    end: float
    speaker: str


@dataclass(frozen=True)
class DiarizedTranscriptSegment:
    start: float
    end: float
    speaker: str
    text: str
    words: list[WordTimestamp] | None = None


def merge_adjacent_segments(
    segments: Iterable[DiarizationSegment],
    max_gap_seconds: float,
) -> List[DiarizationSegment]:
    merged: List[DiarizationSegment] = []
    for seg in sorted(segments, key=lambda s: (s.start, s.end)):
        if not merged:
            merged.append(seg)
            continue
        prev = merged[-1]
        if seg.speaker == prev.speaker and seg.start - prev.end <= max_gap_seconds:
            merged[-1] = DiarizationSegment(prev.start, max(prev.end, seg.end), seg.speaker)
        else:
            merged.append(seg)
    return merged


def split_segment(
    segment: DiarizationSegment, max_duration_seconds: float
) -> List[DiarizationSegment]:
    if max_duration_seconds <= 0:
        raise ValueError("max_duration_seconds must be > 0")
    duration = segment.end - segment.start
    if duration <= max_duration_seconds:
        return [segment]
    segments: List[DiarizationSegment] = []
    cursor = segment.start
    while cursor < segment.end:
        end = min(cursor + max_duration_seconds, segment.end)
        if end > cursor:
            segments.append(DiarizationSegment(cursor, end, segment.speaker))
        cursor = end
    return segments


def split_segments(
    segments: Iterable[DiarizationSegment], max_duration_seconds: float
) -> List[DiarizationSegment]:
    result: List[DiarizationSegment] = []
    for seg in segments:
        result.extend(split_segment(seg, max_duration_seconds))
    return result


def _ensure_pyannote() -> "Pipeline":
    try:
        from pyannote.audio import Pipeline  # type: ignore
    except Exception as exc:  # pragma: no cover - optional dependency
        raise RuntimeError(
            "pyannote.audio is required for diarization. "
            "Install with: pip install 'omnilingual-asr[diarization]'"
        ) from exc
    return Pipeline


class DiarizedTranscriptionPipeline:
    def __init__(
        self,
        *,
        model_card: str = "omniASR_CTC_300M",
        diarization_model: str = "pyannote/speaker-diarization-3.1",
        hf_token: Optional[str] = None,
        device: str | torch.device | None = None,
        dtype: torch.dtype = torch.bfloat16,
        diarization_device: str | torch.device | None = None,
    ) -> None:
        self._allow_torch_safe_globals()
        self._patch_torch_load()
        self.asr = ASRInferencePipeline(
            model_card=model_card,
            device=device,
            dtype=dtype,
        )
        Pipeline = _ensure_pyannote()
        if hf_token is None:
            hf_token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_TOKEN")
        self.diarization = Pipeline.from_pretrained(
            diarization_model, use_auth_token=hf_token
        )
        if self.diarization is None:
            raise RuntimeError(
                "Failed to load pyannote diarization pipeline. "
                "Ensure HF_TOKEN is set and the model card terms are accepted."
            )
        if diarization_device is not None:
            self.diarization.to(diarization_device)

    @staticmethod
    def _allow_torch_safe_globals() -> None:
        """Allow torch to load pyannote checkpoints on newer torch versions."""
        try:
            add_safe_globals = torch.serialization.add_safe_globals  # type: ignore[attr-defined]
        except AttributeError:
            return
        safe_globals = [torch.torch_version.TorchVersion]
        try:
            from pyannote.audio.core import task as pyannote_task  # type: ignore

            for name in (
                "Problem",
                "Resolution",
                "Scope",
                "Scopes",
                "Specifications",
                "Subset",
                "Subsets",
                "Task",
            ):
                obj = getattr(pyannote_task, name, None)
                if obj is not None:
                    safe_globals.append(obj)
        except Exception:
            pass
        try:
            add_safe_globals(safe_globals)
        except Exception:
            # Best-effort; torch will raise if load still fails.
            return

    @staticmethod
    def _patch_torch_load() -> None:
        """Ensure pyannote can load checkpoints on torch>=2.6 defaults."""
        if getattr(torch.load, "_omniasr_patched", False):
            return

        original_load = torch.load

        def _load(*args, **kwargs):
            kwargs["weights_only"] = False
            return original_load(*args, **kwargs)

        _load._omniasr_patched = True  # type: ignore[attr-defined]
        torch.load = _load  # type: ignore[assignment]

    def transcribe(
        self,
        audio_path: str,
        *,
        lang: Optional[str] = None,
        batch_size: int = 4,
        max_seg_seconds: float = 30.0,
        min_seg_seconds: float = 0.2,
        merge_gap_seconds: float = 0.2,
        word_timestamps: bool = False,
        progress_callback: Optional[Callable[[str, int], None]] = None,
    ) -> List[DiarizedTranscriptSegment]:
        """Transcribe audio with speaker diarization.

        Args:
            progress_callback: Optional callback(step_name, step_index) to report progress.
                Steps: "loading" (0), "diarizing" (1), "transcribing" (2), "aligning" (3), "done" (4)
        """
        def _report(step: str, idx: int) -> None:
            if progress_callback:
                progress_callback(step, idx)

        if max_seg_seconds > 40.0:
            raise ValueError("max_seg_seconds must be <= 40.0 for inference.")

        _report("loading", 0)
        waveform, sample_rate = torchaudio.load(audio_path)
        waveform = waveform.contiguous()
        diar_waveform = waveform.unsqueeze(0) if waveform.dim() == 1 else waveform
        mono_waveform = (
            waveform.mean(dim=0) if waveform.dim() == 2 else waveform
        )

        _report("diarizing", 1)
        diarization = self.diarization(
            {"waveform": diar_waveform, "sample_rate": sample_rate}
        )
        segments: List[DiarizationSegment] = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            if turn.end - turn.start < min_seg_seconds:
                continue
            segments.append(
                DiarizationSegment(float(turn.start), float(turn.end), str(speaker))
            )

        segments = merge_adjacent_segments(segments, merge_gap_seconds)
        segments = split_segments(segments, max_seg_seconds)

        audio_inputs = []
        kept_segments: List[DiarizationSegment] = []
        for seg in segments:
            start = max(0, int(seg.start * sample_rate))
            end = min(mono_waveform.numel(), int(seg.end * sample_rate))
            if end <= start:
                continue
            audio_inputs.append(
                {"waveform": mono_waveform[start:end], "sample_rate": sample_rate}
            )
            kept_segments.append(seg)

        if not audio_inputs:
            _report("done", 4)
            return []

        _report("transcribing", 2)
        lang_list = [lang] * len(audio_inputs) if lang else None
        word_times: List[List[WordTimestamp]] | None = None
        if word_timestamps:
            # Direct timestamps from the CTC model logits (no post-alignment pass).
            # We still emit an "aligning" progress event but keep it bundled
            # with transcribing for now.
            _report("aligning", 2)
            # Keeping alignment flow commented for later use:
            # _report("aligning", 3)
            # word_times = self.asr.transcribe_with_word_timestamps(
            #     audio_inputs, batch_size=batch_size
            # )
            results = self.asr.transcribe_with_text_and_word_timestamps(
                audio_inputs, batch_size=batch_size
            )
            transcripts = [text for text, _ in results]
            word_times = [words for _, words in results]
        else:
            transcripts = self.asr.transcribe(
                audio_inputs,
                lang=lang_list,
                batch_size=batch_size,
            )

        _report("done", 4)
        results: List[DiarizedTranscriptSegment] = []
        for idx, (seg, text) in enumerate(zip(kept_segments, transcripts)):
            words = None
            if word_times is not None:
                words = [
                    WordTimestamp(
                        word=w.word,
                        start=w.start + seg.start,
                        end=w.end + seg.start,
                    )
                    for w in word_times[idx]
                ]
            results.append(
                DiarizedTranscriptSegment(
                    start=seg.start,
                    end=seg.end,
                    speaker=seg.speaker,
                    text=text,
                    words=words,
                )
            )
        return results

