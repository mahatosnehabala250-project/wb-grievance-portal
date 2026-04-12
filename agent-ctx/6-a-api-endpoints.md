# Task ID: 6-a — API Endpoints: Announcements & Comments

## Agent: Main Agent

## Work Log
- Read `/home/z/my-project/worklog.md` for project context and auth patterns
- Read existing `/api/complaints/[id]/route.ts` to match auth pattern (`getTokenFromRequest` + `verifyToken`)
- Read `@/lib/jwt.ts` to understand `verifyToken`, `getTokenFromRequest`, and `JWTPayload` interface
- Read `prisma/schema.prisma` — confirmed Comment model exists with fields: id, complaintId, content, actorId, actorName, createdAt
- Found existing `/api/complaints/[id]/comments/route.ts` — rewrote to match spec exactly
- Created `/api/announcements/route.ts` — new endpoint with hardcoded announcements
- ESLint: 0 errors
- Dev server: running on port 3000, compiles successfully

## Files Created/Modified
1. **`/home/z/my-project/src/app/api/announcements/route.ts`** (NEW)
   - GET: Returns 5 hardcoded announcements sorted by timestamp (most recent first)
   - Types: info, warning, success with low/medium/high priority
   - Error handling with try/catch, returns 500 on failure

2. **`/home/z/my-project/src/app/api/complaints/[id]/comments/route.ts`** (REWRITTEN)
   - GET: Auth required → validates complaint exists → returns comments (id, content, actorName, createdAt) ordered by createdAt desc
   - POST: Auth required → validates complaint exists → role-based permission check (BLOCK/DISTRICT) → validates content (required, max 2000 chars) → creates Comment record → creates ActivityLog entry (action: 'COMMENT', description: 'Comment added by {name}') → returns 201 with comment
   - Proper HTTP status codes: 200, 201, 400, 401, 403, 404, 500
   - Uses `payload.name` for actorName (not username)

## Verification
- `bun run lint`: 0 errors
- Dev server: Ready on port 3000
