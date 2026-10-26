#!/bin/sh
# Downloads a whisper.cpp model for the walkthrough's local speech-to-text (D136), outside the
# repository, and prints the line for .env.local. Needs `brew install whisper-cpp ffmpeg`.
#
#   pnpm whisper-model              large-v3-turbo, about 1.6 GB: best on design words and languages
#   pnpm whisper-model small.en     about 470 MB, English only
set -eu

name="${1:-large-v3-turbo}"
dir="${XDG_CACHE_HOME:-$HOME/.cache}/pinch-whisper"
file="$dir/ggml-$name.bin"

mkdir -p "$dir"
if [ ! -s "$file" ]; then
  echo "Downloading ggml-$name.bin from huggingface.co/ggerganov/whisper.cpp"
  curl -fL --retry 3 -C - -o "$file.part" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$name.bin"
  mv "$file.part" "$file"
fi

command -v whisper-cli >/dev/null || echo "whisper-cli is missing: brew install whisper-cpp"
command -v ffmpeg >/dev/null || echo "ffmpeg is missing: brew install ffmpeg"
echo "Add to .env.local, then restart pnpm dev:"
echo "PINCH_WHISPER_MODEL=$file"
