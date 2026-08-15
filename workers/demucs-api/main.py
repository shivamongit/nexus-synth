"""
Track Rack Demucs API — GPU/CPU stem separation backend.

Setup:
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8765

Then set in nexus-synth .env:
  VITE_STEM_API_URL=http://localhost:8765
"""

from __future__ import annotations

import asyncio
import base64
import io
import shutil
import subprocess
import tempfile
import uuid
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Track Rack Demucs API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STEM_NAMES = ("vocals", "drums", "bass", "other")
MAX_DURATION_SEC = 360

_models: dict[str, object] = {}
_device: str | None = None
_executor = ThreadPoolExecutor(max_workers=1)
_jobs: dict[str, dict] = {}

MODES = {
    "fast": {"model": "htdemucs", "shifts": 0, "overlap": 0.1},
    "quality": {"model": "htdemucs_ft", "shifts": 1, "overlap": 0.25},
}

# Vocals always extracted with the fine-tuned model — best open-source vocal isolation
VOCALS_HQ = {"model": "htdemucs_ft", "shifts": 1, "overlap": 0.25}


def _pick_device() -> str:
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _apply_demucs(wav, device, cfg):
    import torch
    from demucs.apply import apply_model

    model, _, _ = get_demucs_for_cfg(cfg)
    with torch.no_grad():
        return apply_model(
            model,
            wav[None].to(device),
            device=device,
            shifts=cfg["shifts"],
            overlap=cfg["overlap"],
            progress=False,
        )[0], model


def get_demucs_for_cfg(cfg: dict):
    global _device
    model_name = cfg["model"]
    if _device is None:
        _device = _pick_device()
    if model_name not in _models:
        import torch
        from demucs.pretrained import get_model

        model = get_model(model_name)
        model.to(_device)
        model.eval()
        _models[model_name] = model
    return _models[model_name], _device, cfg


def get_demucs(mode: str = "fast"):
    cfg = MODES.get(mode, MODES["fast"])
    model, device, _ = get_demucs_for_cfg(cfg)
    return model, device, cfg


def _vocals_index(model) -> int:
    return list(model.sources).index("vocals")


def _replace_vocals_hq(wav, device, sources, main_model):
    """Re-run Demucs fine-tuned pass for vocals only — keeps audio + MIDI source clean."""
    if main_model is get_demucs_for_cfg(VOCALS_HQ)[0] and VOCALS_HQ["shifts"] >= MODES["quality"]["shifts"]:
        return sources
    vcfg = VOCALS_HQ
    vsources, vmodel = _apply_demucs(wav, device, vcfg)
    out = list(sources)
    out[_vocals_index(main_model)] = vsources[_vocals_index(vmodel)]
    return out


