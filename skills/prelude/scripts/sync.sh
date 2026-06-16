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
# UNIVERSAL key resolution (testing copy — identity ladder):
#   1. arguments:   sync.sh <repo> [branch]      (highest priority)
#   2. env/config:  PRELUDE_DEFAULT_KEY (pinned) or PRELUDE_REPO+PRELUDE_BRANCH
#   3. git:         auto-detect repo from `remote get-url origin`
#                   (or top-level dirname when no remote) + branch from HEAD
#   4. otherwise:   exit 2 — the AGENT must ASK THE USER, then re-run
#                   with explicit arguments.
#   Matching is done CLIENT-SIDE against GET /api/wiki/lookup/list
#   (repo and branch: exact first, then case-insensitive).
#   A cached key is reused ONLY when the server is unreachable AND the
#   cache was resolved for the SAME repo+branch. A repo/branch mismatch
#   (HTTP 404/409) is a USER decision — never silently served from cache.
#
# Usage:
#   bash .../scripts/sync.sh [repo] [branch]
#
# Exit codes:
#   0 = usable context available under pages/ (freshly synced, up-to-date,
#       or stale-but-usable cache from a prior sync).
#   1 = no usable context at all.
#   2 = cannot determine which wiki to use — ask the user for repo+branch,
#       then re-run with both as arguments.

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

PRELUDE_SOURCE="${PRELUDE_SOURCE:-http://localhost:8001}"
PRELUDE_REPO="${PRELUDE_REPO:-}"
PRELUDE_BRANCH="${PRELUDE_BRANCH:-}"

REPO_BRANCH=""
if command -v git >/dev/null 2>&1; then
    REPO_BRANCH="$(git -C "$SKILL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
fi

# Universal mode: positional args take priority over everything.
ARG_REPO="${1:-}"
ARG_BRANCH="${2:-}"
REQ_REPO=""
REQ_BRANCH=""
DETECTED_REPO=""
DETECTED_OWNER=""
DETECTED_BRANCH=""

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
# Universal identity resolution
# ---------------------------------------------------------------------------

detect_repo_identity() {
    command -v git >/dev/null 2>&1 || return 0
    git -C "$SKILL_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
    local url path
    url="$(git -C "$SKILL_DIR" remote get-url origin 2>/dev/null || echo '')"
    if [ -n "$url" ]; then
        # Best-effort parse of https/ssh/scp remote forms; nested GitLab
        # groups collapse to the last two segments (matches the FE).
        path="${url%.git}"
        path="${path%/}"
        case "$path" in
            *://*) path="${path#*://}"; path="${path#*/}" ;;
            *@*:*) path="${path#*:}" ;;
        esac
        DETECTED_REPO="$(basename "$path")"
        local parent
        parent="$(dirname "$path")"
        [ "$parent" != "." ] && DETECTED_OWNER="$(basename "$parent")"
    else
        # No remote: local-onboarding convention is repo = top-level dirname
        # (guaranteed only for repos onboarded via the main UI flow).
        local top
        top="$(git -C "$SKILL_DIR" rev-parse --show-toplevel 2>/dev/null || echo '')"
        [ -n "$top" ] && DETECTED_REPO="$(basename "$top")"
    fi
    DETECTED_BRANCH="$(git -C "$SKILL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
    [ "$DETECTED_BRANCH" = "HEAD" ] && DETECTED_BRANCH=""   # detached
}

print_available_wikis() {
    local base="${PRELUDE_SOURCE%/}"
    local listing
    listing="$(curl -sf --max-time 10 "$base/api/wiki/lookup/list" 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
for w in d.get("wikis", []):
    r = w.get("repo") or "?"
    b = w.get("branch") or "(legacy)"
    print("  - repo: %-24s branch: %s" % (r, b))
' 2>/dev/null)"
    [ -n "$listing" ] && printf 'Available wikis on %s:\n%s\n' "$PRELUDE_SOURCE" "$listing"
}

need_user_input() {
    # Exit 2 contract: the calling AGENT must ask the USER which wiki to
    # use, present the printed options, then re-run:
    #     sync.sh <repo> <branch>
    printf '[prelude-sync] NEED_INPUT: %s\n' "$1"
    print_available_wikis
    printf 'Ask the user which repo and branch to use, then re-run: sync.sh <repo> <branch>\n'
    exit 2
}

state_field() {
    [ -f "$STATE_FILE" ] || { echo ''; return; }
    awk -F'"' -v k="\"$1\"" '$0 ~ k {print $4; exit}' "$STATE_FILE" 2>/dev/null || echo ''
}

