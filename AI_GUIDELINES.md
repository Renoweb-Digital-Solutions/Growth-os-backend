# AI & Vibe Coders Guidelines (Backend)

This repository follows strict code quality and documentation standards. AI agents and vibe coders MUST adhere to the following rules:

## 1. Complex Logic Documentation
Whenever implementing or modifying complex logic in controllers, services, or middleware, you MUST include comments that break down the reasoning and the mechanism.

**Format:**
```javascript
// Reason: [Why this approach was chosen or why this logic is necessary]
// How: [How the logic works under the hood]
```

## 2. Error Handling
- Do NOT use `try/catch` blocks in Express controllers.
- Wrap all async controller functions with the `asyncHandler` utility.
- Allow the global error middleware to handle exceptions.

## 3. Data Flow Documentation
You MUST explicitly document how data is flowing through the backend:
- Detail the path from Route -> Controller -> Service -> Model.
- Explain transformations, external API calls, and where state is modified.

## 4. Documentation Requirements for Changes
- **CHANGES_TIMELINE.md:** For every new implementation or significant change, you MUST add an entry to `CHANGES_TIMELINE.md`. This entry must include a detailed technical overview, database schema updates, and reasoning.
- **README.md:** Always update `README.md` when architectural or data flow changes happen. The README must act as the central technical doc and include markdown diagrams (e.g., Mermaid) visualizing the backend architecture and data flow.

## 5. Production Readiness
- Ensure proper input validation before database interactions.
- Avoid exposing sensitive data (e.g., passwords, raw stack traces) in API responses.
