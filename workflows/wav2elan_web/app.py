from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import uuid
import zipfile
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

from omnilingual_asr.diarization import DiarizedTranscriptionPipeline

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR = BASE_DIR / "uploads"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Wav2ELAN")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

_pipeline: DiarizedTranscriptionPipeline | None = None
HISTORY: dict[str, dict[str, Any]] = {}
HISTORY_ORDER: list[str] = []


def _get_pipeline() -> DiarizedTranscriptionPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = DiarizedTranscriptionPipeline()
    return _pipeline


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _store_history(entry: dict[str, Any]) -> dict[str, Any]:
    history_id = uuid.uuid4().hex
    entry["id"] = history_id
    entry["created_at"] = _now_iso()
    HISTORY[history_id] = entry
    HISTORY_ORDER.insert(0, history_id)
    return entry


def _is_audio_file(path: Path) -> bool:
    return path.suffix.lower() in {".wav", ".mp3", ".flac", ".ogg", ".m4a"}


def _safe_extract_zip(zip_path: Path, dest_dir: Path) -> list[tuple[Path, str]]:
    extracted: list[tuple[Path, str]] = []
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            member_path = Path(info.filename)
            if ".." in member_path.parts or member_path.is_absolute():
                continue
            target = dest_dir / member_path
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, target.open("wb") as dst:
                dst.write(src.read())
            if _is_audio_file(target):
                extracted.append((target, member_path.as_posix()))
    return extracted


def _save_upload(file: UploadFile, dest_dir: Path) -> tuple[Path, str]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing file name.")
    ext = Path(file.filename).suffix.lower()
    if ext not in {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".zip"}:
        raise HTTPException(status_code=400, detail="Unsupported file type.")
    output_name = f"{uuid.uuid4().hex}{ext}"
    output_path = dest_dir / output_name
    content = file.file.read()
    output_path.write_bytes(content)
    return output_path, file.filename


def _run_transcription(audio_path: Path) -> list[dict[str, Any]]:
    pipeline = _get_pipeline()
    segments = pipeline.transcribe(
        str(audio_path),
        word_timestamps=True,
    )
    return [
        {
            "start": seg.start,
            "end": seg.end,
            "speaker": seg.speaker,
            "text": seg.text,
            "words": [
                {"word": w.word, "start": w.start, "end": w.end}
                for w in (seg.words or [])
            ],
        }
        for seg in segments
    ]


@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)) -> JSONResponse:
    """Non-streaming endpoint for simple clients."""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    output_path, display_name = _save_upload(file, UPLOAD_DIR)
    if output_path.suffix.lower() == ".zip":
        raise HTTPException(status_code=400, detail="Use batch endpoint for zip uploads.")

    entry = _store_history(
        {
            "audio_url": f"/uploads/{output_path.name}",
            "file_name": display_name,
            "segments": _run_transcription(output_path),
        }
    )
    return JSONResponse(entry)


@app.post("/api/transcribe-stream")
async def transcribe_stream(file: UploadFile = File(...)) -> EventSourceResponse:
    """Streaming endpoint that reports progress via SSE."""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    output_path, display_name = _save_upload(file, UPLOAD_DIR)
    if output_path.suffix.lower() == ".zip":
        raise HTTPException(status_code=400, detail="Use batch endpoint for zip uploads.")

    async def event_generator():
        loop = asyncio.get_event_loop()
        progress_queue: asyncio.Queue[tuple[str, int]] = asyncio.Queue()

        def progress_callback(step: str, idx: int) -> None:
            loop.call_soon_threadsafe(progress_queue.put_nowait, (step, idx))

        async def run_transcription():
            pipeline = _get_pipeline()
            return await loop.run_in_executor(
                None,
                lambda: pipeline.transcribe(
                    str(output_path),
                    word_timestamps=True,
                    progress_callback=progress_callback,
                ),
            )

        task = asyncio.create_task(run_transcription())

        while not task.done():
            try:
                step, idx = await asyncio.wait_for(progress_queue.get(), timeout=0.1)
                yield {
                    "event": "progress",
                    "data": json.dumps({"step": step, "index": idx, "file_name": display_name}),
                }
            except asyncio.TimeoutError:
                continue

        while not progress_queue.empty():
            step, idx = await progress_queue.get()
            yield {
                "event": "progress",
                "data": json.dumps({"step": step, "index": idx, "file_name": display_name}),
            }

        segments = await task
        entry = _store_history(
            {
                "audio_url": f"/uploads/{output_path.name}",
                "file_name": display_name,
                "segments": [
                    {
                        "start": seg.start,
                        "end": seg.end,
                        "speaker": seg.speaker,
                        "text": seg.text,
                        "words": [
                            {"word": w.word, "start": w.start, "end": w.end}
                            for w in (seg.words or [])
                        ],
                    }
                    for seg in segments
                ],
            }
        )
        yield {"event": "result", "data": json.dumps(entry)}

    return EventSourceResponse(event_generator())


