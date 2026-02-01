# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
#
# This source code is licensed under the BSD-style license found in the
# LICENSE file in the root directory of this source tree.

"""Omnilingual ASR - Speech transcription using Gemini API."""

__version__ = "0.2.0"

# Export main components
from omnilingual_asr.diarization import GeminiDiarizedTranscriptionPipeline
from omnilingual_asr.models.inference import (
    GeminiASRPipeline,
    GeminiTranscriptionResult,
    GeminiTranscriptSegment,
)

__all__ = [
    "__version__",
    "GeminiASRPipeline",
    "GeminiTranscriptionResult",
    "GeminiTranscriptSegment",
    "GeminiDiarizedTranscriptionPipeline",
]
