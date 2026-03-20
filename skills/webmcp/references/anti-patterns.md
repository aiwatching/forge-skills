<reference id="webmcp-anti-patterns">
  <overview>
    Common mistakes when implementing WebMCP tools, along with the correct approach.
    Avoiding these patterns improves agent reliability, user experience, and maintainability.
  </overview>

  <anti_patterns>
    <anti_pattern id="overlapping-tools">
      <name>Overlapping Tools</name>
      <description>
        Creating multiple tools that perform similar actions on the same resource,
        causing agent confusion about which tool to use.
      </description>
      <bad_example>
        // Three separate tools that all modify cart quantity
        registerTool({ name: "increase-cart-quantity", ... });
        registerTool({ name: "decrease-cart-quantity", ... });
        registerTool({ name: "remove-from-cart", ... });
      </bad_example>
      <good_example>
        // Single tool with an action parameter
        registerTool({
          name: "update-cart-item",
          description: "Update a cart item's quantity or remove it from the cart.",
          inputSchema: {
            type: "object",
            properties: {
              productId: { type: "string", description: "The product to update" },
              action: {
                type: "string",
                enum: ["increase-quantity", "decrease-quantity", "remove"],
                description: "The action to perform on the cart item"
              }
            },
            required: ["productId", "action"]
          },
          ...
        });
      </good_example>
    </anti_pattern>

    <anti_pattern id="vague-descriptions">
      <name>Vague Descriptions</name>
      <description>
        Using generic or unclear descriptions that do not help the agent understand
        when or how to use the tool.
      </description>
      <bad_example>
        registerTool({
          name: "flight-tool",
          description: "Handles flights.",
          ...
        });
      </bad_example>
      <good_example>
        registerTool({
          name: "search-flights",
          description: "Search for available flights between two cities on a specific date. Returns a list of flights with prices, times, and airlines.",
          ...
        });
      </good_example>
    </anti_pattern>

    <anti_pattern id="requiring-computed-input">
      <name>Requiring Computed Input</name>
      <description>
        Expecting the agent to transform or compute values before passing them as
        parameters. Agents work best with raw, natural language input.
      </description>
      <bad_example>
        // Requires agent to know IATA codes
        inputSchema: {
          properties: {
            origin: { type: "string", description: "IATA airport code (e.g., SFO)" }
          }
        }
      </bad_example>
      <good_example>
        // Accepts natural city names, resolves internally
        inputSchema: {
          properties: {
            origin: { type: "string", description: "Departure city name, e.g. 'San Francisco'" }
          }
        }
        // In execute: resolve city name to airport code internally
      </good_example>
    </anti_pattern>

    <anti_pattern id="returning-before-ui-update">
      <name>Not Updating UI Before Returning</name>
      <description>
        Returning the tool result before the page UI has been updated to reflect
        the change. The agent may observe the page and incorrectly conclude the
        action failed.
      </description>
      <bad_example>
        execute: async (params) => {
          const result = await api.doAction(params);
          updateUI(result);  // Fire and forget, UI may not be ready when agent checks
          return { content: [{ type: "text", text: "Done" }] };
        }
      </bad_example>
      <good_example>
        execute: async (params) => {
          const result = await api.doAction(params);
          await updateUI(result);  // Wait for UI to fully update
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
      </good_example>
    </anti_pattern>

    <anti_pattern id="rigid-tool-chaining">
      <name>Rigid Tool Chaining Instructions</name>
      <description>
        Embedding instructions in descriptions that dictate tool ordering or forbid
        certain sequences. Agents manage their own flow and process positive instructions
        more reliably than negative ones.
      </description>
      <bad_example>
        registerTool({
          name: "select-flight",
          description: "Select a flight. Must call search-flights first. Do not call confirm-booking after this without calling add-passengers.",
          ...
        });
      </bad_example>
      <good_example>
        registerTool({
          name: "select-flight",
          description: "Select a specific flight from the search results by its flight ID. Returns the selected flight details and available next steps.",
          ...
        });
      </good_example>
    </anti_pattern>

    <anti_pattern id="missing-error-messages">
      <name>Missing Error Messages</name>
      <description>
        Returning generic or empty errors that give the agent no information about
        what went wrong or how to correct the input.
      </description>
      <bad_example>
        execute: async (params) => {
          try {
            const result = await api.search(params);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
          } catch (e) {
            return { content: [{ type: "text", text: "Error" }] };
          }
        }
      </bad_example>
      <good_example>
        execute: async (params) => {
          try {
            const result = await api.search(params);
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
          } catch (e) {
            return {
              content: [{
                type: "text",
                text: `Error: ${e.message}. Check that the origin city "${params.origin}" is a valid city name and the date "${params.date}" is in YYYY-MM-DD format and in the future.`
              }]
            };
          }
        }
      </good_example>
    </anti_pattern>

    <anti_pattern id="schema-only-validation">
      <name>Schema-Only Validation</name>
      <description>
        Relying solely on JSON Schema constraints for input validation without
        additional validation in the execute function. Schema validation is a hint
        to the agent, not an enforcement mechanism.
      </description>
      <bad_example>
        // Only validates via schema, no code validation
        inputSchema: {
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }
          }
        },
        execute: async (params) => {
          // Directly uses params.date without checking if it's a valid/future date
          return { content: [{ type: "text", text: await api.search(params) }] };
        }
      </bad_example>
      <good_example>
        inputSchema: {
          properties: {
            date: { type: "string", description: "Travel date in YYYY-MM-DD format" }
          }
        },
        execute: async (params) => {
          const date = new Date(params.date);
          if (isNaN(date.getTime())) {
            return { content: [{ type: "text", text: `Error: "${params.date}" is not a valid date. Use YYYY-MM-DD format.` }] };
          }
          if (date &lt; new Date()) {
            return { content: [{ type: "text", text: `Error: Date must be in the future. "${params.date}" is in the past.` }] };
          }
          return { content: [{ type: "text", text: JSON.stringify(await api.search(params)) }] };
        }
      </good_example>
    </anti_pattern>

    <anti_pattern id="not-handling-agent-invoked">
      <name>Not Handling agentInvoked</name>
      <description>
        Treating agent-triggered and human-triggered form submissions identically
        when they need different code paths. Agent submissions need respondWith to
        return results; human submissions may navigate to a new page.
      </description>
      <bad_example>
        // Always navigates, breaking agent flow
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          window.location.href = '/results?' + new URLSearchParams(new FormData(form));
        });
      </bad_example>
      <good_example>
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(form));

          if (e.agentInvoked) {
            e.respondWith(
              fetchResults(data).then(results => {
                renderResults(results);
                return { content: [{ type: "text", text: JSON.stringify(results) }] };
              })
            );
          } else {
            window.location.href = '/results?' + new URLSearchParams(data);
          }
        });
      </good_example>
    </anti_pattern>

    <anti_pattern id="registering-tools-too-early">
      <name>Registering Tools Before Page Is Ready</name>
      <description>
        Registering tools before the DOM is fully loaded or before required dependencies
        are available. Tool execute functions may reference elements or APIs that
        do not exist yet.
      </description>
      <bad_example>
        // In a script tag in the head, before DOM is ready
        navigator.modelContext.registerTool({
          name: "submit-form",
          execute: async (params) => {
            const form = document.getElementById('myForm'); // May be null
            form.querySelector('[name="email"]').value = params.email;
            // ...
          }
        });
      </bad_example>
      <good_example>
        // Wait for DOM content to be loaded
        document.addEventListener('DOMContentLoaded', () => {
          navigator.modelContext.registerTool({
            name: "submit-form",
            execute: async (params) => {
              const form = document.getElementById('myForm'); // Guaranteed to exist
              form.querySelector('[name="email"]').value = params.email;
              // ...
            }
          });
        });
      </good_example>
    </anti_pattern>

    <anti_pattern id="stale-tools">
      <name>Not Using provideContext When State Changes</name>
      <description>
        Keeping stale tools registered after the application state has changed
        significantly. For example, keeping search tools available after navigating
        to a checkout page, or not updating tools after a user logs in.
      </description>
      <bad_example>
        // Register tools once and never update
        navigator.modelContext.registerTool({ name: "search-flights", ... });
        navigator.modelContext.registerTool({ name: "select-seat", ... });
        // User navigates to checkout but search-flights is still available
        // Agent may try to search again instead of completing checkout
      </bad_example>
      <good_example>
        // Update tools when application state changes
        function onNavigateToCheckout() {
          navigator.modelContext.provideContext({
            tools: [
              { name: "enter-payment", description: "Enter payment details for the booking.", ... },
              { name: "apply-promo-code", description: "Apply a promotional discount code.", ... },
              { name: "confirm-purchase", description: "Confirm and complete the purchase.", ... }
            ]
          });
        }

        function onNavigateToSearch() {
          navigator.modelContext.provideContext({
            tools: [
              { name: "search-flights", description: "Search for available flights.", ... },
              { name: "filter-results", description: "Filter search results by criteria.", ... }
            ]
          });
        }
      </good_example>
    </anti_pattern>
  </anti_patterns>
</reference>
