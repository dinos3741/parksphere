#!/bin/bash
# Builds and installs the app on a connected iPhone in Release configuration — the config used for
# field-testing (Debug needs Metro attached; no RNBG license needed since Release doesn't require it).
set -euo pipefail
cd "$(dirname "$0")"

npx expo run:ios --device --configuration Release
