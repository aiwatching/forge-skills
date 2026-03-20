<reference id="webmcp-testing">
  <overview>
    Testing WebMCP tools requires verifying tool discovery, schema correctness, execution
    behavior, UI updates, and error handling. Use the Model Context Tool Inspector extension
    for interactive testing and Chrome DevTools for programmatic inspection.
  </overview>

  <chrome_extension>
    <name>Model Context Tool Inspector</name>
    <description>
      A Chrome Extension that integrates with DevTools to inspect, test, and debug
      WebMCP tools registered on any page. It provides a visual interface to see all
      registered tools, inspect their schemas, execute them with test inputs, and
      test tools with Gemini 2.5 Flash for real agent interaction testing.
    </description>
    <capabilities>
      <capability>View all registered tools (both imperative and declarative) on the current page.</capability>
      <capability>Inspect the full JSON Schema for each tool's parameters.</capability>
      <capability>Execute tools with manually entered parameter values.</capability>
      <capability>Test tools with Gemini 2.5 Flash to simulate real agent behavior.</capability>
      <capability>Integrates as a panel in Chrome DevTools.</capability>
    </capabilities>
  </chrome_extension>

  <manual_testing>
    <description>
      Use the Model Context Tool Inspector extension UI to manually test tools without
      writing any test code. Open DevTools, navigate to the extension panel, and interact
      with tools directly.
    </description>
    <steps>
      <step order="1">Install the Model Context Tool Inspector Chrome Extension.</step>
      <step order="2">Open Chrome DevTools on the page with WebMCP tools.</step>
      <step order="3">Navigate to the Model Context Tool Inspector panel.</step>
      <step order="4">Verify all expected tools appear in the tool list.</step>
      <step order="5">Select a tool and review its schema, parameter descriptions, and annotations.</step>
      <step order="6">Enter test parameter values in the provided input fields.</step>
      <step order="7">Execute the tool and verify the returned content is correct.</step>
      <step order="8">Observe the page to confirm UI updated appropriately.</step>
      <step order="9">Optionally, use the Gemini 2.5 Flash integration to test with a real agent.</step>
    </steps>
  </manual_testing>

  <console_testing>
    <description>
      Query the navigator.modelContext object directly from Chrome DevTools console
      for programmatic inspection and testing.
    </description>
    <commands>
      <command purpose="Check if WebMCP is available">
        'modelContext' in navigator
      </command>
      <command purpose="Inspect the modelContext object">
        navigator.modelContext
      </command>
      <command purpose="List registered tools (inspect object properties)">
        console.dir(navigator.modelContext)
      </command>
    </commands>
  </console_testing>

  <live_demo>
    <url>https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/</url>
    <description>
      A React-based flight search demo that implements WebMCP tools. Use this as a
      reference implementation and testing sandbox. Open it in Chrome 146+ with the
      Model Context Tool Inspector to see tools in action.
    </description>
  </live_demo>

  <verification_checklist>
    <category name="Tool Discovery">
      <check>All expected tools appear in the Model Context Tool Inspector.</check>
      <check>Tool names match the intended identifiers.</check>
      <check>Tool descriptions are clear and accurately describe behavior.</check>
      <check>Declarative tools (from forms) are auto-detected alongside imperative tools.</check>
    </category>

    <category name="Schema Correctness">
      <check>All parameters are present in the schema with correct types.</check>
      <check>Required parameters are listed in the required array.</check>
      <check>Enum values match the expected options.</check>
      <check>Parameter descriptions are helpful and specific.</check>
      <check>For declarative tools, HTML input types map to the expected schema types.</check>
    </category>

    <category name="Execution Behavior">
      <check>Execute with valid parameters returns expected content array.</check>
      <check>Returned text is descriptive and actionable for the agent.</check>
      <check>Execute with invalid parameters returns a descriptive error message.</check>
      <check>Execute with missing required parameters returns an appropriate error.</check>
      <check>Async operations complete before the result is returned.</check>
    </category>

    <category name="UI Updates">
      <check>The page UI reflects the result of tool execution before the return.</check>
      <check>Both human-triggered and agent-triggered actions produce identical UI states.</check>
      <check>CSS pseudo-classes (:tool-form-active, :tool-submit-active) apply correctly.</check>
      <check>Loading indicators or spinners behave correctly during agent interaction.</check>
    </category>

    <category name="Error Handling">
      <check>Error messages include what went wrong and how to fix it.</check>
      <check>Rate limit errors return a clear wait-time message.</check>
      <check>Network failures return a descriptive error rather than crashing.</check>
      <check>Invalid enum values return the list of valid options.</check>
    </category>

    <category name="State Management">
      <check>Tools update correctly when application state changes (provideContext).</check>
      <check>Stale tools are removed when no longer applicable.</check>
      <check>clearContext removes all tools as expected.</check>
      <check>Tools register correctly after page is fully loaded.</check>
    </category>
  </verification_checklist>
</reference>
