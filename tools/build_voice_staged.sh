#!/bin/bash
# Build a BreezyVoice pack a little at a time, so the Mac stays usable while it runs.
# Each stage renders up to 120 clips in its own process (all memory is returned when it exits),
# then waits before the next. Stop it any time with Ctrl-C; running it again resumes.
#
#   tools/build_voice_staged.sh <reference.wav> "<what is said in it>" [pack name] [seconds between stages]
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BV="$HOME/.cache/zika-voice/bv"
WAV="${1:?reference recording}"; TEXT="${2:?transcript of the recording}"; OUT="${3:-audio-me}"; PAUSE="${4:-45}"
cd "$BV/BreezyVoice" || exit 1
export PYTHONUTF8=1
while true; do
  nice -n 12 "$BV/env/bin/python" -u "$REPO/tools/build_voice_pack_breezy.py" --prompt-wav "$WAV" --prompt-text "$TEXT" --out "$OUT" --verify 2>&1 \
    | grep -v -E "Warning|warn|transformers\]|^\s*$|WETEXT|wetext|ttsfrd|%\||deprecate|set_audio_backend|istft|^model "
  code=${PIPESTATUS[0]}
  [ "$code" -eq 3 ] || break          # 3 = more clips to render
  sleep "$PAUSE"
done
exit "$code"
