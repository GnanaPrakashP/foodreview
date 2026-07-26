#!/usr/bin/env bash
#
# One-shot runner for the CircleBites dev build on the physical phone.
#
# Wraps `npm run mobile:reinstall:phone` with the env this device needs, and
# — the reason this exists — resolves the adb device state BEFORE handing off,
# so a phone that is merely locked or still enumerating no longer surfaces as
# the reinstall script's "No Android device is connected", which reads as a
# unplugged cable and sends you looking in the wrong place.
#
#   ./run-phone.sh                 # default device, port, API URL
#   ./run-phone.sh --clear-data    # any extra flags pass through to the reinstaller
#
# Overridable without editing this file:
#   DEVICE=... PORT=... API_BASE_URL=... HOME_LIST_ENGINE=... ./run-phone.sh
#
set -euo pipefail

DEVICE="${DEVICE:-ZA223JVWG7}"
PORT="${PORT:-8082}"
HOME_LIST_ENGINE="${HOME_LIST_ENGINE:-flashlist}"
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3025}"
ADB="${ADB:-/opt/homebrew/share/android-commandlinetools/platform-tools/adb}"
WAIT_SECONDS="${WAIT_SECONDS:-45}"

cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ ! -x "$ADB" ]]; then
  echo "adb not found at: $ADB" >&2
  echo "Set ADB=/path/to/adb and re-run." >&2
  exit 1
fi

# `adb devices` prints one "<serial>\t<state>" row per device. Anything other
# than "device" (unauthorized / offline / authorizing / no permissions) means
# the reinstaller will refuse, so name the state instead of guessing.
device_state() {
  "$ADB" devices 2>/dev/null | awk -v serial="$DEVICE" '$1 == serial { print $2; found = 1 }
    END { if (!found) print "absent" }'
}

report() {
  case "$1" in
    unauthorized)
      echo "  -> $DEVICE is connected but NOT authorized."
      echo "     Unlock the phone; accept 'Allow USB debugging?' (tick 'Always allow')."
      ;;
    offline|authorizing)
      echo "  -> $DEVICE is connected but not ready yet (state: $1)."
      echo "     Usually finishes on its own; if it sticks, reseat the USB-C cable."
      ;;
    "no")
      echo "  -> $DEVICE reports 'no permissions' — another process is holding the USB interface."
      ;;
    absent)
      echo "  -> $DEVICE is not on the bus at all."
      echo "     Check the cable is a data cable and USB mode is not 'charging only'."
      ;;
  esac
}

state="$(device_state)"

if [[ "$state" != "device" ]]; then
  echo "Waiting for $DEVICE (current state: $state)"
  report "$state"
  echo
  deadline=$(( SECONDS + WAIT_SECONDS ))
  last="$state"
  while [[ "$state" != "device" && $SECONDS -lt $deadline ]]; do
    sleep 1
    state="$(device_state)"
    if [[ "$state" != "$last" ]]; then
      echo "  state -> $state"
      last="$state"
    fi
  done
fi

if [[ "$state" != "device" ]]; then
  echo >&2
  echo "Gave up after ${WAIT_SECONDS}s. $DEVICE is still '$state'." >&2
  echo "Full adb view:" >&2
  "$ADB" devices -l >&2
  exit 1
fi

model="$("$ADB" -s "$DEVICE" shell getprop ro.product.model 2>/dev/null | tr -d '\r')"
echo "Device ready: $DEVICE (${model:-unknown model})"
echo "Metro port:   $PORT"
echo "API base:     $API_BASE_URL"
echo "List engine:  $HOME_LIST_ENGINE"
echo

EXPO_PUBLIC_HOME_LIST_ENGINE="$HOME_LIST_ENGINE" \
EXPO_PUBLIC_API_BASE_URL="$API_BASE_URL" \
exec npm run mobile:reinstall:phone -- \
  --device "$DEVICE" \
  --port "$PORT" \
  "$@"
