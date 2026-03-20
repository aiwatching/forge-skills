# Workflow: Debug WebMCP

<required_reading>
**Read these reference files NOW:**
1. references/imperative-api.md
2. references/declarative-api.md
</required_reading>

<process>
Step 1: Check Prerequisites
- Verify Chrome version >= 146.0.7672.0 (Help > About Google Chrome)
- Verify chrome://flags/#enable-webmcp-testing is set to Enabled
- Confirm Chrome was relaunched after enabling the flag
- If the flag does not exist, the Chrome version is too old

Step 2: Check API Availability
- Open DevTools console on the target page
- Run `typeof navigator.modelContext` -- should return "object"
- If "undefined": flag is not enabled, Chrome is too old, or the page is not served over HTTP/HTTPS (file:// does not work)
- Check for Content Security Policy headers that might block the API

Step 3: Check Registered Tools
- Open Model Context Tool Inspector extension panel
- Or run in console: `navigator.modelContext.provideContext({ tools: [] })` then re-register to see updates
- Verify all expected tools appear with correct names
- If tools are missing, proceed to Step 4

Step 4: Diagnose Missing Tools
- **Timing issue:** Tools registered before DOM is ready or before navigator.modelContext is available. Wrap registration in DOMContentLoaded or check for API existence first.
- **SPA navigation:** Tools from a previous route were not cleared, or new route did not register its tools. Verify provideContext is called on every route change with the complete tool set.
- **JS errors:** Check console for errors during tool registration. A malformed inputSchema or missing required fields will silently fail.
- **Declarative missing:** Check that the form has both `toolname` and `tooldescription` attributes. Check that inputs have `name` attributes. Inspect the DOM to verify attributes are present (framework rendering may strip unknown attributes).
- **provideContext overwrite:** Calling provideContext replaces ALL tools. If called with an empty tools array or a partial list, previously registered tools disappear.

Step 5: Diagnose Tool Execution Failures
- Execute the tool from the inspector with valid parameters
- Check the console for errors thrown inside the execute function
- Verify the execute function is async or returns a Promise
- Check that all awaited operations (fetch, DOM updates) resolve
- For declarative auto-submit: verify the submit event listener exists and calls e.respondWith()

Step 6: Diagnose Wrong Results
- Verify the return format is `{ content: [{ type: "text", text: "..." }] }`
- The content array must contain objects with `type` and `text` properties
- Check that the text value is a string (not an object or undefined)
- For error returns, verify `isError: true` is set on the return object
- For declarative: verify respondWith receives a Promise that resolves to the correct format

Step 7: Diagnose UI Issues
- Verify the execute function updates the UI before returning/resolving
- Check that DOM updates are not batched or deferred past the return point
- For frameworks (React, Vue): ensure state updates have flushed before the execute promise resolves
- Check toolactivated/toolcancel event listeners are attached to the correct elements

Step 8: Common Issues Quick Reference
- `navigator.modelContext is undefined` -- Flag not enabled or Chrome too old
- Tools disappear after navigation -- provideContext not called on new route
- Tool executes but agent gets no response -- execute function does not return the result object
- Declarative form submits but agent gets no data -- Missing respondWith in submit handler
- Form fields not populated -- Inputs missing name attributes
- respondWith error -- The promise passed to respondWith rejected or returned wrong format
- Tool appears twice -- Registered both imperatively and declaratively with different names for same action
</process>

<anti_patterns>
- Assuming the flag is enabled without checking
- Debugging tool execution without first verifying tool registration
- Ignoring console errors during registration
- Testing only with valid parameters (missing error path coverage)
- Not checking the return format when tools "execute but nothing happens"
- Blaming the API when the issue is in the execute function's business logic
</anti_patterns>

<success_criteria>
- Root cause of the issue is identified and categorized (prerequisites, registration, execution, result format, UI, or declarative-specific)
- The fix is applied and verified in the Model Context Tool Inspector
- Tool executes with correct results and UI updates
- No console errors during registration or execution
- Both valid and invalid parameter cases work correctly
</success_criteria>
