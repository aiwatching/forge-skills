#!/usr/bin/env bash
#
# Prelude context sync — PULL-ONLY, idempotent.
#
# Supports both single-module and multi-module Prelude wikis.
#
# Multi-module layout produced under pages/:
#   pages/
#     index.md                    ← repo mechanical atlas
#     architecture-overview.md    ← cross-module narrative
#     <module>/
#       index.md
#       <page-id>.md …
#
# Transport is selected via PRELUDE_SOURCE:
#   file://…   — local Prelude cache (dev loop on the generator machine)
#   http(s)://… — shared context server; the script probes the Prelude API
#                 and falls back to legacy static-files layout if unavailable.
#
# Usage:
#   bash <repo>/.claude/skills/prelude/scripts/sync.sh
#
# Exit codes:
#   0 = usable context available under pages/ (freshly synced, up-to-date,
#       or stale-but-usable cache from a prior sync).
#   1 = no usable context at all.

set -u

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_PAGES="$SKILL_DIR/pages"
LOCAL_MANIFEST="$SKILL_DIR/manifest.json"
STATE_FILE="$SKILL_DIR/.sync-state.json"

CONFIG_FILE="$SKILL_DIR/config.env"
if [ -f "$CONFIG_FILE" ]; then
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
fi

DEFAULT_KEY="${PRELUDE_DEFAULT_KEY:-local__local__fortincm__en}"
PRELUDE_SOURCE="${PRELUDE_SOURCE:-file://$HOME/.prelude/wikicache/$DEFAULT_KEY}"

REPO_BRANCH=""
if command -v git >/dev/null 2>&1; then
    REPO_BRANCH="$(git -C "$SKILL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
fi

log()  { printf '[prelude-sync] %s\n' "$*" >&2; }
warn() { printf '[prelude-sync] WARN: %s\n' "$*" >&2; }
err()  { printf '[prelude-sync] ERROR: %s\n' "$*" >&2; }

staging=""
cleanup_staging() {
    [ -n "$staging" ] && [ -d "$staging" ] && rm -rf "$staging"
}
trap cleanup_staging EXIT

have_usable_cache() {
    [ -f "$LOCAL_PAGES/index.md" ]
}

fallback_or_fail() {
    local reason="$1"
    if have_usable_cache; then
        local stale_hint="(unknown)"
        if [ -f "$STATE_FILE" ]; then
            stale_hint="$(awk -F'"' '/"last_pulled"/ {print $4; exit}' "$STATE_FILE" 2>/dev/null || echo '?')"
        fi
        warn "$reason"
        warn "Using stale local cache from $stale_hint — upstream was unavailable."
        return 0
    fi
    err "$reason"
    err "No local cache to fall back to — skill will run without pre-generated context."
    return 1
}

# ---------------------------------------------------------------------------
# page_id_to_rel_path  <page_id>
#   Maps a Prelude page ID to its relative path under pages/.
#   __repo__<stem>     → <stem>.md
#   <module>__<stem>   → <module>/<stem>.md
#   index / <bare>     → <stem>.md  (legacy / repo-level fallback)
# ---------------------------------------------------------------------------
page_id_to_rel_path() {
    local pid="$1"
    case "$pid" in
        __repo__*)
            echo "${pid#__repo__}.md"
            ;;
        *__*)
            local mod="${pid%%__*}"
            local stem="${pid#*__}"
            echo "${mod}/${stem}.md"
            ;;
        *)
            echo "${pid}.md"
            ;;
    esac
}

