Generate unit tests for the specified function, class, or module.

Steps:
1. Read the source code and understand its behavior
2. Identify the project's existing test framework (jest, vitest, pytest, go test, etc.) — match it
3. Generate tests covering:
   - **Happy path** — normal inputs, expected outputs
   - **Edge cases** — empty input, boundary values, large input
   - **Error handling** — invalid input, exceptions, error codes
4. Write the test file following the project's existing test patterns and naming conventions

Rules:
- Prefer real assertions over snapshot tests
- Keep each test focused on one behavior
- Use descriptive test names that explain the scenario
- Don't mock what you can call directly
