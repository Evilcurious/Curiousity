"""CPU-first Whisper runner. It prints only timestamped caption JSON to stdout."""
import json
import os
import sys

from faster_whisper import WhisperModel


def main():
    device = os.getenv("WHISPER_DEVICE", "cpu")
    threads = max(1, min(16, int(os.getenv("WHISPER_CPU_THREADS", "4"))))
    model = WhisperModel(
        os.getenv("WHISPER_MODEL", "base"),
        device=device,
        compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8" if device == "cpu" else "float16"),
        cpu_threads=threads,
        download_root=os.getenv("WHISPER_CACHE") or None,
    )
    task = "translate" if "--translate" in sys.argv[2:] else "transcribe"
    segments, info = model.transcribe(sys.argv[1], task=task, vad_filter=True, word_timestamps=True, beam_size=3)
    cues = []
    for segment in segments:
        group = []
        for word in segment.words or []:
            value = word.word.strip()
            if not value:
                continue
            group.append(word)
            if len(group) >= 6 or word.end - group[0].start >= 3.2 or value[-1] in '.?!':
                cues.append(pack(group))
                group = []
        if group:
            cues.append(pack(group))
        if not segment.words and segment.text.strip():
            cues.append({"start": segment.start, "end": segment.end, "text": segment.text.strip()})
    print(json.dumps({"cues": cues, "language": "en" if task == "translate" else info.language}, ensure_ascii=True))


def pack(words):
    return {"start": words[0].start, "end": words[-1].end, "text": "".join(w.word for w in words).strip()}


if __name__ == "__main__":
    main()
