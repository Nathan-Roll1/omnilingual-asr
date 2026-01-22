from omnilingual_asr.diarization.pipeline import (
    DiarizationSegment,
    merge_adjacent_segments,
    split_segment,
)


def test_merge_adjacent_segments_same_speaker():
    segments = [
        DiarizationSegment(0.0, 1.0, "SPEAKER_0"),
        DiarizationSegment(1.05, 2.0, "SPEAKER_0"),
        DiarizationSegment(2.5, 3.0, "SPEAKER_1"),
    ]
    merged = merge_adjacent_segments(segments, max_gap_seconds=0.1)
    assert merged == [
        DiarizationSegment(0.0, 2.0, "SPEAKER_0"),
        DiarizationSegment(2.5, 3.0, "SPEAKER_1"),
    ]


def test_split_segment():
    segment = DiarizationSegment(0.0, 12.0, "SPEAKER_0")
    split = split_segment(segment, max_duration_seconds=5.0)
    assert split == [
        DiarizationSegment(0.0, 5.0, "SPEAKER_0"),
        DiarizationSegment(5.0, 10.0, "SPEAKER_0"),
        DiarizationSegment(10.0, 12.0, "SPEAKER_0"),
    ]

