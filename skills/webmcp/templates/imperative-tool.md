<template_description>
Scaffolding template for registering a WebMCP tool via the JavaScript imperative API. Copy, fill in placeholders, and adapt to your use case.
</template_description>

<single_tool>

```javascript
window.navigator.modelContext.registerTool({
  name: "TOOL_NAME",
  description: "VERB_FIRST_DESCRIPTION of what this tool does and when to use it",
  inputSchema: {
    type: "object",
    properties: {
      PARAM_NAME: {
        type: "PARAM_TYPE", // "string" | "number" | "boolean"
        description: "What this parameter represents"
      }
      // Add more properties as needed
    },
    required: ["PARAM_NAME"] // List required params
  },
  execute: async ({ PARAM_NAME }) => {
    // 1. Validate input
    if (!PARAM_NAME) {
      return {
        content: [{ type: "text", text: "Error: PARAM_NAME is required" }]
      };
    }

    // 2. Perform the action
    // YOUR_BUSINESS_LOGIC_HERE

    // 3. Update UI (ensure visible state reflects the change)
    // UPDATE_DOM_OR_STATE_HERE

    // 4. Return result
    return {
      content: [{ type: "text", text: `Successfully performed ACTION with ${PARAM_NAME}` }]
    };
  }
});
```

</single_tool>

<multiple_tools>

```javascript
// Use provideContext when registering multiple tools at once.
// NOTE: This REPLACES all previously registered tools.
window.navigator.modelContext.provideContext({
  tools: [
    {
      name: "TOOL_1_NAME",
      description: "DESCRIPTION_1",
      inputSchema: {
        type: "object",
        properties: {
          param1: { type: "string", description: "Description" }
        }
      },
      execute: async ({ param1 }) => {
        // Action + UI update
        return { content: [{ type: "text", text: "Result" }] };
      }
    },
    {
      name: "TOOL_2_NAME",
      description: "DESCRIPTION_2",
      inputSchema: {
        type: "object",
        properties: {
          param2: { type: "number", description: "Description" }
        }
      },
      execute: async ({ param2 }) => {
        // Action + UI update
        return { content: [{ type: "text", text: "Result" }] };
      }
    }
  ]
});
```

</multiple_tools>

<spa_lifecycle>

```javascript
// For SPAs: update tools on route/state changes
function registerToolsForRoute(route) {
  const toolsByRoute = {
    "/dashboard": [/* dashboard tools */],
    "/settings": [/* settings tools */],
    "/search": [/* search tools */]
  };

  const tools = toolsByRoute[route] || [];
  if (tools.length > 0) {
    window.navigator.modelContext.provideContext({ tools });
  } else {
    window.navigator.modelContext.clearContext();
  }
}

// Hook into your router (React Router, Vue Router, etc.)
// router.afterEach((to) => registerToolsForRoute(to.path));
```

</spa_lifecycle>

<placeholders>

| Placeholder | Replace With |
|-------------|-------------|
| `TOOL_NAME` | kebab-case or snake_case action name (e.g., `search_flights`) |
| `VERB_FIRST_DESCRIPTION` | "Search available flights by origin, destination, and date" |
| `PARAM_NAME` | camelCase parameter name (e.g., `searchQuery`) |
| `PARAM_TYPE` | JSON Schema type: `"string"`, `"number"`, `"boolean"` |
| `YOUR_BUSINESS_LOGIC_HERE` | Your app's actual logic |
| `UPDATE_DOM_OR_STATE_HERE` | DOM manipulation or state update |

</placeholders>
