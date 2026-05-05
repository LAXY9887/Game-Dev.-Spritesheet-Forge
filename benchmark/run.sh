#!/usr/bin/env bash
# spritesheet-forge-mcp Benchmark
#
# Usage:
#   export SPRITESHEET_TOKEN="your_bearer_token"
#   bash benchmark/run.sh
#
# Optional:
#   export SPRITESHEET_BASE_URL="https://your-instance.example.com"

BASE_URL="${SPRITESHEET_BASE_URL:-https://mcp.clawstudiouo.com}"
TOKEN="${SPRITESHEET_TOKEN:-}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES="$DIR/fixtures"
RESULTS="$DIR/results"

GRN='\033[0;32m'; RED='\033[0;31m'; YEL='\033[1;33m'; BLD='\033[1m'; NC='\033[0m'

pass=0; fail=0
declare -a rows=()
LAST_URL=""

# ── Helpers ───────────────────────────────────────────────────────────────────

now_ms() { python3 -c "import time; print(int(time.time()*1000))"; }

# mcp_call <tool_name> <args_json_file>
# Reads args JSON from a temp file to avoid shell quoting issues with large payloads
mcp_call() {
  local name="$1" args_file="$2"
  local args; args=$(cat "$args_file")
  printf '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"%s","arguments":%s},"id":1}' \
    "$name" "$args" \
  | curl -s -X POST "$BASE_URL/mcp" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d @-
}

do_upload() {  # do_upload <path> <mime>  →  prints url or empty
  curl -s -X POST "$BASE_URL/upload" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@$1;type=$2" \
  | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('url',''))
except Exception:
    print('')
" || true
}

