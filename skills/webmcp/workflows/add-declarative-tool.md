# Workflow: Add Declarative Tool

<required_reading>
**Read these reference files NOW:**
1. references/declarative-api.md
</required_reading>

<process>
Step 1: Identify the HTML Form to Annotate
- Locate the `<form>` element that represents the user action to expose
- Confirm the form has proper input elements with name attributes
- Verify the form works correctly for normal user submission before adding WebMCP

Step 2: Add Core Tool Attributes to the Form
- Add `toolname="action-name"` with a specific, verb-first, kebab-case name
- Add `tooldescription="Verb-first description of what this form does and when to use it"`
- These two attributes are the minimum required to expose a form as a WebMCP tool

Step 3: Enrich Input Descriptions (Optional but Recommended)
- Add `toolparamtitle="Human Label"` to inputs that need a clearer name than their name attribute
- Add `toolparamdescription="What to enter here"` to inputs that need usage guidance
- These help the AI agent understand what values to provide

Step 4: Decide on Auto-Submit Behavior
- If the form should auto-submit when the agent invokes it: add `toolautosubmit` attribute to the form
- If the form should only be pre-filled (user confirms): omit toolautosubmit
- Auto-submit is appropriate when the action is safe and reversible or when confirmation is not needed

Step 5: Handle Auto-Submit with respondWith (if toolautosubmit is set)
- Add a submit event listener to the form
- Check `event.agentInvoked` to distinguish agent submissions from user submissions
- Call `event.respondWith(promise)` to return structured data back to the agent
- The promise should resolve to `{ content: [{ type: "text", text: "..." }] }`

Step 6: Add Event Listeners for UI Feedback
- Listen for `toolactivated` on the form to show loading/active states
- Listen for `toolcancel` on the form to revert UI if the agent cancels
- These events fire on the form element itself

Step 7: Test in Inspector Extension
- Open the Model Context Tool Inspector panel
- Verify the form appears as a tool with correct name, description, and parameters
- Execute the tool and verify form fields are populated correctly
- If auto-submit: verify the form submits and respondWith returns data
- If manual: verify form is pre-filled and awaits user confirmation

**Manual-submit form template:**

```html
<form toolname="search-products"
      tooldescription="Search the product catalog by keyword, category, or price range">
  <input type="text"
         name="query"
         toolparamtitle="Search Query"
         toolparamdescription="Keywords to search for in product names and descriptions">
  <select name="category"
          toolparamtitle="Category"
          toolparamdescription="Product category to filter by">
    <option value="">All Categories</option>
    <option value="electronics">Electronics</option>
    <option value="clothing">Clothing</option>
  </select>
  <button type="submit">Search</button>
</form>
```

**Auto-submit form template:**

```html
<form toolname="subscribe-newsletter"
      tooldescription="Subscribe an email address to the newsletter"
      toolautosubmit>
  <input type="email"
         name="email"
         toolparamtitle="Email Address"
         toolparamdescription="The email address to subscribe">
  <button type="submit">Subscribe</button>
</form>

<script>
document.querySelector('form[toolname="subscribe-newsletter"]')
  .addEventListener('submit', (e) => {
    if (e.agentInvoked) {
      e.respondWith(
        (async () => {
          const formData = new FormData(e.target);
          const email = formData.get('email');
          const result = await subscribeEmail(email);
          return {
            content: [{
              type: "text",
              text: `Successfully subscribed ${email} to the newsletter`
            }]
          };
        })()
      );
    }
  });
</script>
```

**Event listener template:**

```javascript
const form = document.querySelector('form[toolname="search-products"]');

form.addEventListener('toolactivated', () => {
  form.classList.add('agent-active');
  // Show loading indicator or highlight the form
});

form.addEventListener('toolcancel', () => {
  form.classList.remove('agent-active');
  form.reset();
  // Revert any UI changes
});
```
</process>

<anti_patterns>
- Adding toolautosubmit without a respondWith handler (agent gets no response)
- Not checking e.agentInvoked in submit handler (breaks normal user submissions)
- Using toolname values that conflict with imperative tool names
- Forgetting name attributes on inputs (they become invisible to the agent)
- Adding WebMCP attributes to forms that are broken for normal users
- Using generic descriptions like "Submit this form" instead of explaining the action
- Not handling the toolcancel event (leaves UI in loading state)
</anti_patterns>

<success_criteria>
- Form appears as a tool in Model Context Tool Inspector with correct metadata
- Tool name is specific, verb-first, and kebab-case
- Tool description clearly explains the action
- All meaningful inputs have name attributes and optionally toolparamtitle/toolparamdescription
- Agent can invoke the tool and form fields populate correctly
- If auto-submit: respondWith returns structured data to the agent
- If manual: form is pre-filled and awaits user confirmation
- toolactivated and toolcancel events update UI appropriately
- Normal user submission still works correctly (no regression)
</success_criteria>
