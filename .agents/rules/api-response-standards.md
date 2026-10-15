# Mandatory API Response Standards for All Future FlirtTime APIs

## Critical Rule
- **Existing APIs**: Never modify or break existing, already-integrated API responses unless explicitly requested.
- **New APIs**: From now on, whenever creating any new API or adding a new endpoint to the existing FlirtTime backend, strictly follow the standards below.

---

### 1. Standard Response Structure

Every new API must follow the same response envelope:

#### Success:
```json
{
  "success": true,
  "message": "Data fetched successfully",
  "data": {}
}
```

#### Error:
```json
{
  "success": false,
  "message": "Something went wrong",
  "data": null
}
```

Include validation errors or pagination metadata only when required, following the existing project conventions.

---

### 2. Clean and Non-Duplicate Response Data

- Return only the fields required by the API's purpose and its consuming frontend/mobile screen.
- Never return the same information under multiple keys.
- Use one canonical camelCase field name consistently.
- Do not create duplicate aliases such as `eyeColor` and `eyecolor`, or `hairColor` and `haircolor`.
- Do not repeat the same profile information at the root and inside nested objects without a genuine requirement.
- Avoid redundant IDs, URLs, timestamps, counts, and derived fields.
- For media, return only the necessary media identifier, canonical image URL, thumbnail URL, media type, and other required metadata.
- Do not expose entire database models or unnecessary database columns.
- Do not include internal fields, secrets, tokens, password hashes, OTPs, or sensitive implementation details in public responses.

---

### 3. Correct and Meaningful Data Structure

- Keep related fields grouped in appropriate nested objects.
- Use arrays for collections and objects for individual resources.
- Return `[]` for empty collections and `null` for optional values that are genuinely unavailable.
- Maintain consistent field names and data types across related APIs.
- Do not introduce unnecessary nesting such as `data.data`.
- Include only relevant fields; do not add properties merely for the sake of making responses look uniform.

---

### 4. Reuse Existing Backend Architecture

- Reuse the existing response helper (`src/utils/response.ts`: `sendSuccess`, `sendError`), DTOs, serializers, validation, and error-handling conventions.
- Do not create duplicate response utilities.
- Keep controllers clean and avoid returning raw Sequelize models.
- Preserve existing authentication, authorization, business logic, API routes, database behavior, and integrations.
- Do not modify already integrated API response contracts unless explicitly requested.

---

### 5. Verification Checklist Before Completing Every New API

Before implementing an endpoint, determine the exact response fields required by its consumer. Before marking it complete:

1. Review the response JSON for duplicate or unnecessary fields.
2. Verify field names and types against related existing APIs.
3. Confirm the response follows the standard envelope.
4. Add or update response-contract tests.
5. Verify success, error, null, and empty-list scenarios where applicable.
6. Confirm that no sensitive information or unintended database fields are exposed.

---

### 6. Important Rules

- These standards apply to every future API, endpoint, and new feature developed in this project.
- Do not create an API first and clean its response later. Design the response structure correctly from the beginning.
- Do not add compatibility aliases or duplicate keys unless explicitly required and approved.
- Do not change existing APIs or frontend/mobile integrations as part of implementing a new API.
- If an existing project convention conflicts with these standards, explain the conflict and choose a backward-compatible solution instead of silently breaking functionality.
