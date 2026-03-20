<reference id="webmcp-tool-design">
  <overview>
    Effective WebMCP tool design determines how well AI agents can interact with your
    website. Well-designed tools are atomic, composable, clearly named, and return
    actionable results. These guidelines apply to both imperative and declarative APIs.
  </overview>

  <naming>
    <principles>
      <principle>Use specific action verbs that describe exactly what happens.</principle>
      <principle>Distinguish between execution and initiation when relevant.</principle>
      <principle>Use kebab-case for tool names.</principle>
      <principle>Keep names concise but unambiguous.</principle>
    </principles>
    <examples>
      <good name="create-event">Specific verb, clear outcome.</good>
      <bad name="start-event-creation-process">Unnecessarily verbose, describes a process not an action.</bad>
      <good name="search-flights">Direct action, clear domain.</good>
      <bad name="flight-tool">Vague, does not describe what action is performed.</bad>
      <good name="add-to-cart">Specific verb, clear target.</good>
      <bad name="handle-cart-action">Ambiguous, could mean anything.</bad>
      <good name="confirm-booking">Distinguishes final action from browsing/selecting steps.</good>
      <good name="open-settings-panel">Clearly initiates UI change rather than modifying settings.</good>
    </examples>
  </naming>

  <descriptions>
    <principles>
      <principle>Start with a verb (Search, Create, Add, Remove, Update).</principle>
      <principle>Describe what the tool does and when it should be used.</principle>
      <principle>Use positive language. Describe what to do, not what to avoid.</principle>
      <principle>Avoid negations like "Do not use this when..." as agents process positive instructions more reliably.</principle>
      <principle>Be specific enough that the agent can decide whether this tool fits its current task.</principle>
    </principles>
    <examples>
      <good>"Search for available flights between two cities on a specific date. Use when the user wants to find flight options."</good>
      <bad>"This tool is for flights. Don't use it for hotels."</bad>
      <good>"Add the specified item to the user's shopping cart with the given quantity."</good>
      <bad>"Cart tool."</bad>
      <good>"Remove a previously added item from the shopping cart by its product ID."</good>
      <bad>"Don't use this to add items. Only for removing."</bad>
    </examples>
  </descriptions>

  <schema_design>
    <principles>
      <principle>Accept raw user input rather than requiring computed or transformed values.</principle>
      <principle>Use explicit types for every property.</principle>
      <principle>Explain business logic behind options in parameter descriptions.</principle>
      <principle>Use meaningful enum values, not opaque IDs or codes.</principle>
      <principle>Provide parameter descriptions that help the agent populate values correctly.</principle>
    </principles>
    <examples>
      <good_schema context="Accept city names, not airport codes">
        {
          type: "object",
          properties: {
            origin: {
              type: "string",
              description: "Departure city name, e.g. 'San Francisco' or 'New York'"
            }
          }
        }
      </good_schema>
      <bad_schema context="Requires agent to know airport codes">
        {
          type: "object",
          properties: {
            origin: {
              type: "string",
              description: "IATA airport code"
            }
          }
        }
      </bad_schema>
      <good_schema context="Meaningful enum values">
        {
          type: "object",
          properties: {
            class: {
              type: "string",
              enum: ["economy", "business", "first"],
              description: "Travel class. Economy is cheapest, first is most expensive with premium services."
            }
          }
        }
      </good_schema>
      <bad_schema context="Opaque IDs as enum">
        {
          type: "object",
          properties: {
            class: {
              type: "string",
              enum: ["CLS_01", "CLS_02", "CLS_03"]
            }
          }
        }
      </bad_schema>
    </examples>
  </schema_design>

  <reliability>
    <principles>
      <principle>Validate strictly in code, not just via schema constraints. Schema validation is a hint; code validation is the guarantee.</principle>
      <principle>Return descriptive error messages that help the agent self-correct on retry.</principle>
      <principle>Handle rate limits gracefully by returning a clear message rather than failing silently.</principle>
      <principle>Ensure the UI has been updated before returning the result so agents can verify the outcome visually.</principle>
    </principles>
    <error_return_pattern>
      // Good: descriptive error enabling self-correction
      return {
        content: [{
          type: "text",
          text: "Error: Date must be in the future. You provided 2024-01-01. Please use a date after today."
        }]
      };

      // Bad: generic error
      return {
        content: [{ type: "text", text: "Invalid input." }]
      };
    </error_return_pattern>
    <rate_limit_pattern>
      return {
        content: [{
          type: "text",
          text: "Rate limit reached. Please wait 30 seconds before searching again."
        }]
      };
    </rate_limit_pattern>
  </reliability>

  <strategy>
    <principles>
      <principle>Design atomic tools that do one thing well. Agents compose multi-step workflows themselves.</principle>
      <principle>Make tools composable so they work together naturally without rigid ordering.</principle>
      <principle>Eliminate overlapping tools. If two tools can do the same thing, combine them into one with a parameter to differentiate.</principle>
      <principle>Trust agent flow control. Do not embed global task management logic inside tools.</principle>
      <principle>Do not instruct agents on which tool to call next. Let the agent decide based on its task.</principle>
    </principles>
    <examples>
      <good context="Atomic, composable tools">
        Tools: search-flights, select-flight, add-passengers, confirm-booking
        Each tool handles one step. The agent chains them as needed.
      </good>
      <bad context="Monolithic tool trying to manage workflow">
        Tool: book-flight (searches, selects, adds passengers, and confirms all in one)
        Too many responsibilities. Agent cannot retry individual steps.
      </bad>
      <good context="Single tool with differentiating parameter">
        Tool: update-cart-item (with action param: "increase-quantity" | "decrease-quantity" | "remove")
      </good>
      <bad context="Overlapping tools">
        Tools: increase-cart-quantity, decrease-cart-quantity, remove-from-cart
        Three separate tools that all modify the same cart item.
      </bad>
    </examples>
  </strategy>

  <ui_synchronization>
    <description>
      Always ensure the UI reflects the result of a tool execution before returning.
      Agents may visually verify that an action succeeded by observing the page state.
      If the execute function returns before the UI updates, the agent may incorrectly
      conclude the action failed.
    </description>
    <pattern>
      execute: async (params) => {
        const result = await performAction(params);
        await updateUI(result);       // Wait for UI to reflect changes
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        };
      }
    </pattern>
  </ui_synchronization>
</reference>
