Analyze the specified file or code region for refactoring opportunities.

Look for:
- **Duplication** — repeated logic that can be extracted
- **Complexity** — functions too long, deeply nested, hard to follow
- **Naming** — unclear variable/function names
- **Abstraction** — missing or leaky abstractions
- **Dead code** — unused variables, unreachable branches

For each suggestion:
1. Describe the problem (with file:line reference)
2. Show the refactored code
3. Explain the benefit (shorter, clearer, testable, etc.)

Do NOT over-engineer. Only suggest changes that clearly improve the code. Three similar lines is fine — don't extract a helper for something used once.
