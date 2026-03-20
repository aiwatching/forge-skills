<reference id="webmcp-events-and-css">
  <overview>
    WebMCP provides window-level events and CSS pseudo-classes to help web developers
    respond to agent interactions and provide visual feedback. These mechanisms enable
    UI synchronization between human and agent interactions.
  </overview>

  <window_events>
    <event name="toolactivated">
      <description>
        Fires on the window object when an AI agent pre-fills form fields and triggers
        a tool invocation. The event includes a toolName property identifying which tool
        was activated. This event fires before the form's submit event.
      </description>
      <properties>
        <property name="toolName" type="string">The name of the tool that was activated.</property>
      </properties>
      <example>
        window.addEventListener('toolactivated', (e) => {
          console.log(`Agent activated tool: ${e.toolName}`);
          // Perform setup, logging, or UI preparation
        });
      </example>
    </event>

    <event name="toolcancel">
      <description>
        Fires on the window object when an agent cancels a tool invocation or when
        form.reset() is called on a tool form. Use this to clean up any state or UI
        changes that were made in anticipation of tool execution.
      </description>
      <example>
        window.addEventListener('toolcancel', (e) => {
          console.log('Agent cancelled tool invocation');
          // Clean up partial state or UI changes
          resetFormState();
        });
      </example>
    </event>
  </window_events>

  <event_listener_patterns>
    <pattern name="basic_activation_handler">
      window.addEventListener('toolactivated', ({ toolName }) => {
        switch (toolName) {
          case 'search-flights':
            showSearchingIndicator();
            break;
          case 'confirm-booking':
            showConfirmationSpinner();
            break;
        }
      });
    </pattern>

    <pattern name="logging_and_analytics">
      window.addEventListener('toolactivated', ({ toolName }) => {
        analytics.track('agent_tool_used', { tool: toolName, timestamp: Date.now() });
      });
    </pattern>

    <pattern name="cancel_cleanup">
      window.addEventListener('toolcancel', () => {
        hideAllSpinners();
        resetFormFields();
      });
    </pattern>
  </event_listener_patterns>

  <css_pseudo_classes>
    <pseudo_class name=":tool-form-active">
      <description>
        Applied to a form element while an AI agent is actively interacting with it
        (filling fields, preparing to submit). Use this to visually indicate that an
        agent is working with the form.
      </description>
      <applies_to>form elements with a toolname attribute</applies_to>
      <default_style>outline: light-dark(blue, cyan) dashed 1px</default_style>
      <example>
        form:tool-form-active {
          outline: 2px solid #4285f4;
          background-color: rgba(66, 133, 244, 0.05);
        }
      </example>
    </pseudo_class>

    <pseudo_class name=":tool-submit-active">
      <description>
        Applied to the submit button of a tool form while the agent is actively
        interacting with the form. Use this to visually indicate which button will
        be triggered by the agent.
      </description>
      <applies_to>submit buttons within tool forms</applies_to>
      <default_style>outline: light-dark(blue, cyan) dashed 1px</default_style>
      <example>
        button:tool-submit-active {
          outline: 2px solid #4285f4;
          box-shadow: 0 0 8px rgba(66, 133, 244, 0.4);
        }
      </example>
    </pseudo_class>
  </css_pseudo_classes>

  <customizing_default_styles>
    <description>
      Chrome applies default dashed outline styles to active tool forms and submit buttons.
      You can override these with your own styles using the pseudo-classes. To remove
      the default styles entirely, set outline to none.
    </description>
    <example_remove_defaults>
      form:tool-form-active {
        outline: none;
      }

      button:tool-submit-active {
        outline: none;
      }
    </example_remove_defaults>
    <example_custom_styles>
      form:tool-form-active {
        outline: none;
        border: 2px solid #34a853;
        border-radius: 8px;
        transition: border-color 0.3s ease;
      }

      form:tool-form-active input,
      form:tool-form-active select {
        background-color: #f0f9f0;
      }

      button:tool-submit-active {
        outline: none;
        background-color: #34a853;
        color: white;
        transform: scale(1.02);
        transition: all 0.2s ease;
      }
    </example_custom_styles>
  </customizing_default_styles>

  <ui_synchronization>
    <description>
      Web developers must ensure the UI reflects the current state regardless of whether
      a human or an AI agent triggered the change. Both interaction paths should result
      in the same visual state. The agent may observe the page to verify tool results,
      so the UI must be accurate.
    </description>
    <guidelines>
      <guideline>Update the DOM before returning from the execute function or respondWith promise.</guideline>
      <guideline>Use the same rendering functions for both human-triggered and agent-triggered actions.</guideline>
      <guideline>If using a framework (React, Vue, etc.), ensure state updates have been flushed to the DOM before returning.</guideline>
      <guideline>Test that the page looks correct after both human and agent interactions.</guideline>
    </guidelines>
    <pattern>
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));

        if (e.agentInvoked) {
          e.respondWith(
            processRequest(data).then(result => {
              renderResults(result);  // Same render function used for humans
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            })
          );
        } else {
          processRequest(data).then(result => {
            renderResults(result);  // Same render function
          });
        }
      });
    </pattern>
  </ui_synchronization>
</reference>
