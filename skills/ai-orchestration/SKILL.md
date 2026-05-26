---
name: "ai-orchestration"
description: >-
  Discover and call Forge connector tools to fetch data from external systems
  (Mantis, GitLab, Teams, Jira, PMDB, etc.) or post back to them. Use when the
  user prompt references information that lives outside the local filesystem
  and the standard read/write/grep/run toolset can't satisfy it on its own.
---

# AI Orchestration

You have two MCP tools (from `forge-mcp`) for reaching into the user's
installed connectors:

| Tool | Purpose |
|---|---|
| `list_connectors` | Enumerate installed connectors + their tools. Returns plugin_id, tool name, description, parameter schema, destructive flag, and (when present) a hint about the return shape. |
| `call_connector` | Invoke one tool by `{ plugin_id, tool, input }`. Returns the tool result text; `isError: true` when the call failed. |

## When to invoke

- The prompt mentions a system name (Mantis, GitLab MR, Teams chat, Jira issue, etc.)
- The prompt asks for data you can't read from disk (today's bugs, this week's open MRs, …)
- The prompt asks you to *send* something to a system (post a comment, send a message)

If the request is purely local code work (edit files, run tests, grep, refactor),
don't reach for connectors.

## Workflow

1. Call `list_connectors` once at the start. The result fits in context;
   don't call it repeatedly for the same turn.
2. Scan for the right `plugin_id` + tool by name and description.
3. Call `call_connector` with the matching `input` shape from `parameters`.
4. If a tool is marked `destructive: true`, confirm the action makes sense
   for the current prompt before calling. The dispatch is not blocked, but
   you are still responsible for not posting spam.
5. On `isError: true`: read the error message, retry once with a corrected
   input if it's a parameter problem, otherwise surface the error in your
   final answer rather than silently failing.

## What this skill is NOT for

- Chaining multiple tools through a complex plan — the MVP does single
  calls. Multi-step coordination is the *caller's* responsibility (you,
  driving the loop with intermediate reasoning).
- Long-term memory — connectors are stateless from this skill's view.
  Memory belongs to `temper-memory` or equivalent.
- Connector setup — installing / configuring connectors is a user task
  in the Forge UI. If `list_connectors` returns an empty list, tell the
  user; don't try to bootstrap one.

## Failure modes to surface clearly

- **No connector available**: `list_connectors` empty → "No connectors
  installed; user needs to add one from Forge Settings → Marketplace."
- **Tool exists but errors**: include the error text from `call_connector`
  verbatim in your reply, not paraphrased.
- **Ambiguous prompt**: prefer asking a clarifying question over guessing
  which tool to call.
