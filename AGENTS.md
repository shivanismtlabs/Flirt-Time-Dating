# FlirtTime Backend — Developer & Agent Guidelines

## 1. Existing APIs & Client Integrations Safety (CRITICAL)
- **Do NOT blindly modify or break existing API responses.** Current APIs are live and tightly integrated with the mobile app and frontend.
- Inspect frontend/mobile contracts before altering response structures.
- For existing APIs, remove redundant fields only after confirming compatibility; use versioned or coordinated migrations when required.

## 2. Mandatory Standards for All Future APIs & Revisions
Strictly adhere to the 8-pillar Global API Response Standard defined in [api-response-standards.md](file:///.agents/rules/api-response-standards.md):

### Envelope
- **Success**:
  ```json
  {
    "success": true,
    "message": "Operation completed successfully",
    "data": {}
  }
  ```
- **Error**:
  ```json
  {
    "success": false,
    "message": "A clear error message",
    "data": null
  }
  ```
  *(Include pagination metadata only when required for paginated endpoints. No `data.data` nesting or duplicate keys).*

### The 8 Pillars
1. **No Duplicate or Redundant Fields**: Never return aliases representing the same value (e.g. `id` vs `commentId` vs `replyId`, `text` vs `message` vs `comment`, `createdAt` vs `created_at`). Select the canonical property name based on resource and convention.
2. **One Consistent Naming Convention**: Strictly `camelCase` across all public response DTOs. Separate internal DB columns from public fields.
3. **Return Only Necessary Data**: Return compact DTOs with fields required by the screen. Exclude raw ORM models, internal IDs, repeated user profiles, tokens, passwords, OTPs, and secrets.
4. **Standard Response Envelope**: Unified `{ success, message, data }` envelope via `src/utils/response.ts` (`sendSuccess`, `sendError`).
5. **Response DTO for Every API**: Map DB entities to an explicit response DTO before serialization. Never return raw Sequelize models.
6. **Preserve Existing Production APIs**: Backward compatibility first. Do not break mobile apps by stripping fields without compatibility checks.
7. **Automated Validation**: Write contract tests verifying no duplicate aliases, no snake/camel duplicates, no raw ORM leakage, and correct data types.
8. **Required Workflow**: Inspect contracts -> Reuse architecture -> Define DTO -> Implement -> Test actual serialized JSON & regression suites -> Report findings.