# ---------------------------------------------------------------------------
# pull_file_source
#   Copies pages directly from a local Prelude cache directory.
#   Handles both single-module (flat pages/) and multi-module (modules/*).
# ---------------------------------------------------------------------------
pull_file_source() {
    local src_root="${PRELUDE_SOURCE#file://}"

    # Determine if this is a multi-module cache.
    local is_multi=0
    [ -d "$src_root/modules" ] && is_multi=1

    # Change-detection: use generation.yaml (multi) or manifest.json (single).
    local sig_file
    if [ $is_multi -eq 1 ]; then
        sig_file="$src_root/generation.yaml"
    else
        sig_file="$src_root/manifest.json"
    fi

    if [ ! -f "$sig_file" ]; then
        fallback_or_fail "source not found at $sig_file — has the context been generated?"
        return $?
    fi

    local src_sig
    src_sig="$(stat -f '%m:%z' "$sig_file" 2>/dev/null || stat -c '%Y:%s' "$sig_file")"

    local last_sig=""
    if [ -f "$STATE_FILE" ]; then
        last_sig="$(awk -F'"' '/"source_sig"/ {print $4; exit}' "$STATE_FILE" 2>/dev/null || echo '')"
    fi

    if [ -n "$last_sig" ] && [ "$src_sig" = "$last_sig" ] && have_usable_cache; then
        log "up to date (source unchanged: $src_sig)"
        return 0
    fi

    staging="$(mktemp -d "${SKILL_DIR}/.sync-staging.XXXXXX")"

    if [ $is_multi -eq 1 ]; then
        # Copy repo-level pages/ flat into staging/
        if [ -d "$src_root/pages" ]; then
            if command -v rsync >/dev/null 2>&1; then
                rsync -a "$src_root/pages/" "$staging/" >/dev/null || {
                    fallback_or_fail "rsync of repo pages from $src_root/pages failed"
                    return $?
                }
            else
                cp -R "$src_root/pages/." "$staging/" || {
                    fallback_or_fail "cp of repo pages from $src_root/pages failed"
                    return $?
                }
            fi
        fi
        # Copy each module's pages/ into staging/<module>/
        for mod_dir in "$src_root/modules"/*/; do
            [ -d "$mod_dir/pages" ] || continue
            local mod_name
            mod_name="$(basename "$mod_dir")"
            mkdir -p "$staging/$mod_name"
            if command -v rsync >/dev/null 2>&1; then
                rsync -a "$mod_dir/pages/" "$staging/$mod_name/" >/dev/null || {
                    warn "rsync of module $mod_name pages failed — skipping"
                }
            else
                cp -R "$mod_dir/pages/." "$staging/$mod_name/" || {
                    warn "cp of module $mod_name pages failed — skipping"
                }
            fi
        done
    else
        # Single-module: flat copy of pages/
        local src_pages="$src_root/pages"
        if [ ! -d "$src_pages" ]; then
            fallback_or_fail "source pages dir not found at $src_pages"
            return $?
        fi
        if command -v rsync >/dev/null 2>&1; then
            rsync -a --delete "$src_pages/" "$staging/" >/dev/null || {
                fallback_or_fail "rsync from $src_pages failed"
                return $?
            }
        else
            cp -R "$src_pages/." "$staging/" || {
                fallback_or_fail "cp -R from $src_pages failed"
                return $?
            }
        fi
        cp "$src_root/manifest.json" "$LOCAL_MANIFEST" 2>/dev/null || true
    fi

    # Atomic-ish promote
    rm -rf "$LOCAL_PAGES"
    mv "$staging" "$LOCAL_PAGES"
    staging=""

    local count
    count="$(find "$LOCAL_PAGES" -name '*.md' | wc -l | tr -d ' ')"

    cat >"$STATE_FILE" <<EOF
{
  "source": "$PRELUDE_SOURCE",
  "source_sig": "$src_sig",
  "pages_count": $count,
  "multi_module": $is_multi,
  "branch": "$REPO_BRANCH",
  "last_pulled": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    log "synced $count page(s) from $src_root"
    return 0
}

# ---------------------------------------------------------------------------
# pull_api_source
#   Fetches pages via the Prelude API:
#     GET /api/wiki/lookup/list/<key>        → manifest with page list
#     GET /api/wiki/lookup/page/<key>/<id>   → page markdown
#   Multi-module IDs are mapped to subdirectory paths by page_id_to_rel_path.
# ---------------------------------------------------------------------------
pull_api_source() {
    local base="${PRELUDE_SOURCE%/}"
    local key="$DEFAULT_KEY"
    local manifest_url="$base/api/wiki/lookup/list/$key"

    if ! command -v curl >/dev/null 2>&1; then
        fallback_or_fail "curl not found — required for http transport"
        return $?
    fi

    staging="$(mktemp -d "${SKILL_DIR}/.sync-staging.XXXXXX")"

    curl -sf --max-time 30 -o "$staging/manifest.json" "$manifest_url" || {
        fallback_or_fail "GET $manifest_url failed"
        return $?
    }

    local src_sig
    if command -v shasum >/dev/null 2>&1; then
        src_sig="sha1:$(shasum -a 1 "$staging/manifest.json" | awk '{print $1}')"
    elif command -v sha1sum >/dev/null 2>&1; then
        src_sig="sha1:$(sha1sum "$staging/manifest.json" | awk '{print $1}')"
    else
        src_sig="$(stat -f '%m:%z' "$staging/manifest.json" 2>/dev/null \
                   || stat -c '%Y:%s' "$staging/manifest.json")"
    fi

    local last_sig=""
    if [ -f "$STATE_FILE" ]; then
        last_sig="$(awk -F'"' '/"source_sig"/ {print $4; exit}' "$STATE_FILE" 2>/dev/null || echo '')"
    fi

    if [ -n "$last_sig" ] && [ "$src_sig" = "$last_sig" ] && have_usable_cache; then
        log "up to date (manifest hash unchanged: $src_sig)"
        return 0
    fi

    # Parse all page IDs from manifest; detect multi_module flag.
    local page_ids is_multi
    page_ids="$(python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    m = json.load(f)
for p in (m.get("wiki_structure") or {}).get("pages", []):
    print(p["id"])
' "$staging/manifest.json" 2>/dev/null)" || {
        fallback_or_fail "manifest.json is not valid JSON"
        return $?
    }

    is_multi="$(python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    m = json.load(f)
print(1 if m.get("multi_module") else 0)
' "$staging/manifest.json" 2>/dev/null || echo 0)"

    local fetched=0 failed=0 not_found=0
    while IFS= read -r pid; do
        [ -z "$pid" ] && continue
        local rel_path
        rel_path="$(page_id_to_rel_path "$pid")"
        local dest="$staging/$rel_path"
        mkdir -p "$(dirname "$dest")"
        local url="$base/api/wiki/lookup/page/$key/$pid"
        local code
        code="$(curl -sf --max-time 20 -o "$dest" -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
        case "$code" in
            200) fetched=$((fetched + 1)) ;;
            404) not_found=$((not_found + 1)); rm -f "$dest" ;;
            *)   failed=$((failed + 1)); rm -f "$dest" ;;
        esac
    done <<<"$page_ids"

    if [ $fetched -eq 0 ]; then
        fallback_or_fail "0 pages fetched from $base (404s: $not_found, errors: $failed)"
        return $?
    fi
    [ $failed -gt 0 ] && warn "$failed page(s) failed to download; continuing with the $fetched we got"

    # Remove the staging manifest.json (not a page) before promoting
    rm -f "$staging/manifest.json"

    rm -rf "$LOCAL_PAGES"
    mv "$staging" "$LOCAL_PAGES"
    staging=""

    cat >"$STATE_FILE" <<EOF
{
  "source": "$PRELUDE_SOURCE",
  "source_sig": "$src_sig",
  "pages_count": $fetched,
  "multi_module": $is_multi,
  "mode": "api",
  "branch": "$REPO_BRANCH",
  "last_pulled": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    log "synced $fetched page(s) via API from $base (key=$key)"
    return 0
}

# ---------------------------------------------------------------------------
# pull_http_source  (legacy: static files at <PRELUDE_SOURCE>/<key>/pages/)
# ---------------------------------------------------------------------------
pull_http_source() {
    local base="${PRELUDE_SOURCE%/}"
    case "$base" in
        */"$DEFAULT_KEY") ;;
        *) base="$base/$DEFAULT_KEY" ;;
    esac
    local manifest_url="$base/manifest.json"

    if ! command -v curl >/dev/null 2>&1; then
        fallback_or_fail "curl not found"
        return $?
    fi

    local head
    head="$(curl -sfI --max-time 10 "$manifest_url" 2>/dev/null)" || {
        fallback_or_fail "HEAD $manifest_url failed (server unreachable or 404)"
        return $?
    }

    local src_sig
    src_sig="$(printf '%s' "$head" | awk 'BEGIN{IGNORECASE=1} /^(Last-Modified|ETag):/ {gsub(/\r/,""); print; exit}')"
    src_sig="${src_sig:-no-signature}"

    local last_sig=""
    if [ -f "$STATE_FILE" ]; then
        last_sig="$(awk -F'"' '/"source_sig"/ {print $4; exit}' "$STATE_FILE" 2>/dev/null || echo '')"
    fi

    if [ -n "$last_sig" ] && [ "$src_sig" = "$last_sig" ] && have_usable_cache; then
        log "up to date (server signature unchanged: $src_sig)"
        return 0
    fi

    staging="$(mktemp -d "${SKILL_DIR}/.sync-staging.XXXXXX")"

    curl -sf --max-time 30 -o "$staging/manifest.json" "$manifest_url" || {
        fallback_or_fail "GET $manifest_url failed"
        return $?
    }

    local page_ids
    page_ids="$(python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    m = json.load(f)
