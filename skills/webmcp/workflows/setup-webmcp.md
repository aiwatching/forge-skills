# Workflow: Set Up WebMCP

<required_reading>
**Read these reference files NOW:**
1. references/imperative-api.md
2. references/declarative-api.md
</required_reading>

<process>
Step 1: Verify Prerequisites
- Check Chrome version >= 146.0.7672.0 (Help > About Google Chrome)
- Enable chrome://flags/#enable-webmcp-testing flag
- Relaunch Chrome

Step 2: Identify Tools to Expose
- Review the app's key user-facing actions (forms, CRUD operations, search, navigation)
- List each action as a potential tool with name, description, and parameters
- Decide per action: imperative (JS) or declarative (HTML form annotation)
- Use declarative for existing HTML forms, imperative for programmatic/non-form actions

Step 3: Choose Integration Strategy
- For SPAs (React, Vue, Angular): use imperative API, register tools after mount/route change, use provideContext to update tool set on navigation
- For traditional multi-page sites: use declarative API on forms, add imperative for non-form actions
- For hybrid: mix both APIs

Step 4: Add Imperative Tools (if applicable)
- Create a webmcp.js (or webmcp.ts) module
- Register tools using navigator.modelContext.registerTool() or provideContext()
- Hook into app lifecycle (SPA route changes, component mounts)

Step 5: Add Declarative Tools (if applicable)
- Add toolname and tooldescription attributes to `<form>` elements
- Add toolparamtitle and toolparamdescription to inputs needing richer schema
- Add toolautosubmit if forms should auto-submit when agent invokes
- Add respondWith handler for auto-submit forms

Step 6: Handle Events
- Add toolactivated and toolcancel event listeners
- Update UI appropriately (loading states, visual feedback)

Step 7: Install Testing Extension
- Install Model Context Tool Inspector Chrome Extension
- Verify all tools appear in extension
- Test each tool manually
</process>

<anti_patterns>
- Registering tools before the page/app is ready
- Not updating tools when SPA navigates (stale tools from previous page)
- Mixing declarative and imperative for the same action (pick one)
- Not handling agentInvoked in form submit handlers
- Registering duplicate tool names across imperative and declarative
- Forgetting to relaunch Chrome after enabling the flag
</anti_patterns>

<success_criteria>
- Chrome flag enabled and version verified
- All key user actions exposed as WebMCP tools
- Tools appear in Model Context Tool Inspector
- Each tool executes successfully from the inspector
- UI updates correctly after tool execution
- Agent events (toolactivated/toolcancel) handled
- No console errors during tool registration or execution
</success_criteria>
