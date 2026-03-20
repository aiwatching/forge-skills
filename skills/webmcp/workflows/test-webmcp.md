# Workflow: Test WebMCP Tools

<required_reading>
**Read these reference files NOW:**
1. references/imperative-api.md
2. references/declarative-api.md
</required_reading>

<process>
Step 1: Install and Open the Model Context Tool Inspector
- Install the Model Context Tool Inspector Chrome Extension from the Chrome Web Store
- Navigate to the target page in Chrome (with WebMCP flag enabled)
- Open DevTools and find the Model Context Tool Inspector panel
- If the panel is empty, refresh the page and check that tools are registered

Step 2: Verify Tool Discovery
- Confirm all expected tools appear in the inspector panel
- For each tool, verify:
  - Name matches the intended kebab-case identifier
  - Description accurately explains the action
  - Input schema lists all expected parameters with correct types
  - Required parameters are marked as required
- If any tools are missing, follow the debug-webmcp workflow

Step 3: Test Each Tool with Valid Parameters
- For each tool in the inspector, enter valid parameter values
- Execute the tool and observe:
  - The return value contains `{ content: [{ type: "text", text: "..." }] }`
  - The text describes the result meaningfully (not just "success" or echoed input)
  - The UI updates to reflect the action (new data displayed, form submitted, state changed)
  - No console errors during execution
- Record the result for each tool (pass/fail with notes)

Step 4: Test Each Tool with Invalid Parameters
- For each tool, test with:
  - Missing required parameters (omit them entirely)
  - Wrong types (string where number expected, etc.)
  - Empty strings for required string parameters
  - Out-of-range values for numeric parameters
  - Invalid enum values (if enums are used)
- Verify each case returns `{ content: [...], isError: true }` with a descriptive error message
- The error message should tell the agent what went wrong and how to fix it
- No unhandled exceptions should appear in the console

Step 5: Test Declarative Form Behavior
- For forms **without** toolautosubmit:
  - Execute the tool from the inspector
  - Verify form fields are populated with the provided values
  - Verify the form does NOT auto-submit (waits for user confirmation)
  - Manually submit the form and verify it works correctly
- For forms **with** toolautosubmit:
  - Execute the tool from the inspector
  - Verify the form auto-submits
  - Verify respondWith returns structured data to the agent
  - Verify the return format is correct `{ content: [{ type: "text", text }] }`
- For all declarative forms:
  - Submit the form manually (as a normal user) and verify it still works
  - Confirm that agentInvoked-specific logic does not interfere with normal submission

Step 6: Test Event Handling
- Execute a tool and verify the toolactivated event fires (check for UI indicators like loading states or highlights)
- If possible, cancel a tool execution and verify the toolcancel event fires and UI reverts
- Verify event listeners do not throw errors or leave the UI in a broken state

Step 7: Test State Transitions and Navigation
- Navigate to a different page or route in the app
- Open the inspector and verify tools update to reflect the new page
- Verify tools from the previous page are no longer listed (unless they are global)
- Navigate back and verify tools re-register correctly
- For SPAs: test rapid navigation between routes and verify tools do not become stale or duplicated

Step 8: Test Edge Cases
- Refresh the page and verify all tools re-register
- Open multiple tabs of the same page and verify tools work in each independently
- Test with slow network conditions (throttle in DevTools) to verify tools handle latency
- Test concurrent tool execution if the app supports it

Step 9: Cross-Reference with Live Demo
- Open the reference demo at https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/
- Compare tool behavior, naming, and return formats against the reference implementation
- Note any deviations from the reference patterns

Step 10: Document Test Results
- Create a summary with:
  - Total tools tested
  - Pass/fail count for valid parameter tests
  - Pass/fail count for invalid parameter tests
  - Declarative form test results
  - Event handling test results
  - Navigation/state transition test results
  - Edge case findings
  - List of issues found with severity and recommended fixes
</process>

<anti_patterns>
- Only testing with valid parameters (missing error handling gaps)
- Not testing declarative forms as both agent-invoked and user-submitted
- Skipping navigation tests (misses stale tool bugs)
- Testing only in the inspector without checking the actual UI updates
- Not checking console for errors during tool execution
- Assuming tools work because they appear in the inspector (registration != execution)
- Testing only one page and assuming all pages work the same
</anti_patterns>

<success_criteria>
- All expected tools appear in the Model Context Tool Inspector on every relevant page
- Every tool executes successfully with valid parameters and returns correct results
- Every tool returns descriptive errors with isError flag for invalid parameters
- UI updates correctly after every tool execution
- Declarative forms work for both agent invocation and normal user submission
- toolactivated and toolcancel events fire and update UI correctly
- Tools update correctly on navigation (no stale or missing tools)
- No console errors during any test scenario
- Test results documented with clear pass/fail and issue list
</success_criteria>
