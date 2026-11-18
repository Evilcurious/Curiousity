"""CPU-first Whisper runner. It prints only timestamped caption JSON to stdout."""
import argparse
import json
import os
from pathlib import Path

from faster_whisper import WhisperModel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--translate", action="store_true")
    parser.add_argument("--chunks", type=int, help="duration of prepared audio segments in seconds")
    args = parser.parse_args()
    device = os.getenv("WHISPER_DEVICE", "cpu")
    threads = max(1, min(16, int(os.getenv("WHISPER_CPU_THREADS", "4"))))
    model = WhisperModel(
        os.getenv("WHISPER_MODEL", "base"),
        device=device,
        compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8" if device == "cpu" else "float16"),
        cpu_threads=threads,
        download_root=os.getenv("WHISPER_CACHE") or None,
    )
    task = "translate" if args.translate else "transcribe"
    files = sorted(args.path.glob("audio-*.mp3")) if args.chunks else [args.path]
    cues, language = [], None
    for index, audio in enumerate(files):
        offset = index * (args.chunks or 0)
        segments, info = model.transcribe(str(audio), task=task, vad_filter=True, word_timestamps=True, beam_size=3)
        for segment in segments:
            language = language or info.language
            group = []
            for word in segment.words or []:
                value = word.word.strip()
                if not value:
                    continue
                group.append(word)
                if len(group) >= 6 or word.end - group[0].start >= 3.2 or value[-1] in '.?!':
                    cues.append(pack(group, offset))
                    group = []
            if group:
                cues.append(pack(group, offset))
            if not segment.words and segment.text.strip():
                cues.append({"start": offset + segment.start, "end": offset + segment.end, "text": segment.text.strip()})
    print(json.dumps({"cues": cues, "language": "en" if args.translate else language}, ensure_ascii=True))


def pack(words, offset):
    return {"start": offset + words[0].start, "end": offset + words[-1].end, "text": "".join(w.word for w in words).strip()}


if __name__ == "__main__":
    main()
