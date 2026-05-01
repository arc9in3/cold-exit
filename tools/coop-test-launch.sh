#!/usr/bin/env bash
# Coop two-browser launcher. Opens Chrome twice, side-by-side, with
# separate user-data-dirs so each is a clean session that won't share
# localStorage / WebSocket state with the other. Window 1 is your
# "host" (normal profile), Window 2 is the "joiner" (incognito-style
# clean profile).
#
# Usage:
#   ./tools/coop-test-launch.sh                 # uses prod URL
#   ./tools/coop-test-launch.sh staging         # https://<latest>.cold-exit.pages.dev
#   ./tools/coop-test-launch.sh local           # http://localhost:8080
#
# Requires Chrome installed. Resolves the binary across Windows / Mac /
# Linux automatically.

set -euo pipefail

URL_BASE="${1:-prod}"
case "$URL_BASE" in
  prod)
    URL='https://cold-exit.pages.dev/?coop=1'
    ;;
  local)
    URL='http://localhost:8080/?coop=1'
    ;;
  http*://*)
    # User passed a literal URL.
    URL="${URL_BASE}"
    ;;
  *)
    # Treat as a Pages preview hash.
    URL="https://${URL_BASE}.cold-exit.pages.dev/?coop=1"
    ;;
esac

# Locate the Chrome binary.
locate_chrome() {
  if [ -n "${CHROME_BIN:-}" ] && [ -x "$CHROME_BIN" ]; then
    echo "$CHROME_BIN"; return
  fi
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
      for p in \
        "/c/Program Files/Google/Chrome/Application/chrome.exe" \
        "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
        "$LOCALAPPDATA/Google/Chrome/Application/chrome.exe"
      do
        [ -x "$p" ] && echo "$p" && return
      done
      ;;
    Darwin)
      echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      return
      ;;
    *)
      for c in google-chrome chromium chromium-browser; do
        if command -v "$c" >/dev/null 2>&1; then echo "$c"; return; fi
      done
      ;;
  esac
  echo "ERROR: Chrome binary not found. Set CHROME_BIN to override." >&2
  exit 1
}

CHROME=$(locate_chrome)
TMPDIR_BASE="${TMPDIR:-/tmp}"
HOST_PROFILE="$TMPDIR_BASE/cold-exit-coop-host"
JOIN_PROFILE="$TMPDIR_BASE/cold-exit-coop-joiner"

mkdir -p "$HOST_PROFILE" "$JOIN_PROFILE"

# Window placement — assumes a 1920×1080 monitor; adjust by editing
# --window-position / --window-size.  Both windows pop up at 800×900,
# stacked left/right.
HOST_GEOM="--window-position=0,40 --window-size=900,1000"
JOIN_GEOM="--window-position=920,40 --window-size=900,1000"

# Common flags. --no-first-run skips the welcome flow on a fresh
# profile dir. --disable-features=Translate avoids the translation
# popup. --new-window forces independent windows even if a Chrome
# is already running.
COMMON_FLAGS=(
  --no-first-run
  --no-default-browser-check
  --disable-features=Translate
  --new-window
)

echo "Launching coop test on: $URL"
echo "  host  profile: $HOST_PROFILE"
echo "  joiner profile: $JOIN_PROFILE"

"$CHROME" \
  "${COMMON_FLAGS[@]}" \
  --user-data-dir="$HOST_PROFILE" \
  $HOST_GEOM \
  "$URL" &

# Tiny stagger so the second window doesn't fight the first for
# display focus.
sleep 0.5

"$CHROME" \
  "${COMMON_FLAGS[@]}" \
  --incognito \
  --user-data-dir="$JOIN_PROFILE" \
  $JOIN_GEOM \
  "$URL" &

echo "Both windows launched. The HOST window is on the left; click"
echo "'Host new room', then copy the URL it puts in your clipboard"
echo "into the JOIN window (right). Or just paste the 6-char code."