# check <label> <response_json> <ms>
# Prints result line, updates pass/fail counters, sets LAST_URL
check() {
  local label="$1" resp="$2" ms="$3"
  local url err

  url=$(printf '%s' "$resp" | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    c = json.loads(r['result']['content'][0]['text'])
    print(c.get('url',''))
except Exception:
    print('')
" 2>/dev/null || true)

  err=$(printf '%s' "$resp" | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    c = json.loads(r['result']['content'][0]['text'])
    print(c['error']['message'] if 'error' in c else '')
except Exception as e:
    print(str(e))
" 2>/dev/null || true)

  if [[ -n "$url" ]]; then
    printf "  ${GRN}✓${NC} %-52s ${BLD}%5dms${NC}\n" "$label" "$ms"
    rows+=("PASS|$label|${ms}ms|$url")
    LAST_URL="$url"
    pass=$((pass+1))
  else
    printf "  ${RED}✗${NC} %-52s ${BLD}%5dms${NC}  %s\n" "$label" "$ms" "${err:-unknown error}"
    rows+=("FAIL|$label|${ms}ms|${err:-unknown error}")
    LAST_URL=""
    fail=$((fail+1))
  fi
}

# json_args <key> <value> [<key2> <value2> ...]  →  writes JSON to $ARGS_FILE
ARGS_FILE=$(mktemp)
trap 'rm -f "$ARGS_FILE"' EXIT

json_args() {
  python3 -c "
import json, sys
args = sys.argv[1:]
d = {}
it = iter(args)
for k in it:
    v = next(it)
    try: v = int(v)
    except ValueError: pass
    d[k] = v
print(json.dumps(d))
" "$@" > "$ARGS_FILE"
}

json_args_list() {  # json_args_list <key> <val1> <val2> ...
  python3 -c "
import json, sys
key = sys.argv[1]
vals = sys.argv[2:]
print(json.dumps({key: vals}))
" "$@" > "$ARGS_FILE"
}

# ── Guard ─────────────────────────────────────────────────────────────────────
if [[ -z "$TOKEN" ]]; then
  echo "Error: SPRITESHEET_TOKEN is not set."
  echo "  export SPRITESHEET_TOKEN=\"your_bearer_token\""
  exit 1
fi
for f in "$FIXTURES/smol.gif" "$FIXTURES/beeg.gif"; do
  [[ -f "$f" ]] || { echo "Error: fixture not found: $f"; exit 1; }
done
mkdir -p "$RESULTS"

# ── Header ────────────────────────────────────────────────────────────────────
echo ""
printf "${BLD}spritesheet-forge-mcp Benchmark${NC}\n"
printf "Endpoint : %s\n" "$BASE_URL"
printf "Date     : %s UTC\n" "$(date -u '+%Y-%m-%d %H:%M')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Encode smol.gif ───────────────────────────────────────────────────────────
printf "\n${BLD}Preparing fixtures...${NC}\n"
SMOL_B64="data:image/gif;base64,$(base64 -i "$FIXTURES/smol.gif" | tr -d '\n')"
printf "  smol.gif  encoded  (%d bytes as data URI)\n" "${#SMOL_B64}"
printf "  beeg.gif  ready    (upload-only, >4 MB)\n"

# ═══════════════════════════════════════════════════════════════════════════════
# Phase 1 — Tool Coverage
# All 7 tools, smol.gif as input, tests chained via output URLs
# ═══════════════════════════════════════════════════════════════════════════════
printf "\n${BLD}Phase 1 — Tool Coverage  (smol.gif · 221 KB · 6 frames · 498×413)${NC}\n"
echo "───────────────────────────────────────────────────────────────────────────"

# 1. gif_to_spritesheet ─────────────────────────────────────────────────────────
python3 -c "import json,sys; print(json.dumps({'file':sys.argv[1]}))" "$SMOL_B64" > "$ARGS_FILE"
T=$(now_ms); R=$(mcp_call gif_to_spritesheet "$ARGS_FILE"); check "gif_to_spritesheet" "$R" "$(($(now_ms)-T))"
SS_URL="$LAST_URL"

# 2. gif_to_frames ─────────────────────────────────────────────────────────────
python3 -c "import json,sys; print(json.dumps({'file':sys.argv[1]}))" "$SMOL_B64" > "$ARGS_FILE"
T=$(now_ms); R=$(mcp_call gif_to_frames "$ARGS_FILE"); check "gif_to_frames" "$R" "$(($(now_ms)-T))"

# Tests 3–7 use SS_URL from Test 1
if [[ -z "$SS_URL" ]]; then
  printf "  ${YEL}⚠${NC}  Skipping tests 3–7: gif_to_spritesheet failed\n"
else
  # 3. split_spritesheet ───────────────────────────────────────────────────────
  python3 -c "import json,sys; print(json.dumps({
    'file':sys.argv[1],'columns':3,'rows':2,
    'output':'both','metadata_format':'json_array'
  }))" "$SS_URL" > "$ARGS_FILE"
  T=$(now_ms); R=$(mcp_call split_spritesheet "$ARGS_FILE"); check "split_spritesheet  (3×2, frames+atlas JSON)" "$R" "$(($(now_ms)-T))"

  # 4. spritesheet_to_animation ────────────────────────────────────────────────
  python3 -c "import json,sys; print(json.dumps({
    'file':sys.argv[1],'columns':3,'rows':2,'duration':120
  }))" "$SS_URL" > "$ARGS_FILE"
  T=$(now_ms); R=$(mcp_call spritesheet_to_animation "$ARGS_FILE"); check "spritesheet_to_animation  (3×2 → animated gif)" "$R" "$(($(now_ms)-T))"

  # 5. trim_png ────────────────────────────────────────────────────────────────
  python3 -c "import json,sys; print(json.dumps({'files':[sys.argv[1]],'threshold':10}))" "$SS_URL" > "$ARGS_FILE"
  T=$(now_ms); R=$(mcp_call trim_png "$ARGS_FILE"); check "trim_png" "$R" "$(($(now_ms)-T))"

  # 6. png_to_spritesheet ──────────────────────────────────────────────────────
  python3 -c "import json,sys; print(json.dumps({
    'files':[sys.argv[1],sys.argv[1]],'layout':'horizontal'
  }))" "$SS_URL" > "$ARGS_FILE"
  T=$(now_ms); R=$(mcp_call png_to_spritesheet "$ARGS_FILE"); check "png_to_spritesheet  (2-image horizontal)" "$R" "$(($(now_ms)-T))"

  # 7. frames_to_animation ─────────────────────────────────────────────────────
  python3 -c "import json,sys; print(json.dumps({
    'files':[sys.argv[1],sys.argv[1]],'duration':200,'output_format':'gif'
  }))" "$SS_URL" > "$ARGS_FILE"
  T=$(now_ms); R=$(mcp_call frames_to_animation "$ARGS_FILE"); check "frames_to_animation  (2 frames → gif)" "$R" "$(($(now_ms)-T))"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Phase 2 — Upload vs Base64 Efficiency
# Same tool (gif_to_spritesheet), three strategies, two file sizes
# ═══════════════════════════════════════════════════════════════════════════════
printf "\n${BLD}Phase 2 — Upload vs Base64 Efficiency${NC}\n"
echo "───────────────────────────────────────────────────────────────────────────"

