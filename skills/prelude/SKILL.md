---
name: prelude
description: Look up pre-generated architectural context about this codebase. Invoke this skill whenever the user (1) pastes a diff or asks you to review code, (2) asks what a change could break or which modules a change affects, (3) asks how a module/service/entity works or relates to others, (4) asks about business flows, revisions, installs, or cross-module interactions, (5) asks a question containing specific class/service/entity names from this repo, or (6) is about to write code that modifies an existing module. The skill provides cross-module dependencies, reverse references, and business flows that are not obvious from grepping source.
---

# Prelude context skill

Pre-generated architectural context lives alongside this skill at `pages/`. It is produced by the Prelude generator and synced into this skill directory on demand. Use it as the fast first-pass answer source, then verify details in live source code.

## Procedure (follow this every time the skill activates)

### 1. Sync (always first)

Invoke `sync.sh` using the **absolute path** of the skill directory — the same directory where this `SKILL.md` lives (which you already resolved when loading this file). Example (substitute the real absolute path you loaded):

```bash
# Normal case — auto-detect which wiki matches the surrounding repo:
bash /abs/path/to/.claude/skills/prelude/scripts/sync.sh

# When the USER names a repository (and optionally a branch) in their request,
# pass them explicitly — arguments take priority over auto-detection:
bash /abs/path/to/.claude/skills/prelude/scripts/sync.sh FortiNAC 7.6
```

This is a UNIVERSAL skill: it is not pinned to one wiki. It resolves the right
wiki in this order: explicit arguments → config/env → git auto-detection of the
surrounding repository. If none of those identify a wiki, it exits with code 2
(see below) and you must ask the user.

Do not use `$CLAUDE_PROJECT_DIR` or `git rev-parse` to build the path — in this repo the skill directory can sit inside a sub-checkout whose outer git root is a different directory, and those forms produce the wrong path.

The sync script is pull-only and idempotent — it compares the local manifest to the source and no-ops if nothing changed (typical runtime under 50 ms). Semantics:

- **Exit 0, no warning** — local cache is up-to-date or was just refreshed; proceed normally.
- **Exit 0, with a `WARN:` line** — upstream was unreachable but a previous cache exists under `pages/`. The context may be stale, but it is still the best pre-generated answer source — **use it**. Note the staleness in your answer if the user is asking about very recent changes.
- **Exit 1** — no usable cache at all (fresh clone + source unavailable). Skip to step 4 (fallback to pure source-code analysis). Mention to the user that the Prelude context isn't available here.
- **Exit 2 — `NEED_INPUT`** — the script could not determine (or could not find) which wiki to use. **STOP and ASK THE USER.** The script prints the list of wikis available on the server — present those options to the user verbatim, ask which repo + branch they want (or whether to proceed without Prelude context), then re-run sync with BOTH as arguments: `sync.sh <repo> <branch>`. Never guess, never silently proceed with a cached wiki for a different repo/branch, and never treat this as a hard failure without asking first. This also covers the branch-mismatch case (e.g. the user is on a feature branch and the wiki exists only for `7.6`) — selecting the nearest wiki is the USER's decision, not yours.

Always proceed to step 2 as long as `pages/index.md` exists, even if sync printed a warning.

### 2. Read the index

```text
$CLAUDE_PROJECT_DIR/.claude/skills/prelude/pages/index.md
```

`pages/index.md` is the cross-module atlas — scan it first to identify which module(s) are relevant.
`pages/architecture-overview.md` gives the rough how-things-relate story and a Mermaid module-dependency diagram.
Each module has its own `pages/<module>/index.md` as its local entry point with a page list and file-tree.

If the request touches a single module, go straight to that module's index. If it spans modules, read `architecture-overview.md` first.

### 3. Read matched pages in full

Open each matched page with the Read tool. Pages live at:

```text
$CLAUDE_PROJECT_DIR/.claude/skills/prelude/pages/<module>/<page-id>.md
```

Repo-level pages (cross-module narrative, mechanical atlas):
```text
$CLAUDE_PROJECT_DIR/.claude/skills/prelude/pages/index.md
$CLAUDE_PROJECT_DIR/.claude/skills/prelude/pages/architecture-overview.md
```

Each content page includes:
- A **Depends on / Used by / Shared entities** banner near the top — use it to follow cross-module links.
- A **Cross-Module Dependencies** table listing inbound/outbound module relationships.
- A **Reverse References** section listing external code that references this module's entities.
- **`Sources: filename.ext:line_range`** citations embedded in the prose.

For impact-analysis queries, the Cross-Module Dependencies + Reverse References sections are the highest-value parts.

### 4. Verify in live source — do this before answering

**The wiki is orientation, not ground truth.** Pages can be weeks old. After reading wiki pages, open the actual source files for every concrete claim. This is mandatory, not optional.

**How to use `Sources:` citations** — every wiki page embeds inline citations like:
```
Sources: [AuditQueService.java:55-64]()  [FailoverGroupServiceImpl.java:62-72]()
```
Turn these into source reads:
1. Find the file: `find $CLAUDE_PROJECT_DIR -name "AuditQueService.java" 2>/dev/null | head -1`
2. Read the cited range with the Read tool at that path and offset.

**Mandatory source check for these claim types:**

| You're about to say... | Do this first |
|---|---|
| A class / interface exists | `grep -r "class ClassName\|interface ClassName" $CLAUDE_PROJECT_DIR --include="*.java" -l` |
| A method name, signature, or parameters | Find and Read the file from the Sources: citation |
| A timing constant (e.g. "every 10 seconds", "15-minute timeout") | Grep the relevant file for the numeric literal or constant name |
| An entity field or schema detail | Read the entity class directly |
| A call chain or dependency direction | Grep call sites: `grep -r "methodName\|ClassName" $CLAUDE_PROJECT_DIR --include="*.java" -l` |
| A behaviour described as "always", "never", or "every time" | Read the implementation — these are the claims most likely to be stale |

**If source and wiki disagree:** trust the source. Say "the wiki describes X but current source shows Y" and answer from source.

**If no Sources: citation is present** for a claim: grep for the class/method name to find the file, then read it.

### 5. Answer

Use the wiki for structure and orientation; use source for specific facts. In your answer:
- Cite wiki pages by title for architecture / flow descriptions
- Cite source files by `path:line` for any specific class, method, field, or constant you name
- Do not paste large chunks of either wiki or source; summarise and point

## Boundaries

- **Do NOT** answer concrete questions (method signatures, field names, timings, call chains) from wiki alone — always follow with a source read.
- **Do NOT** use the context for code the user is currently editing — trust the buffer + source.
- **Do NOT** paste large chunks of context content verbatim; link to the page by title and summarise.
- If `pages/index.md` is missing after step 1 (sync failed or context not built), tell the user the Prelude context isn't available and proceed with source-only analysis.

## Transport note

The sync script currently pulls from a local Prelude cache directory. A future version will fetch a branch-specific context pack over HTTP. The skill body does not change when that switch happens — this section is the only place that transport details surface, and it's advisory only.