handle_key_change() {
    local old_key
    old_key="$(state_field default_key)"
    if [ -n "$old_key" ] && [ "$old_key" != "$DEFAULT_KEY" ]; then
        log "wiki identity changed ($old_key -> $DEFAULT_KEY) — clearing local cache"
        rm -rf "$LOCAL_PAGES"
        rm -f "$STATE_FILE" "$LOCAL_MANIFEST"
    fi
}

resolve_key() {
    # Pinned mode (per-wiki packages / explicit override) — unchanged contract.
    if [ -n "${PRELUDE_DEFAULT_KEY:-}" ]; then
        DEFAULT_KEY="$PRELUDE_DEFAULT_KEY"
        return 0
    fi

    # Identity ladder: args > env/config > git auto-detect.
    REQ_REPO="${ARG_REPO:-${PRELUDE_REPO:-}}"
    REQ_BRANCH="${ARG_BRANCH:-${PRELUDE_BRANCH:-}}"
    if [ -z "$REQ_REPO" ] || [ -z "$REQ_BRANCH" ]; then
        detect_repo_identity
        [ -z "$REQ_REPO" ] && REQ_REPO="$DETECTED_REPO"
        [ -z "$REQ_BRANCH" ] && REQ_BRANCH="$DETECTED_BRANCH"
    fi
    if [ -z "$REQ_REPO" ]; then
        need_user_input "could not determine the repository (no arguments, no config, no usable git remote)"
    fi
    if [ -z "$REQ_BRANCH" ]; then
        need_user_input "could not determine the branch for repo '$REQ_REPO' (no arguments, no config, git HEAD detached or unavailable)"
    fi

    if ! command -v curl >/dev/null 2>&1; then
        err "curl not found — required for key resolution"
        exit 1
    fi

    # ----- CLIENT-SIDE matching against the full wiki list -----
    # One GET /api/wiki/lookup/list, then match locally:
    #   repo:   exact first, then case-insensitive
    #   branch: exact first, then case-insensitive (within the matched repo)
    # Unique match → proceed. Anything else → ask the user (exit 2).
    local base="${PRELUDE_SOURCE%/}"
    local resp code body
    resp="$(curl -s --max-time 10 -w '\n%{http_code}' "$base/api/wiki/lookup/list" 2>/dev/null)" || resp="
000"
    code="${resp##*
}"
    body="${resp%
*}"

    if [ "$code" != "200" ]; then
        # Server unreachable. Cached key allowed ONLY for the same identity
        # (case-insensitive compare against the canonical identity we stored).
        local cached_key cached_repo cached_branch lc_req_r lc_req_b lc_c_r lc_c_b
        cached_key="$(state_field default_key)"
        cached_repo="$(state_field resolved_repo)"
        cached_branch="$(state_field resolved_branch)"
        lc_req_r="$(printf '%s' "$REQ_REPO"   | tr '[:upper:]' '[:lower:]')"
        lc_req_b="$(printf '%s' "$REQ_BRANCH" | tr '[:upper:]' '[:lower:]')"
        lc_c_r="$(printf '%s' "$cached_repo"   | tr '[:upper:]' '[:lower:]')"
        lc_c_b="$(printf '%s' "$cached_branch" | tr '[:upper:]' '[:lower:]')"
        if [ -n "$cached_key" ] && [ "$lc_c_r" = "$lc_req_r" ] && [ "$lc_c_b" = "$lc_req_b" ]; then
            warn "server unreachable — using cached key for $cached_repo/$cached_branch: $cached_key"
            DEFAULT_KEY="$cached_key"
            return 0
        fi
        if [ -n "$cached_key" ]; then
            need_user_input "server $PRELUDE_SOURCE unreachable, and the local cache is for '$cached_repo/$cached_branch', not '$REQ_REPO/$REQ_BRANCH'"
        fi
        err "server $PRELUDE_SOURCE unreachable and no local cache exists."
        exit 1
    fi

    local verdict
    verdict="$(printf '%s' "$body" | python3 -c '
import json, sys
req_repo, req_branch = sys.argv[1], sys.argv[2]
try:
    wikis = json.load(sys.stdin).get("wikis", [])
except Exception:
    print("ERR"); sys.exit(0)
def norm(s):
    return (s or "").lower()
repo_m = [w for w in wikis if (w.get("repo") or "") == req_repo] \
         or [w for w in wikis if norm(w.get("repo")) == norm(req_repo)]
if not repo_m:
    print("NOREPO"); sys.exit(0)
br_m = [w for w in repo_m if (w.get("branch") or "") == req_branch] \
       or [w for w in repo_m if norm(w.get("branch")) == norm(req_branch)]
if len(br_m) == 1:
    w = br_m[0]
    print("KEY\t%s\t%s\t%s" % (w["key"], w.get("repo") or "", w.get("branch") or ""))
elif len(br_m) > 1:
    print("AMBIG\t" + ", ".join(sorted(w["key"] for w in br_m)))
