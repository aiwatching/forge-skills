<reference id="webmcp-declarative-api">
  <overview>
    The declarative API exposes WebMCP tools through HTML form attributes. The browser
    automatically generates JSON Schema from the form structure, making this the simplest
    way to create tools from existing forms. No JavaScript is required for basic tool
    declaration, though JavaScript is needed for respondWith handling and custom behavior.
  </overview>

  <form_attributes>
    <attribute name="toolname" applies_to="form" required="true">
      <description>
        Declares the form as a WebMCP tool and sets its name. The form becomes
        discoverable by AI agents once this attribute is present.
      </description>
      <example>&lt;form toolname="search-flights"&gt;</example>
    </attribute>

    <attribute name="tooldescription" applies_to="form" required="true">
      <description>
        Describes what the tool does and when to use it. Should be verb-first
        and specific. The agent uses this to decide when to invoke the tool.
      </description>
      <example>&lt;form toolname="search-flights" tooldescription="Search for available flights between two cities on a specific date."&gt;</example>
    </attribute>

    <attribute name="toolautosubmit" applies_to="form" required="false">
      <description>
        When present, the form automatically submits after the agent fills in all fields.
        Without this attribute, the agent fills fields but the form waits for explicit submission.
      </description>
      <example>&lt;form toolname="search-flights" tooldescription="..." toolautosubmit&gt;</example>
    </attribute>

    <attribute name="toolparamtitle" applies_to="input, select, textarea" required="false">
      <description>
        Sets a human-readable title for the parameter in the generated schema. If omitted,
        the input's name attribute is used.
      </description>
      <example>&lt;input name="from" toolparamtitle="Origin City"&gt;</example>
    </attribute>

    <attribute name="toolparamdescription" applies_to="input, select, textarea" required="false">
      <description>
        Provides a detailed description for the parameter. If omitted, the associated
        label element text is used as the description. Use this for additional context
        beyond what the label provides.
      </description>
      <example>&lt;input name="from" toolparamdescription="The departure city name, e.g. San Francisco"&gt;</example>
    </attribute>
  </form_attributes>

  <schema_auto_generation>
    <description>
      The browser automatically generates a JSON Schema from the form structure.
      Input types, attributes, and structure all map to schema properties.
    </description>

    <type_mappings>
      <mapping html="input[type=text]" schema="string" />
      <mapping html="input[type=email]" schema="string" />
      <mapping html="input[type=url]" schema="string" />
      <mapping html="input[type=tel]" schema="string" />
      <mapping html="input[type=search]" schema="string" />
      <mapping html="input[type=password]" schema="string" />
      <mapping html="input[type=number]" schema="number" />
      <mapping html="input[type=range]" schema="number" />
      <mapping html="input[type=date]" schema="string" />
      <mapping html="input[type=checkbox]" schema="boolean" />
      <mapping html="textarea" schema="string" />
      <mapping html="select" schema="string with oneOf (enum-like)" notes="Each option becomes an entry in a oneOf array" />
      <mapping html="input[type=radio] (group)" schema="string with oneOf (enum-like)" notes="Radio buttons sharing a name become enum options" />
    </type_mappings>

    <required_handling>
      Inputs with the HTML required attribute are added to the schema's required array.
    </required_handling>

    <label_handling>
      Associated label text (via for attribute or wrapping) becomes the parameter description
      in the schema when toolparamdescription is not specified.
    </label_handling>
  </schema_auto_generation>

  <radio_group_known_issue>
    <description>
      For radio button groups, the toolparamdescription attribute must be placed on
      the FIRST input element in the group. Placing it on other radio inputs in the
      group will not work as expected. This is a known limitation.
    </description>
    <example>
      &lt;input type="radio" name="class" value="economy"
             toolparamdescription="Select the travel class for the flight." checked&gt;
      &lt;label&gt;Economy&lt;/label&gt;
      &lt;input type="radio" name="class" value="business"&gt;
      &lt;label&gt;Business&lt;/label&gt;
      &lt;input type="radio" name="class" value="first"&gt;
      &lt;label&gt;First Class&lt;/label&gt;
    </example>
  </radio_group_known_issue>

  <respond_with_pattern>
    <description>
      The respondWith pattern lets you intercept form submission and return structured
      results to the agent. Use it with the toolactivated or submit event on the form.
      Call e.preventDefault() first, then e.respondWith(promise) to provide the tool result.
    </description>
    <example>
      const form = document.querySelector('form[toolname="search-flights"]');

      form.addEventListener('submit', (e) => {
        e.preventDefault();

        const formData = new FormData(form);
        const params = Object.fromEntries(formData);

        e.respondWith(
          (async () => {
            const results = await searchFlights(params);
            updateUI(results);
            return {
              content: [{ type: "text", text: JSON.stringify(results) }]
            };
          })()
        );
      });
    </example>
  </respond_with_pattern>

  <agent_invoked_property>
    <description>
      The submit event object includes an agentInvoked boolean property. It is true
      when an AI agent triggered the form submission and false when a human user
      submitted the form. Use this to branch logic when needed.
    </description>
    <example>
      form.addEventListener('submit', (e) => {
        e.preventDefault();

        if (e.agentInvoked) {
          // Agent triggered: return structured data via respondWith
          e.respondWith(
            processAndReturnResults(new FormData(form))
          );
        } else {
          // Human triggered: navigate or update UI normally
          displayResultsPage(new FormData(form));
        }
      });
    </example>
  </agent_invoked_property>

  <submission_flow>
    <step order="1">Agent discovers the tool via the form's toolname attribute.</step>
    <step order="2">Agent reads the auto-generated schema to understand parameters.</step>
    <step order="3">Agent fills in form fields with appropriate values.</step>
    <step order="4">If toolautosubmit is present, form submits automatically. Otherwise agent triggers submit.</step>
    <step order="5">The toolactivated window event fires (with toolName property).</step>
    <step order="6">The form's submit event fires (with agentInvoked: true).</step>
    <step order="7">Event handler calls e.preventDefault() then e.respondWith(promise).</step>
    <step order="8">The promise resolves with { content: [{ type: "text", text: "..." }] }.</step>
    <step order="9">The result is returned to the agent.</step>
  </submission_flow>

  <complete_example>
    &lt;form toolname="search-flights"
          tooldescription="Search for available flights between two cities on a specific date."
          toolautosubmit&gt;

      &lt;label for="origin"&gt;Origin City&lt;/label&gt;
      &lt;input type="text" id="origin" name="origin" required
             toolparamdescription="Departure city name, e.g. San Francisco"&gt;

      &lt;label for="destination"&gt;Destination City&lt;/label&gt;
      &lt;input type="text" id="destination" name="destination" required
             toolparamdescription="Arrival city name, e.g. New York"&gt;

      &lt;label for="date"&gt;Travel Date&lt;/label&gt;
      &lt;input type="date" id="date" name="date" required&gt;

      &lt;label for="class"&gt;Travel Class&lt;/label&gt;
      &lt;select id="class" name="class"&gt;
        &lt;option value="economy"&gt;Economy&lt;/option&gt;
        &lt;option value="business"&gt;Business&lt;/option&gt;
        &lt;option value="first"&gt;First Class&lt;/option&gt;
      &lt;/select&gt;

      &lt;button type="submit"&gt;Search&lt;/button&gt;
    &lt;/form&gt;

    &lt;script&gt;
      const form = document.querySelector('form[toolname="search-flights"]');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        e.respondWith(
          searchFlightsAPI(data).then(results => {
            renderResults(results);
            return { content: [{ type: "text", text: JSON.stringify(results) }] };
          })
        );
      });
    &lt;/script&gt;
  </complete_example>
</reference>
