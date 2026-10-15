#!/usr/bin/env bash
#
# Rebuilds src/sena/ -- SENA's wallet logic compiled to WebAssembly -- from a
# SENA checkout, so the wallet signs with exactly the code the node verifies.
#
# Usage: scripts/update-sena-wasm.sh [path/to/SENA]   (default: ../SENA)

set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
SENA=${1:-$HERE/../SENA}
"$SENA/scripts/build-wasm.sh" "$HERE/src/sena"
(cd "$SENA" && git rev-parse HEAD) > "$HERE/src/sena/SENA_REVISION"
echo "src/sena updated from SENA $(cat "$HERE/src/sena/SENA_REVISION")"