else:
    print("NOBRANCH\t" + ", ".join(sorted(set((w.get("branch") or "(legacy)") for w in repo_m))))
' "$REQ_REPO" "$REQ_BRANCH" 2>/dev/null || echo ERR)"

    case "$verdict" in
        KEY*)
            DEFAULT_KEY="$(printf '%s\n' "$verdict" | cut -f2)"
            local m_repo m_branch
            m_repo="$(printf '%s\n' "$verdict" | cut -f3)"
            m_branch="$(printf '%s\n' "$verdict" | cut -f4)"
            if [ "$m_repo" != "$REQ_REPO" ] || [ "$m_branch" != "$REQ_BRANCH" ]; then
                log "matched wiki '$m_repo' / '$m_branch' for requested '$REQ_REPO' / '$REQ_BRANCH' (case-insensitive)"
            fi
            handle_key_change
            # Persist the CANONICAL identity (as stored on the server) so the
            # offline path can compare reliably.
            if [ -f "$STATE_FILE" ]; then
                python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
d['default_key'] = sys.argv[2]
d['resolved_repo'] = sys.argv[3]
d['resolved_branch'] = sys.argv[4]
with open(sys.argv[1], 'w') as f:
    json.dump(d, f, indent=2)
" "$STATE_FILE" "$DEFAULT_KEY" "$m_repo" "$m_branch" 2>/dev/null || true
            else
                printf '{"default_key":"%s","resolved_repo":"%s","resolved_branch":"%s","last_pulled":"never"}\n' \
                    "$DEFAULT_KEY" "$m_repo" "$m_branch" > "$STATE_FILE"
            fi
            # Make the canonical identity visible to the state heredoc in pull_api_source.
            REQ_REPO="$m_repo"
            REQ_BRANCH="$m_branch"
            return 0
            ;;
        NOBRANCH*)
            need_user_input "repo '$REQ_REPO' exists but has no wiki for branch '$REQ_BRANCH'. Available branches: $(printf '%s\n' "$verdict" | cut -f2-)"
            ;;
        AMBIG*)
            need_user_input "multiple wikis match '$REQ_REPO' / '$REQ_BRANCH' — candidates: $(printf '%s\n' "$verdict" | cut -f2-)"
            ;;
        NOREPO)
            need_user_input "no wiki for repo '$REQ_REPO' on $PRELUDE_SOURCE"
            ;;
        *)
            need_user_input "could not parse the wiki list from $PRELUDE_SOURCE"
            ;;
    esac
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
#     GET /api/wiki/lookup/list/<key>        → manifest with page list + generated_at
#     GET /api/wiki/lookup/page/<key>/<id>   → page markdown
#   Change detection uses the generated_at field (stable across structural changes).
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

    # Change detection: use generated_at from manifest (stable field)
    local src_sig
    src_sig="$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    m = json.load(f)
print(m.get('generated_at') or '')
" "$staging/manifest.json" 2>/dev/null || echo '')"

    if [ -z "$src_sig" ]; then
        # Fallback: SHA1 of whole manifest if generated_at absent (legacy server)
        if command -v shasum >/dev/null 2>&1; then
            src_sig="sha1:$(shasum -a 1 "$staging/manifest.json" | awk '{print $1}')"
        elif command -v sha1sum >/dev/null 2>&1; then
            src_sig="sha1:$(sha1sum "$staging/manifest.json" | awk '{print $1}')"
        else
            src_sig="$(stat -f '%m:%z' "$staging/manifest.json" 2>/dev/null \
                       || stat -c '%Y:%s' "$staging/manifest.json")"
        fi
    fi

    local last_sig=""
    if [ -f "$STATE_FILE" ]; then
        last_sig="$(awk -F'"' '/"source_sig"/ {print $4; exit}' "$STATE_FILE" 2>/dev/null || echo '')"
    fi

    if [ -n "$last_sig" ] && [ "$src_sig" = "$last_sig" ] && have_usable_cache; then
        log "up to date (generated_at unchanged: $src_sig)"
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
  "default_key": "$key",
  "resolved_repo": "$REQ_REPO",
  "resolved_branch": "$REQ_BRANCH",
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
    staging=""

    cat >"$STATE_FILE" <<EOF
{
  "source": "$PRELUDE_SOURCE",
  "default_key": "$DEFAULT_KEY",
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

# Resolve the wiki key before dispatching
DEFAULT_KEY=""
resolve_key || exit 1

case "$PRELUDE_SOURCE" in
    file://*)   pull_file_source ;;
    http://*|https://*) dispatch_http ;;
    *)
        err "unsupported PRELUDE_SOURCE: $PRELUDE_SOURCE"
        exit 1
        ;;
esac
