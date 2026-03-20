<template_description>
Scaffolding template for annotating HTML forms as WebMCP declarative tools. Copy the appropriate pattern and adapt to your form.
</template_description>

<basic_form>

```html
<!-- Basic declarative tool: agent fills form, user clicks submit -->
<form toolname="TOOL_NAME"
      tooldescription="VERB_FIRST_DESCRIPTION"
      action="/YOUR_ENDPOINT"
      method="POST">

  <label for="field1">Field 1 Label</label>
  <input type="text" name="field1" id="field1"
         toolparamtitle="Field 1 Title"
         toolparamdescription="What this field accepts">

  <label for="field2">Field 2 Label</label>
  <select name="field2" id="field2" required
          toolparamtitle="Field 2 Title"
          toolparamdescription="Explanation of options">
    <option value="option_a">Option A description</option>
    <option value="option_b">Option B description</option>
  </select>

  <button type="submit">Submit</button>
</form>
```

</basic_form>

<autosubmit_form>

```html
<!-- Auto-submit declarative tool: agent fills AND submits, gets result back -->
<form toolautosubmit
      toolname="TOOL_NAME"
      tooldescription="VERB_FIRST_DESCRIPTION"
      action="/YOUR_ENDPOINT">

  <label for="query">Search Query</label>
  <input type="text" name="query" id="query"
         toolparamdescription="The search query to execute">

  <button type="submit">Search</button>
</form>

<script>
  document.querySelector('form[toolname="TOOL_NAME"]')
    .addEventListener("submit", (e) => {
      e.preventDefault();

      // Validate form
      const formData = new FormData(e.target);
      const query = formData.get("query");

      if (!query) {
        if (e.agentInvoked) {
          e.respondWith(Promise.resolve("Error: query is required"));
        }
        return;
      }

      // Perform action
      const resultPromise = performSearch(query).then((results) => {
        // Update UI with results
        renderResults(results);
        // Return structured result to agent
        return JSON.stringify({ found: results.length, results });
      });

      if (e.agentInvoked) {
        e.respondWith(resultPromise);
      }
    });
</script>
```

</autosubmit_form>

<event_listeners>

```javascript
// Add UI feedback for agent interactions
window.addEventListener('toolactivated', ({ toolName }) => {
  console.log(`Agent activated tool: ${toolName}`);
  // Optional: show loading indicator, highlight form
});

window.addEventListener('toolcancel', ({ toolName }) => {
  console.log(`Agent cancelled tool: ${toolName}`);
  // Optional: remove loading indicator, reset form highlight
});
```

</event_listeners>

<custom_css>

```css
/* Customize agent-active visual feedback */
form:tool-form-active {
  outline: 2px solid var(--accent-color, #3b82f6);
  outline-offset: 4px;
  transition: outline 0.2s ease;
}

button:tool-submit-active,
input[type="submit"]:tool-submit-active {
  outline: 2px solid var(--success-color, #10b981);
  outline-offset: 2px;
}
```

</custom_css>

<placeholders>

| Placeholder | Replace With |
|-------------|-------------|
| `TOOL_NAME` | snake_case tool name (e.g., `search_products`) |
| `VERB_FIRST_DESCRIPTION` | "Search products by keyword and category" |
| `/YOUR_ENDPOINT` | Your form's action URL |

</placeholders>

<schema_mapping>

How HTML inputs map to JSON Schema:

| HTML Input | Schema Type | Notes |
|------------|-------------|-------|
| `<input type="text">` | `"string"` | |
| `<input type="number">` | `"number"` | |
| `<input type="email">` | `"string"` | |
| `<input type="checkbox">` | `"boolean"` | |
| `<input type="radio">` | `"string"` with `enum` | toolparamdescription on FIRST radio |
| `<select>` | `"string"` with `enum`/`oneOf` | Options become enum values |
| `<textarea>` | `"string"` | |
| `required` attribute | Added to `required` array | |
| `<label>` | Becomes `description` | Unless overridden by toolparamdescription |

</schema_mapping>
