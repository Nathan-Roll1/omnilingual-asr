# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
#
# This source code is licensed under the BSD-style license found in the
# LICENSE file in the root directory of this source tree.

"""Gemini API-based speech transcription pipeline."""

from omnilingual_asr.models.inference.gemini_pipeline import (
    GeminiASRPipeline,
    GeminiTranscriptionResult,
    GeminiTranscriptSegment,
    WordTimestamp,
)

__all__ = [
    "GeminiASRPipeline",
    "GeminiTranscriptionResult",
    "GeminiTranscriptSegment",
    "WordTimestamp",
]