@app.post("/api/transcribe-batch-stream")
async def transcribe_batch_stream(files: list[UploadFile] = File(...)) -> EventSourceResponse:
    """Streaming endpoint for multiple files/folders/zip."""
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    batch_id = uuid.uuid4().hex
    batch_dir = UPLOAD_DIR / batch_id
    batch_dir.mkdir(parents=True, exist_ok=True)

    audio_files: list[tuple[Path, str]] = []
    for f in files:
        saved_path, display_name = _save_upload(f, batch_dir)
        if saved_path.suffix.lower() == ".zip":
            audio_files.extend(_safe_extract_zip(saved_path, batch_dir))
        elif _is_audio_file(saved_path):
            audio_files.append((saved_path, display_name))

    if not audio_files:
        raise HTTPException(status_code=400, detail="No supported audio files found.")

    async def event_generator():
        loop = asyncio.get_event_loop()
        progress_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        def progress_callback(step: str, idx: int, file_index: int, file_count: int, file_name: str) -> None:
            loop.call_soon_threadsafe(
                progress_queue.put_nowait,
                {
                    "step": step,
                    "index": idx,
                    "file_index": file_index,
                    "file_count": file_count,
                    "file_name": file_name,
                },
            )

        async def run_transcription() -> list[dict[str, Any]]:
            pipeline = _get_pipeline()
            results: list[dict[str, Any]] = []
            file_count = len(audio_files)
            for i, (audio_path, display_name) in enumerate(audio_files):
                file_name = display_name

                def cb(step: str, idx: int) -> None:
                    progress_callback(step, idx, i, file_count, file_name)

                segments = await loop.run_in_executor(
                    None,
                    lambda: pipeline.transcribe(
                        str(audio_path),
                        word_timestamps=True,
                        progress_callback=cb,
                    ),
                )
                entry = _store_history(
                    {
                        "file_name": display_name,
                        "audio_url": f"/uploads/{batch_id}/{audio_path.name}",
                        "segments": [
                            {
                                "start": seg.start,
                                "end": seg.end,
                                "speaker": seg.speaker,
                                "text": seg.text,
                                "words": [
                                    {"word": w.word, "start": w.start, "end": w.end}
                                    for w in (seg.words or [])
                                ],
                            }
                            for seg in segments
                        ],
                    }
                )
                results.append(entry)
            return results

        task = asyncio.create_task(run_transcription())

        while not task.done():
            try:
                payload = await asyncio.wait_for(progress_queue.get(), timeout=0.1)
                yield {"event": "progress", "data": json.dumps(payload)}
            except asyncio.TimeoutError:
                continue

        while not progress_queue.empty():
            payload = await progress_queue.get()
            yield {"event": "progress", "data": json.dumps(payload)}

        results = await task
        yield {"event": "result", "data": json.dumps({"results": results})}

    return EventSourceResponse(event_generator())


@app.get("/api/history")
async def list_history() -> JSONResponse:
    items = [
        {
            "id": history_id,
            "file_name": HISTORY[history_id]["file_name"],
            "created_at": HISTORY[history_id]["created_at"],
        }
        for history_id in HISTORY_ORDER
        if history_id in HISTORY
    ]
    return JSONResponse(items)


@app.get("/api/history/{history_id}")
async def get_history(history_id: str) -> JSONResponse:
    if history_id not in HISTORY:
        raise HTTPException(status_code=404, detail="History entry not found.")
    return JSONResponse(HISTORY[history_id])


@app.put("/api/history/{history_id}")
async def update_history(history_id: str, payload: dict[str, Any] = Body(...)) -> JSONResponse:
    if history_id not in HISTORY:
        raise HTTPException(status_code=404, detail="History entry not found.")
    updated = HISTORY[history_id]
    if "file_name" in payload:
        updated["file_name"] = payload["file_name"]
    if "segments" in payload:
        updated["segments"] = payload["segments"]
    HISTORY[history_id] = updated
    return JSONResponse(updated)


@app.delete("/api/history/{history_id}")
async def delete_history(history_id: str) -> JSONResponse:
    if history_id in HISTORY:
        HISTORY.pop(history_id)
    if history_id in HISTORY_ORDER:
        HISTORY_ORDER.remove(history_id)
    return JSONResponse({"ok": True})