for p in (m.get("wiki_structure") or {}).get("pages", []):
    print(p["id"])
print("index")
' "$staging/manifest.json" 2>/dev/null)" || {
        fallback_or_fail "manifest.json is not valid JSON"
        return $?
    }

    local fetched=0 failed=0 not_found=0
    while IFS= read -r pid; do
        [ -z "$pid" ] && continue
        local url="$base/pages/${pid}.md"
        local dest="$staging/${pid}.md"
        local code
        code="$(curl -sf --max-time 20 -o "$dest" -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
        case "$code" in
            200) fetched=$((fetched + 1)) ;;
            404) not_found=$((not_found + 1)); rm -f "$dest" ;;
            *)   failed=$((failed + 1)); rm -f "$dest" ;;
        esac
    done <<<"$page_ids"

    if [ $fetched -eq 0 ]; then
        fallback_or_fail "0 pages fetched from $base/pages/ (404s: $not_found, errors: $failed)"
        return $?
    fi
    [ $failed -gt 0 ] && warn "$failed page(s) failed; continuing with $fetched"

    rm -f "$staging/manifest.json"
    rm -rf "$LOCAL_PAGES"
    mv "$staging" "$LOCAL_PAGES"
    cp "$staging_bak/manifest.json" "$LOCAL_MANIFEST" 2>/dev/null || true
    staging=""

    cat >"$STATE_FILE" <<EOF
{
  "source": "$PRELUDE_SOURCE",
  "source_sig": "$src_sig",
  "pages_count": $fetched,
  "branch": "$REPO_BRANCH",
  "last_pulled": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    log "synced $fetched page(s) from $base"
    return 0
}

dispatch_http() {
    local base="${PRELUDE_SOURCE%/}"
    local key="$DEFAULT_KEY"
    local api_probe_url="$base/api/wiki/lookup/list/$key"
    if command -v curl >/dev/null 2>&1 \
        && curl -sf --max-time 5 -o /dev/null "$api_probe_url" 2>/dev/null; then
        pull_api_source
    else
        pull_http_source
    fi
}

case "$PRELUDE_SOURCE" in
    file://*)   pull_file_source ;;
    http://*|https://*) dispatch_http ;;
    *)
        err "unsupported PRELUDE_SOURCE: $PRELUDE_SOURCE"
        exit 1
        ;;
esac
