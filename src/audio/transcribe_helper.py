#!/usr/bin/env python3
"""
Local faster-whisper runner for audio transcription with timestamped words and segments.
Outputs structured JSON to stdout.
"""

import argparse
import json
import os
import sys

def run_transcription(audio_path, model_name="large-v3", language="es", device="auto"):
    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"Audio file not found: {audio_path}"}), file=sys.stderr)
        sys.exit(1)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            json.dumps({"error": "faster-whisper is not installed in current Python environment."}),
            file=sys.stderr,
        )
        sys.exit(2)

    # Determine compute device
    compute_device = device
    compute_type = "float16"

    if device == "auto":
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count() > 0:
                compute_device = "cuda"
                compute_type = "float16"
            else:
                compute_device = "cpu"
                compute_type = "int8"
        except Exception:
            compute_device = "cpu"
            compute_type = "int8"
    elif device == "cpu":
        compute_type = "int8"

    try:
        model = WhisperModel(model_name, device=compute_device, compute_type=compute_type)
    except Exception as e:
        # Fallback to smaller model if large-v3 fails or download issues
        if model_name == "large-v3":
            try:
                model = WhisperModel("small", device=compute_device, compute_type=compute_type)
            except Exception as e2:
                print(json.dumps({"error": f"Failed to load whisper model: {e2}"}), file=sys.stderr)
                sys.exit(3)
        else:
            print(json.dumps({"error": f"Failed to load whisper model: {e}"}), file=sys.stderr)
            sys.exit(3)

    lang_param = None if (not language or language.lower() in ("auto", "none")) else language.lower()

    segments, info = model.transcribe(
        audio_path,
        language=lang_param,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
    )

    results = []
    total_words = 0

    for seg in segments:
        words = []
        if seg.words:
            for w in seg.words:
                words.append({
                    "start": round(w.start, 2),
                    "end": round(w.end, 2),
                    "word": w.word.strip(),
                    "probability": round(w.probability, 3) if hasattr(w, "probability") else 1.0,
                })

        seg_text = seg.text.strip()
        word_count = len(seg_text.split()) if seg_text else 0
        total_words += word_count
        duration = max(0.1, seg.end - seg.start)
        wpm = round((word_count / duration) * 60)

        results.append({
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": seg_text,
            "wordCount": word_count,
            "wpm": wpm,
            "avgLogprob": round(seg.avg_logprob, 3) if hasattr(seg, "avg_logprob") else 0.0,
            "words": words,
        })

    output = {
        "audioPath": audio_path,
        "language": info.language,
        "languageProbability": round(info.language_probability, 3) if hasattr(info, "language_probability") else 1.0,
        "duration": round(info.duration, 2),
        "totalWords": total_words,
        "segments": results,
    }

    print(json.dumps(output))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Local Whisper Transcriber")
    parser.add_argument("--audio", required=True, help="Path to input audio (WAV/MP3/M4A)")
    parser.add_argument("--model", default="large-v3", help="Whisper model name (default: large-v3)")
    parser.add_argument("--lang", default="es", help="Language code (default: es, or auto)")
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"], help="Compute device")

    args = parser.parse_args()
    run_transcription(args.audio, args.model, args.lang, args.device)