def load_audio(path: Path) -> tuple[object, int]:
    """Decode MP3/WAV/M4A without torchaudio (uses miniaudio, then ffmpeg)."""
    import numpy as np
    import torch

    try:
        import miniaudio

        decoded = miniaudio.decode_file(
            str(path),
            output_format=miniaudio.SampleFormat.FLOAT32,
            nchannels=1,
            sample_rate=44100,
        )
        audio = np.asarray(decoded.samples, dtype=np.float32)
        max_samples = MAX_DURATION_SEC * 44100
        if audio.shape[0] > max_samples:
            audio = audio[:max_samples]
        return torch.from_numpy(audio).unsqueeze(0), 44100
    except Exception as miniaudio_err:
        if not shutil.which("ffmpeg"):
            raise RuntimeError(
                f"Could not decode audio ({miniaudio_err}). "
                "Install ffmpeg: brew install ffmpeg"
            ) from miniaudio_err

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = Path(tmp.name)

    try:
        proc = subprocess.run(
            [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(path),
                "-ac", "1", "-ar", "44100",
                "-t", str(MAX_DURATION_SEC),
                str(wav_path),
            ],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            detail = proc.stderr.strip() or "ffmpeg could not decode this file"
            raise RuntimeError(detail)

        with wave.open(str(wav_path), "rb") as wf:
            sr = wf.getframerate()
            frames = wf.readframes(wf.getnframes())
            audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0

        return torch.from_numpy(audio).unsqueeze(0), sr
    finally:
        wav_path.unlink(missing_ok=True)


def float32_to_wav_bytes(samples, sample_rate: int) -> bytes:
    import numpy as np

    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def _check_cancelled(job_id: str) -> None:
    job = _jobs.get(job_id)
    if job and job.get("status") == "cancelled":
        raise InterruptedError("Cancelled by user")


def _run_separation(job_id: str, file_bytes: bytes, filename: str | None, mode: str) -> None:
    job = _jobs[job_id]
    try:
        _check_cancelled(job_id)
        job["phase"] = "loading model"
        job["progress"] = 0.05
        _, device, cfg = get_demucs(mode)

        with tempfile.TemporaryDirectory() as tmp:
            in_path = Path(tmp) / (filename or "upload.mp3")
            in_path.write_bytes(file_bytes)

            job["phase"] = "decoding audio"
            job["progress"] = 0.1
            _check_cancelled(job_id)
            wav, sr = load_audio(in_path)
            if wav.shape[0] == 1:
                wav = wav.repeat(2, 1)

            duration = wav.shape[1] / sr
            job["phase"] = f"separating ({int(duration)}s track)"
            job["progress"] = 0.15

            ref = wav.mean(0)
            wav = (wav - ref.mean()) / (ref.std() + 1e-8)

            sources, model = _apply_demucs(wav, device, cfg)

            job["phase"] = "isolating vocals (HQ)"
            job["progress"] = 0.82
            _check_cancelled(job_id)
            sources = _replace_vocals_hq(wav, device, sources, model)

            job["phase"] = "encoding stems"
            job["progress"] = 0.9
            _check_cancelled(job_id)

            stems_out: dict[str, str] = {}
            source_list = list(sources)
            model, _, _ = get_demucs_for_cfg(cfg)
            for i, name in enumerate(model.sources):
                if name not in STEM_NAMES:
                    continue
                stem = source_list[i].mean(0).cpu().numpy()
                wav_bytes = float32_to_wav_bytes(stem, sr)
                stems_out[name] = base64.b64encode(wav_bytes).decode("ascii")

            job["status"] = "done"
            job["progress"] = 1.0
            job["result"] = {
                "sample_rate": int(sr),
                "stems": stems_out,
                "mode": mode,
                "model": cfg["model"],
                "vocals_hq": True,
            }
    except InterruptedError:
        job["status"] = "cancelled"
        job["error"] = "Cancelled by user"
    except Exception as exc:
        job["status"] = "error"
        job["error"] = str(exc)


@app.get("/health")
def health():
    try:
        _, device, cfg = get_demucs("fast")
        return {"ok": True, "model": cfg["model"], "device": device, "modes": list(MODES)}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/separate")
async def separate(file: UploadFile = File(...), mode: str = "fast"):
    if mode not in MODES:
        mode = "fast"
    job_id = str(uuid.uuid4())
    data = await file.read()
    _jobs[job_id] = {
        "status": "processing",
        "phase": "queued",
        "progress": 0.0,
        "mode": mode,
        "result": None,
        "error": None,
    }
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, _run_separation, job_id, data, file.filename, mode)
    return {"job_id": job_id, "mode": mode}


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "status": job["status"],
        "phase": job.get("phase", ""),
        "progress": job.get("progress", 0),
        "error": job.get("error"),
    }


@app.delete("/jobs/{job_id}")
def cancel_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job["status"] = "cancelled"
    job["error"] = "Cancelled by user"
    return {"ok": True}


@app.get("/jobs/{job_id}/result")
def job_result(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] == "error":
        raise HTTPException(status_code=500, detail=job.get("error") or "Separation failed")
    if job["status"] != "done" or not job.get("result"):
        raise HTTPException(status_code=202, detail="Still processing")
    return job["result"]
