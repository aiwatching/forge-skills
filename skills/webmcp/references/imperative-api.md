<reference id="webmcp-imperative-api">
  <overview>
    The imperative API provides programmatic control over WebMCP tool registration
    via JavaScript. Access it through the window.navigator.modelContext object,
    available in Chrome 146+. Use this API when tools depend on dynamic application
    state, need complex execute logic, or must be registered/removed conditionally.
  </overview>

  <entry_point>
    <object>window.navigator.modelContext</object>
    <description>
      The primary interface for all imperative WebMCP operations. Always check for
      existence before use: if ('modelContext' in navigator) { ... }
    </description>
  </entry_point>

  <methods>
    <method name="registerTool">
      <signature>navigator.modelContext.registerTool(toolDefinition)</signature>
      <description>
        Registers a single tool additively. Does not affect existing tools.
        Use when adding a new capability without disturbing current registrations.
      </description>
      <parameters>
        <param name="name" type="string" required="true">
          Unique tool identifier. Use kebab-case with specific verbs (e.g., "search-flights", "add-to-cart").
        </param>
        <param name="description" type="string" required="true">
          What the tool does and when to use it. Verb-first, positive language.
        </param>
        <param name="inputSchema" type="object" required="true">
          JSON Schema object defining accepted parameters. Must have type: "object" at root.
        </param>
        <param name="annotations" type="object" required="false">
          Optional metadata hints for the agent (e.g., { readOnlyHint: "true" }).
        </param>
        <param name="execute" type="function" required="true">
          Async function receiving a params object. Must return a result object with content array.
        </param>
      </parameters>
      <example>
        navigator.modelContext.registerTool({
          name: "search-flights",
          description: "Search for available flights between two cities on a given date.",
          inputSchema: {
            type: "object",
            properties: {
              origin: { type: "string", description: "Departure city name" },
              destination: { type: "string", description: "Arrival city name" },
              date: { type: "string", description: "Travel date in YYYY-MM-DD format" }
            },
            required: ["origin", "destination", "date"]
          },
          annotations: {
            readOnlyHint: "true"
          },
          execute: async (params) => {
            const results = await flightAPI.search(params);
            return {
              content: [{ type: "text", text: JSON.stringify(results) }]
            };
          }
        });
      </example>
    </method>

    <method name="unregisterTool">
      <signature>navigator.modelContext.unregisterTool(name)</signature>
      <description>
        Removes a single tool by its registered name. Use when a specific capability
        is no longer available (e.g., user logged out, feature disabled).
      </description>
      <parameters>
        <param name="name" type="string" required="true">
          The exact name string used when the tool was registered.
        </param>
      </parameters>
      <example>
        navigator.modelContext.unregisterTool("search-flights");
      </example>
    </method>

    <method name="provideContext">
      <signature>navigator.modelContext.provideContext({ tools: [...] })</signature>
      <description>
        Replaces ALL currently registered tools with the provided array. Use when
        application state changes significantly and the full tool set needs updating
        (e.g., page navigation, user role change, multi-step workflow transitions).
        This is a replace-all operation, not additive.
      </description>
      <parameters>
        <param name="tools" type="array" required="true">
          Array of tool definition objects, each with the same shape as registerTool's parameter
          (name, description, inputSchema, annotations, execute).
        </param>
      </parameters>
      <example>
        navigator.modelContext.provideContext({
          tools: [
            {
              name: "confirm-booking",
              description: "Confirm the selected flight booking and proceed to payment.",
              inputSchema: {
                type: "object",
                properties: {
                  flightId: { type: "string", description: "Selected flight identifier" },
                  passengers: { type: "number", description: "Number of passengers" }
                },
                required: ["flightId", "passengers"]
              },
              execute: async (params) => {
                const confirmation = await bookingAPI.confirm(params);
                return {
                  content: [{ type: "text", text: `Booking confirmed: ${confirmation.id}` }]
                };
              }
            }
          ]
        });
      </example>
    </method>

    <method name="clearContext">
      <signature>navigator.modelContext.clearContext()</signature>
      <description>
        Removes all registered tools. Use during cleanup, logout, or when no tools
        should be available (e.g., loading states, error states).
      </description>
      <example>
        navigator.modelContext.clearContext();
      </example>
    </method>
  </methods>

  <input_schema_reference>
    <description>
      inputSchema follows standard JSON Schema format. The root must be type: "object".
    </description>
    <structure>
      {
        type: "object",
        properties: {
          paramName: {
            type: "string" | "number" | "boolean" | "array" | "object",
            description: "What this parameter is and how to populate it",
            enum: ["option1", "option2"]  // optional, constrains to specific values
          }
        },
        required: ["paramName"]  // array of required property names
      }
    </structure>
    <supported_types>
      <type name="string">Text values. Use description to specify format expectations.</type>
      <type name="number">Numeric values (integer or float).</type>
      <type name="boolean">True or false values.</type>
      <type name="array">Lists of items. Specify items schema with items property.</type>
      <type name="object">Nested objects. Define nested properties and required arrays.</type>
    </supported_types>
  </input_schema_reference>

  <execute_function>
    <description>
      The execute function receives a params object matching the inputSchema and must
      return a result object containing a content array.
    </description>
    <return_format>
      {
        content: [
          { type: "text", text: "Result message or JSON string" }
        ]
      }
    </return_format>
    <guidelines>
      - Always return descriptive text so the agent understands what happened.
      - For errors, return an error message in the content text (do not throw).
      - Ensure UI has been updated before returning so the agent can verify changes visually.
      - The function can be async and perform network requests, DOM updates, etc.
    </guidelines>
  </execute_function>

  <decision_tree>
    <decision context="Adding a new tool without affecting others">
      Use registerTool. It is additive and leaves existing tools intact.
    </decision>
    <decision context="Removing a single tool">
      Use unregisterTool with the tool name.
    </decision>
    <decision context="Application state changed significantly (navigation, role change, workflow step)">
      Use provideContext to replace the entire tool set at once. This avoids
      stale tools lingering from a previous state.
    </decision>
    <decision context="All tools should be removed (logout, error state, loading)">
      Use clearContext to remove everything.
    </decision>
  </decision_tree>

  <annotations_reference>
    <description>
      Annotations provide optional metadata hints to the AI agent about tool behavior.
      They do not enforce behavior but help the agent make better decisions.
    </description>
    <known_annotations>
      <annotation name="readOnlyHint" value="true|false">
        Indicates the tool only reads data and does not modify state.
      </annotation>
    </known_annotations>
  </annotations_reference>
</reference>
