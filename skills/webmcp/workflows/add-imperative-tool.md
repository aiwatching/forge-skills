# Workflow: Add Imperative Tool

<required_reading>
**Read these reference files NOW:**
1. references/imperative-api.md
</required_reading>

<process>
Step 1: Define the Tool Specification
- Choose a specific, verb-first name in kebab-case (e.g., "search-flights", "add-to-cart")
- Write a clear description: verb-first, explains what the tool does and when to use it
- Define inputSchema as a JSON Schema object with typed properties, descriptions, and required array
- Prefer accepting raw user input (free-text strings) over rigid enums where possible

Step 2: Write the Execute Function
- Validate input parameters and return descriptive errors for invalid input
- Perform the business logic (API call, DOM manipulation, state update)
- Update the UI to reflect the action (show results, loading states, confirmation)
- Return a result object with `{ content: [{ type: "text", text: "..." }] }` format
- The text in the return should describe what happened, not just echo input

Step 3: Register the Tool
- For a single standalone tool, use `navigator.modelContext.registerTool()`
- For a set of tools that change together (e.g., per page), use `navigator.modelContext.provideContext()`
- If using provideContext, include ALL tools for the current state in every call (it replaces the full set)

Step 4: Hook into App Lifecycle
- For SPAs: register/update tools on route change or component mount
- For multi-page: register on DOMContentLoaded or module load
- Clean up tools on component unmount or route exit if using registerTool (call returned cleanup function)

Step 5: Test in Inspector Extension
- Open the Model Context Tool Inspector panel
- Verify the tool appears with correct name, description, and schema
- Execute with valid parameters and confirm correct result and UI update
- Execute with invalid parameters and confirm descriptive error returned

**Template pattern:**

```javascript
navigator.modelContext.registerTool({
  name: "action-name",
  description: "Verb-first description of what this does and when to use it",
  inputSchema: {
    type: "object",
    properties: {
      param1: { type: "string", description: "What this param is" },
      param2: { type: "number", description: "What this param is" }
    },
    required: ["param1"]
  },
  execute: async ({ param1, param2 }) => {
    // 1. Validate input
    if (!param1 || param1.trim() === "") {
      return {
        content: [{ type: "text", text: "Error: param1 is required and cannot be empty" }],
        isError: true
      };
    }

    // 2. Perform action
    const result = await performAction(param1, param2);

    // 3. Update UI
    updateUI(result);

    // 4. Return result
    return {
      content: [{ type: "text", text: `Successfully performed action: ${result.summary}` }]
    };
  }
});
```

**provideContext pattern (for SPA page-level tools):**

```javascript
navigator.modelContext.provideContext({
  tools: [
    {
      name: "tool-one",
      description: "First tool for this page",
      inputSchema: { type: "object", properties: {}, required: [] },
      execute: async () => {
        return { content: [{ type: "text", text: "Done" }] };
      }
    },
    {
      name: "tool-two",
      description: "Second tool for this page",
      inputSchema: { type: "object", properties: {}, required: [] },
      execute: async () => {
        return { content: [{ type: "text", text: "Done" }] };
      }
    }
  ]
});
```
</process>

<anti_patterns>
- Using generic names like "do-thing" or "handle-action" instead of specific verbs
- Not validating input before performing actions
- Returning raw data dumps instead of human-readable result descriptions
- Forgetting `isError: true` on error return objects
- Calling provideContext with a partial tool list (it replaces the entire set)
- Not awaiting async operations before returning the result
- Registering tools before navigator.modelContext is available
- Using camelCase or PascalCase for tool names instead of kebab-case
</anti_patterns>

<success_criteria>
- Tool appears in Model Context Tool Inspector with correct metadata
- Tool name is specific, verb-first, and kebab-case
- Tool description clearly explains what it does and when to use it
- inputSchema accurately describes all parameters with types and descriptions
- Execute function validates input and returns descriptive errors
- Execute function performs the action and updates the UI
- Return value uses the correct `{ content: [{ type: "text", text }] }` format
- Tool handles edge cases (empty input, missing optional params, network errors)
</success_criteria>
