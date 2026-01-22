from __future__ import annotations

import argparse
import json
from pathlib import Path

from omnilingual_asr.diarization import DiarizedTranscriptionPipeline
from omnilingual_asr.elan import write_eaf


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Diarize audio and transcribe with omniASR_CTC_300M."
    )
    parser.add_argument("audio_path", help="Path to input audio file.")
    parser.add_argument(
        "--lang",
        default=None,
        help="Language code (ignored by CTC models but accepted).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=4,
        help="ASR batch size.",
    )
    parser.add_argument(
        "--max-seg-seconds",
        type=float,
        default=30.0,
        help="Maximum diarization segment duration.",
    )
    parser.add_argument(
        "--min-seg-seconds",
        type=float,
        default=0.2,
        help="Minimum diarization segment duration.",
    )
    parser.add_argument(
        "--merge-gap-seconds",
        type=float,
        default=0.2,
        help="Merge adjacent same-speaker segments within this gap.",
    )
    parser.add_argument(
        "--word-timestamps",
        action="store_true",
        help="Include word-level timestamps in output.",
    )
    parser.add_argument(
        "--output-jsonl",
        default=None,
        help="Optional path to write JSONL output.",
    )
    parser.add_argument(
        "--output-eaf",
        default=None,
        help="Optional path to write ELAN .eaf output.",
    )
    args = parser.parse_args()

    pipeline = DiarizedTranscriptionPipeline()
    results = pipeline.transcribe(
        args.audio_path,
        lang=args.lang,
        batch_size=args.batch_size,
        max_seg_seconds=args.max_seg_seconds,
        min_seg_seconds=args.min_seg_seconds,
        merge_gap_seconds=args.merge_gap_seconds,
        word_timestamps=args.word_timestamps,
    )

    rows = []
    for seg in results:
        row = {
            "start": seg.start,
            "end": seg.end,
            "speaker": seg.speaker,
            "text": seg.text,
        }
        if args.word_timestamps and seg.words is not None:
            row["words"] = [
                {"word": w.word, "start": w.start, "end": w.end}
                for w in seg.words
            ]
        rows.append(row)

    if args.output_eaf:
        write_eaf(
            args.output_eaf,
            media_path=args.audio_path,
            segments=results,
        )
    if args.output_jsonl:
        _write_jsonl(Path(args.output_jsonl), rows)
    else:
        if args.word_timestamps:
            for row in rows:
                print(json.dumps(row, ensure_ascii=False))
        else:
            for row in rows:
                print(
                    f"[{row['start']:.2f}-{row['end']:.2f}] "
                    f"{row['speaker']}: {row['text']}"
                )


if __name__ == "__main__":
    main()

