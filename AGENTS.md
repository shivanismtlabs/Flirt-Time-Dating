# FlirtTime Backend — Developer & Agent Guidelines

## 1. Existing APIs & Client Integrations Safety (CRITICAL)
- **Do NOT modify or break existing API responses.** Current APIs are live and tightly integrated with the mobile app and frontend.
- Do not remove existing response keys or change data structures for existing endpoints.

## 2. Mandatory Standards for All Future APIs
From now on, whenever creating any new API or adding a new endpoint to the FlirtTime backend, strictly adhere to [api-response-standards.md](file:///.agents/rules/api-response-standards.md):

### Envelope
- **Success**:
  ```json
  {
    "success": true,
    "message": "Data fetched successfully",
    "data": {}
  }
  ```
- **Error**:
  ```json
  {
    "success": false,
    "message": "Something went wrong",
    "data": null
  }
  ```
  *(Include validation errors or pagination metadata only when required, following existing conventions)*

### Core Rules
1. **Clean & Non-Duplicate**:
   - Return only fields required by the consumer screen.
   - One canonical `camelCase` field name consistently (never duplicate like `eyeColor` vs `eyecolor`).
   - Avoid redundant IDs, URLs, timestamps, counts, or repeated profile info at root and nested objects.
   - Clean media objects: identifier, canonical URL, thumbnail URL, media type.
2. **Data Structure & Types**:
   - No `data.data` redundant nesting.
   - Arrays `[]` for collections (empty `[]`), objects `{}` for individual resources, `null` for unavailable optionals.
3. **Security & DTO Hygiene**:
   - Never expose raw Sequelize models.
   - Never expose `password`, OTPs, hashes, secrets, internal IDs, or sensitive columns.
4. **Architecture Reuse**:
   - Use `src/utils/response.ts` (`sendSuccess`, `sendError`). Do not create duplicate response helpers.
5. **Quality Gate**:
   - Design response correctly from the beginning (not clean up later).
   - Write/update response-contract tests covering success, error, null, and empty list scenarios.
