# Global API Response Standard — FlirtTime Backend

This document defines the mandatory API response standards for every new or modified API in the existing production FlirtTime backend.

---

## 1. No Duplicate or Redundant Fields

Never return multiple fields representing the same value unless each field has a clearly documented, separate purpose.

### Bad response:
```json
{
  "id": "123",
  "commentId": "123",
  "replyId": "123",
  "comment": "Hello",
  "message": "Hello",
  "text": "Hello",
  "reply": "Hello",
  "createdAt": "...",
  "created_at": "..."
}
```

### Good response:
```json
{
  "id": "123",
  "text": "Hello",
  "createdAt": "..."
}
```

- Choose field names according to the resource and existing API conventions.
- Do not include `commentId`, `replyId`, `message`, `text`, or other aliases together when they contain identical information and have no distinct purpose.

---

## 2. Use One Consistent Naming Convention

- Follow the existing public API convention, strictly `camelCase`.
- Do not expose both `createdAt` and `created_at`.
- Do not return database column names and API aliases together unnecessarily.
- Keep internal database field names separate from the public response DTO.

---

## 3. Return Only Necessary Data

Include only fields required by the client for the requested operation.

- Do not return complete database models.
- Do not include internal IDs, duplicate user objects, unused metadata, debug information, or unrelated entities.
- Do not repeat the same user information at multiple levels without a real use case.
- Avoid returning empty or redundant fields unless the frontend contract requires them.
- Exclude sensitive information, credentials, tokens, private contact details, and internal implementation data.
- For list APIs, return compact objects; include detailed nested objects only when required by the feature.

---

## 4. Standard Response Envelope

Follow the existing API response convention. For new endpoints, use:

### Success:
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {}
}
```

### Failure:
```json
{
  "success": false,
  "message": "A clear error message",
  "data": null
}
```

- Include pagination metadata only for paginated endpoints.
- Do not wrap the same data multiple times or duplicate `success`, `message`, or `data` fields (e.g. no `data.data`).

---

## 5. Define a Response DTO for Every API

Before implementing an endpoint:
1. Define the exact request and response contract.
2. Identify the minimum required fields.
3. Map database entities to an explicit response DTO.
4. Remove duplicate aliases and unused properties.
5. Validate the actual serialized JSON response.
6. Add response-shape tests that prevent redundant fields from returning.

*Never use unrestricted ORM model serialization as the public API response.*

---

## 6. Preserve Existing Production APIs

- Do not blindly remove fields from existing APIs because the mobile application may already depend on them.
- Inspect frontend usage and existing API contracts before changing response structures.
- For new APIs, use the clean standard immediately.
- For existing APIs, remove redundant fields only after confirming compatibility; use a versioned or coordinated migration when necessary.
- Do not change database schemas or unrelated business logic just to clean response JSON.
- Do not create duplicate endpoints or duplicate serializers.
- Keep authentication, authorization, transactions, validations, and existing functionality intact.

---

## 7. Automated Validation

Add tests that verify:
- No duplicate aliases with identical meanings.
- No `snake_case`/`camelCase` duplicates.
- No unexpected ORM fields.
- Correct response envelope and data types.
- Only documented fields are returned.
- Existing mobile app integrations remain compatible.

*Note: Do not compare values alone to decide whether fields are redundant: two fields may legitimately contain the same value while representing different concepts.*

---

## 8. Required Workflow

Before coding any new API:
1. Inspect related existing APIs and frontend usage.
2. Reuse existing models, services, validators, and response utilities (`src/utils/response.ts`).
3. Define the minimal response DTO.
4. Implement the API using existing architectural conventions.
5. Test the actual JSON response and relevant regression cases.

After implementation, report:
- The endpoint and HTTP method
- Final response example
- Removed redundant fields / aliases
- Compatibility considerations
- Actual test results
