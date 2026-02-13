# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
#
# This source code is licensed under the BSD-style license found in the
# LICENSE file in the root directory of this source tree.

"""Gemini-based diarization and transcription pipeline."""

from omnilingual_asr.diarization.pipeline import (
    DiarizedTranscriptSegment,
    GeminiDiarizedTranscriptionPipeline,
    WordTimestamp,
)

__all__ = [
    "DiarizedTranscriptSegment",
    "GeminiDiarizedTranscriptionPipeline",
    "WordTimestamp",
]