# smol.gif — direct base64
python3 -c "import json,sys; print(json.dumps({'file':sys.argv[1]}))" "$SMOL_B64" > "$ARGS_FILE"
T=$(now_ms); R=$(mcp_call gif_to_spritesheet "$ARGS_FILE"); check "smol.gif 221 KB — direct base64" "$R" "$(($(now_ms)-T))"

# smol.gif — upload + URL
T_UP=$(now_ms)
SMOL_URL=$(do_upload "$FIXTURES/smol.gif" "image/gif")
UP_MS=$(($(now_ms)-T_UP))
if [[ -n "$SMOL_URL" ]]; then
  printf "    ${YEL}↑${NC} uploaded in %dms\n" "$UP_MS"
  python3 -c "import json,sys; print(json.dumps({'file':sys.argv[1]}))" "$SMOL_URL" > "$ARGS_FILE"
  T=$(now_ms); R=$(mcp_call gif_to_spritesheet "$ARGS_FILE"); T_TOOL=$(($(now_ms)-T))
  check "smol.gif 221 KB — upload(${UP_MS}ms) + URL" "$R" "$((UP_MS+T_TOOL))"
else
  printf "  ${RED}✗${NC} smol.gif upload failed\n"
  rows+=("FAIL|smol.gif 221KB — upload + URL|0ms|upload failed"); fail=$((fail+1))
fi

# beeg.gif — direct base64 (uses temp file to avoid ARG_MAX with 6+ MB payload)
python3 - "$FIXTURES/beeg.gif" "$ARGS_FILE" <<'PYEOF'
import sys, json, base64
with open(sys.argv[1], 'rb') as f:
    data = f.read()
uri = "data:image/gif;base64," + base64.b64encode(data).decode()
with open(sys.argv[2], 'w') as f:
    json.dump({"file": uri, "columns": 12}, f)
PYEOF
T=$(now_ms); R=$(mcp_call gif_to_spritesheet "$ARGS_FILE"); check "beeg.gif 4.7 MB — direct base64" "$R" "$(($(now_ms)-T))"

# beeg.gif — upload + URL
T_UP=$(now_ms)
BEEG_URL=$(do_upload "$FIXTURES/beeg.gif" "image/gif")
UP_MS=$(($(now_ms)-T_UP))
if [[ -n "$BEEG_URL" ]]; then
  printf "    ${YEL}↑${NC} uploaded in %dms\n" "$UP_MS"
  python3 -c "import json,sys; print(json.dumps({'file':sys.argv[1],'columns':12}))" "$BEEG_URL" > "$ARGS_FILE"
  T=$(now_ms); R=$(mcp_call gif_to_spritesheet "$ARGS_FILE"); T_TOOL=$(($(now_ms)-T))
  check "beeg.gif 4.7 MB — upload(${UP_MS}ms) + URL" "$R" "$((UP_MS+T_TOOL))"
else
  printf "  ${RED}✗${NC} beeg.gif upload failed\n"
  rows+=("FAIL|beeg.gif 4.7MB — upload + URL|0ms|upload failed"); fail=$((fail+1))
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ $fail -eq 0 ]]; then
  printf "${BLD}${GRN}ALL PASSED${NC}  "
else
  printf "${BLD}${RED}${fail} FAILED${NC}  "
fi
printf "Passed: ${GRN}${pass}${NC}  Failed: ${RED}${fail}${NC}  Total: $((pass+fail))\n\n"

# ── Write results file ────────────────────────────────────────────────────────
OUTFILE="$RESULTS/$(date -u '+%Y-%m-%d').txt"
{
  printf "spritesheet-forge-mcp Benchmark Results\n"
  printf "Date    : %s UTC\n" "$(date -u '+%Y-%m-%d %H:%M')"
  printf "Endpoint: %s\n\n" "$BASE_URL"
  printf "%-6s  %-54s  %-10s  %s\n" "STATUS" "TOOL / METHOD" "TIME" "OUTPUT URL / ERROR"
  printf "%-6s  %-54s  %-10s  %s\n" "──────" "──────────────────────────────────────────────────────" "──────────" "──────────────────────────────────────────────────────────────"
  for r in "${rows[@]}"; do
    IFS='|' read -r s l t u <<< "$r"
    printf "%-6s  %-54s  %-10s  %s\n" "$s" "$l" "$t" "$u"
  done
  printf "\nPassed: %d  Failed: %d  Total: %d\n" "$pass" "$fail" "$((pass+fail))"
} | tee "$OUTFILE"
printf "\nResults saved → %s\n\n" "$OUTFILE"
