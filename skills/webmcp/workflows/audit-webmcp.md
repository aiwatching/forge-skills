# Workflow: Audit WebMCP Implementation

<required_reading>
**Read these reference files NOW:**
1. references/imperative-api.md
2. references/declarative-api.md
</required_reading>

<process>
Step 1: Inventory All Registered Tools
- Open Model Context Tool Inspector extension on each page/route of the app
- List every imperative tool (registered via registerTool or provideContext)
- List every declarative tool (forms with toolname attribute)
- Note which page/route each tool belongs to
- Flag any tools that appear on pages where they should not

Step 2: Audit Tool Naming
- Every name should be kebab-case (e.g., "search-flights" not "searchFlights")
- Every name should start with a specific verb (search, create, add, update, delete, submit, toggle, open)
- Names should distinguish execution from initiation (e.g., "book-flight" executes, "open-booking-form" initiates)
- No generic names like "do-action", "submit-form", "handle-click"
- No duplicate names across imperative and declarative tools

Step 3: Audit Tool Descriptions
- Every description should be verb-first and positive ("Search flights by..." not "This is used to search...")
- Descriptions should explain **what** the tool does and **when** to use it
- Descriptions should not include implementation details or internal jargon
- Descriptions should be concise (1-2 sentences max)

Step 4: Audit Input Schemas
- Every parameter should have a type and description
- Prefer accepting raw user input (free-text strings) over strict enums
- If enums are used, they should represent meaningful choices the user would understand
- Required array should include only truly required parameters
- Optional parameters should have sensible defaults or be omitted when not provided
- For declarative: every meaningful input has a name attribute, and toolparamtitle/toolparamdescription where the name alone is unclear

Step 5: Audit Execute Functions (Imperative)
- Every execute function validates input before acting
- Invalid input returns `{ content: [...], isError: true }` with a descriptive message
- Business logic errors are caught and returned as descriptive errors (not thrown)
- UI is updated before the execute function resolves
- Return value uses `{ content: [{ type: "text", text: "..." }] }` format
- The text describes what happened, not just echoes the input

Step 6: Audit Declarative Form Handlers
- Forms with toolautosubmit have a submit listener that checks e.agentInvoked
- The submit listener calls e.respondWith(promise) with the correct return format
- Forms without toolautosubmit correctly pre-fill and await user confirmation
- Normal user submission is not broken by WebMCP attributes

Step 7: Check for Overlapping Tools
- Identify tools that do similar things (e.g., "search-by-name" and "search-by-category")
- Recommend merging overlapping tools into one tool with additional parameters
- Fewer, more flexible tools are better than many narrow tools

Step 8: Audit State Management
- For SPAs: verify provideContext is called on every route change with the correct tool set
- Verify tools are not stale after navigation (tools from previous page should not persist)
- Verify registerTool cleanup functions are called on component unmount
- Verify tools reflect the current application state (e.g., "checkout" tool only available when cart has items)

Step 9: Audit Event Handling
- toolactivated listener is present and updates UI (loading state, highlight)
- toolcancel listener is present and reverts UI changes
- Event listeners are attached to the correct elements (form for declarative, document or component for imperative)

Step 10: Generate Audit Report
- Summarize total tools found (imperative count, declarative count, per page/route)
- List all findings organized by severity: **Critical** (broken functionality), **Warning** (best practice violation), **Info** (suggestion)
- For each finding: describe the issue, which tool is affected, and the recommended fix
- Provide an overall health score: Healthy (no critical, <=2 warnings), Needs Attention (1+ critical or 3+ warnings), Unhealthy (3+ critical)
</process>

<anti_patterns>
- Auditing only imperative tools and ignoring declarative forms
- Not testing tools on every page/route (missing stale tool issues)
- Accepting vague tool descriptions as "good enough"
- Not verifying error handling paths
- Skipping the overlap check (leads to confusing agent experiences)
- Not checking that normal user flows still work after WebMCP integration
</anti_patterns>

<success_criteria>
- Complete inventory of all tools across all pages/routes
- Every tool name follows kebab-case, verb-first convention
- Every tool description is clear, verb-first, and explains what + when
- Every input schema has typed, described parameters
- Every execute function validates input and returns descriptive errors
- No overlapping tools (merged where possible)
- Tools update correctly on navigation and state changes
- Event handlers (toolactivated, toolcancel) are present and functional
- Audit report generated with findings and actionable recommendations
</success_criteria>
