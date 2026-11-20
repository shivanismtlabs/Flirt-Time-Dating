# FlirtTime Backend — Free Tier Specification & Implementation Details

> **Document Status**: Implemented & Verified with Tests  
> **Compliance**: Strict adherence to [.agents/rules/api-response-standards.md](file:///e:/Myproject/Flirt-Time-Dating/.agents/rules/api-response-standards.md) and [AGENTS.md](file:///e:/Myproject/Flirt-Time-Dating/AGENTS.md) (Zero Breaking Changes to Existing APIs)

---

## 1. Verified Decisions & Specifications

The engineering team and senior have confirmed the following 5 specific rules:

1. **Daily Reset & Quotas**:
   - Reset time: **00:00:00 IST** (Indian Standard Time, UTC+05:30).
   - Free Tier Like Limit: **10 likes / day**.
   - Nopes / Passes: **Unlimited**.
2. **Super Like Quota & Pricing**:
   - Free users get **1 free Super Like (one-time lifetime gift)**.
   - Extra Super Likes cost **20 coins each** (deducted atomically via `CoinTransaction`).
3. **Likes & Compliments Tabs**:
   - **No 403 error**.
   - Returns HTTP 200 with `isLocked: true`, `totalCount`, and `items` (with masked names e.g. `"A***"` and `isBlurred: true`).
   - Free users can view blur cards with upgrade prompts; paid users view unmasked profiles.
4. **Chat Access Rules**:
   - Client checks match status when opening chat.
   - Server returns **403 `MATCH_REQUIRED_TO_CHAT`** when a free user attempts to send a message without a mutual active match.
   - **Premium users (`isSubscribed: true`) can chat without a prior match.**
5. **Quota / Limits Endpoint**:
   - `GET /api/v1/users/limits` (and alias `/api/v1/discovery/limits`) provides daily like counter, remaining likes, reset timestamp, free super like status, and coin balance for the Discover screen.

---

## 2. Implemented Endpoints & API Contracts

### A. User Limits & Quotas
* **Endpoint**: `GET /api/v1/users/limits` *(Alias: `GET /api/v1/discovery/limits`)*
* **Headers**: `Authorization: Bearer <token>`
* **Success Response (Free User)**:
```json
{
  "success": true,
  "message": "User limits fetched successfully",
  "data": {
    "isSubscribed": false,
    "likes": {
      "limit": 10,
      "used": 3,
      "remaining": 7,
      "resetsAt": "2026-10-21T18:30:00.000Z"
    },
    "nopes": {
      "isUnlimited": true
    },
    "superLikes": {
      "hasFree": true,
      "freeRemaining": 1,
      "costInCoins": 20,
      "userCoins": 50
    },
    "tabs": {
      "likesTabLocked": true,
      "complimentsTabLocked": true,
      "youLikedTabLocked": false,
      "matchesTabLocked": false
    },
    "chat": {
      "canChatWithoutMatch": false
    }
  }
}
```

---

### B. Discovery Swipe Actions
* **Endpoint**: `POST /api/v1/discovery/actions`
* **Body**: `{ "targetUserId": "<uuid>", "action": "like" | "nope" | "super_like" }`
* **Behavior**:
  - `action: "like"`: If free user exceeds 10 likes today (since 00:00 IST), returns **403**:
    ```json
    {
      "success": false,
      "message": "Daily like limit reached (10/10). Resets at midnight IST.",
      "error": "DAILY_LIKE_LIMIT_REACHED"
    }
    ```
  - `action: "super_like"`:
    - 1st Super Like: Free (no coins deducted).
    - 2nd+ Super Like: Deducts 20 coins from `user.coins` and logs to `CoinTransaction`. If coins < 20, returns **403**:
      ```json
      {
        "success": false,
        "message": "Insufficient coins. Extra Super Like requires 20 coins.",
        "error": "INSUFFICIENT_COINS"
      }
      ```
  - `action: "nope"`: Always permitted and unlimited.

---

### C. Interactions (Likes & Compliments Tabs)
* **Endpoint**: `GET /api/v1/interactions?type=likes|compliments|you_liked|matches`
* **Response for Free Users (`type=likes`)**:
```json
{
  "success": true,
  "message": "Interactions fetched successfully",
  "data": {
    "type": "likes",
    "isLocked": true,
    "totalCount": 15,
    "items": [
      {
        "interactionId": "uuid",
        "username": "A***",
        "user": {
          "id": "uuid",
          "name": "A***",
          "username": "A***",
          "age": 24,
          "profilePhotoUrl": "https://...",
          "isVerified": false,
          "distanceKm": 5,
          "locationLabel": "Mumbai",
          "isBlurred": true
        },
        "interaction": {
          "type": "likes",
          "createdAt": "2026-10-21T10:00:00.000Z",
          "action": "like"
        }
      }
    ],
    "pagination": {
      "limit": 20,
      "nextCursor": "...",
      "hasMore": false
    }
  }
}
```
* **Tabs Accessibility Matrix**:
  - `likes`: Locked for free users (`isLocked: true`, masked items with `isBlurred: true`).
  - `compliments`: Locked for free users (`isLocked: true`, messages masked).
  - `you_liked`: **Open** (`isLocked: false`, unmasked).
  - `matches`: **Open** (`isLocked: false`, unmasked).

---

### D. Direct Chat Messaging & Match Guard
* **Endpoint**: `POST /api/v1/chat/messages` *(Alias: `POST /api/v1/chat/send`)*
* **Body**: `{ "recipientId": "<uuid>", "content": "Hello!" }`
* **Behavior**:
  - **Free User to Unmatched User**: Blocked with **403**:
    ```json
    {
      "success": false,
      "message": "You can only chat after a mutual match. Upgrade to Premium to chat directly.",
      "error": "MATCH_REQUIRED_TO_CHAT"
    }
    ```
  - **Free User to Matched User**: Allowed (HTTP 201).
  - **Premium User**: Allowed even without prior match (HTTP 201).

---

## 3. Implementation Code Reference

1. [freeTierLimit.service.ts](file:///e:/Myproject/Flirt-Time-Dating/src/services/freeTierLimit.service.ts): IST midnight calculation, daily like counting, super like free quota, limits DTO.
2. [discoveryAction.service.ts](file:///e:/Myproject/Flirt-Time-Dating/src/services/discoveryAction.service.ts): 10 likes/day check, 20 coins deduction for 2nd+ super like.
3. [interaction.service.ts](file:///e:/Myproject/Flirt-Time-Dating/src/services/interaction.service.ts): `isLocked: true`, `totalCount`, and masked user cards for free tier.
4. [chat.service.ts](file:///e:/Myproject/Flirt-Time-Dating/src/services/chat.service.ts): 403 match verification guard for free users, premium bypass.
5. [chat.controller.ts](file:///e:/Myproject/Flirt-Time-Dating/src/controllers/chat.controller.ts) & [chat.routes.ts](file:///e:/Myproject/Flirt-Time-Dating/src/routes/chat.routes.ts): REST endpoints for chat messaging.
6. [user.routes.ts](file:///e:/Myproject/Flirt-Time-Dating/src/routes/user.routes.ts) & [discovery.routes.ts](file:///e:/Myproject/Flirt-Time-Dating/src/routes/discovery.routes.ts): Mounted `GET /limits`.
7. [freeTier.test.ts](file:///e:/Myproject/Flirt-Time-Dating/tests/freeTier.test.ts): 15 comprehensive unit & contract tests (all passing).
