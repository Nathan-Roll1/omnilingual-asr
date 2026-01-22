from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
import xml.dom.minidom as minidom
import xml.etree.ElementTree as ET

from omnilingual_asr.diarization.pipeline import DiarizedTranscriptSegment


@dataclass(frozen=True)
class EafConfig:
    author: str | None = None
    time_units: str = "milliseconds"
    schema_location: str = "http://www.mpi.nl/tools/elan/EAFv3.0.xsd"
    version: str = "3.0"
    format: str = "3.0"


def _guess_mime_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".wav":
        return "audio/wav"
    if suffix == ".mp3":
        return "audio/mpeg"
    if suffix == ".flac":
        return "audio/flac"
    return "application/octet-stream"


def _ms(time_seconds: float) -> int:
    return max(0, int(round(time_seconds * 1000.0)))


def write_eaf(
    output_path: str | Path,
    *,
    media_path: str | Path,
    segments: Iterable[DiarizedTranscriptSegment],
    config: EafConfig | None = None,
) -> None:
    cfg = config or EafConfig()
    media_path = Path(media_path)
    output_path = Path(output_path)

    root = ET.Element(
        "ANNOTATION_DOCUMENT",
        {
            "AUTHOR": cfg.author or "",
            "DATE": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "FORMAT": cfg.format,
            "VERSION": cfg.version,
            "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "xsi:noNamespaceSchemaLocation": cfg.schema_location,
        },
    )

    header = ET.SubElement(
        root,
        "HEADER",
        {
            "MEDIA_FILE": "",
            "TIME_UNITS": cfg.time_units,
        },
    )
    media_url = media_path.resolve().as_uri()
    ET.SubElement(
        header,
        "MEDIA_DESCRIPTOR",
        {
            "MEDIA_URL": media_url,
            "MIME_TYPE": _guess_mime_type(media_path),
            "RELATIVE_MEDIA_URL": media_path.name,
        },
    )

    ET.SubElement(root, "LOCALE", {"LANG_ID": "und"})

    ET.SubElement(
        root,
        "LINGUISTIC_TYPE",
        {
            "LINGUISTIC_TYPE_ID": "transcription",
            "TIME_ALIGNABLE": "true",
            "GRAPHIC_REFERENCES": "false",
        },
    )
    ET.SubElement(
        root,
        "LINGUISTIC_TYPE",
        {
            "LINGUISTIC_TYPE_ID": "word",
            "TIME_ALIGNABLE": "true",
            "GRAPHIC_REFERENCES": "false",
        },
    )

    time_order = ET.SubElement(root, "TIME_ORDER")
    time_slots: dict[int, str] = {}

    def get_time_slot_id(time_seconds: float) -> str:
        ms = _ms(time_seconds)
        if ms not in time_slots:
            ts_id = f"ts{len(time_slots) + 1}"
            time_slots[ms] = ts_id
            ET.SubElement(
                time_order,
                "TIME_SLOT",
                {"TIME_SLOT_ID": ts_id, "TIME_VALUE": str(ms)},
            )
        return time_slots[ms]

    segments_by_speaker: dict[str, list[DiarizedTranscriptSegment]] = {}
    for seg in segments:
        segments_by_speaker.setdefault(seg.speaker, []).append(seg)

    annotation_id = 1
    for speaker, speaker_segments in segments_by_speaker.items():
        tier = ET.SubElement(
            root,
            "TIER",
            {
                "TIER_ID": speaker,
                "LINGUISTIC_TYPE_REF": "transcription",
                "PARTICIPANT": speaker,
            },
        )
        word_tier = ET.SubElement(
            root,
            "TIER",
            {
                "TIER_ID": f"{speaker}_words",
                "LINGUISTIC_TYPE_REF": "word",
                "PARTICIPANT": speaker,
            },
        )
        for seg in speaker_segments:
            annotation = ET.SubElement(tier, "ANNOTATION")
            alignable = ET.SubElement(
                annotation,
                "ALIGNABLE_ANNOTATION",
                {
                    "ANNOTATION_ID": f"a{annotation_id}",
                    "TIME_SLOT_REF1": get_time_slot_id(seg.start),
                    "TIME_SLOT_REF2": get_time_slot_id(seg.end),
                },
            )
            annotation_id += 1
            value = ET.SubElement(alignable, "ANNOTATION_VALUE")
            value.text = seg.text

            if seg.words:
                for word in seg.words:
                    word_annotation = ET.SubElement(word_tier, "ANNOTATION")
                    word_alignable = ET.SubElement(
                        word_annotation,
                        "ALIGNABLE_ANNOTATION",
                        {
                            "ANNOTATION_ID": f"a{annotation_id}",
                            "TIME_SLOT_REF1": get_time_slot_id(word.start),
                            "TIME_SLOT_REF2": get_time_slot_id(word.end),
                        },
                    )
                    annotation_id += 1
                    word_value = ET.SubElement(word_alignable, "ANNOTATION_VALUE")
                    word_value.text = word.word

    xml = ET.tostring(root, encoding="utf-8")
    pretty = minidom.parseString(xml).toprettyxml(indent="  ", encoding="utf-8")
    output_path.write_bytes(pretty)

