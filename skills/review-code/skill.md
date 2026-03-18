Review the current uncommitted changes (`git diff` and `git diff --cached`).

For each changed file, check:
1. **Bugs** — logic errors, off-by-one, null/undefined, race conditions
2. **Security** — injection, hardcoded secrets, missing input validation
3. **Performance** — unnecessary loops, missing indexes, N+1 queries
4. **Style** — naming, dead code, overly complex logic

Output format:
- Group findings by file
- Use severity: 🔴 critical, 🟡 warning, 🔵 suggestion
- For each finding: file:line, severity, one-line description, suggested fix
- End with a summary: total findings by severity, overall assessment (approve / request changes)

If there are no issues, say so briefly.
