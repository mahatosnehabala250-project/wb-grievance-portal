---
Task ID: 12
Agent: Main Agent
Task: Add Export Button to ComplaintsView and Citizen Feedback Section to SettingsView

Work Log:
- Read worklog.md for full project context (Task IDs 1-11, ~4900 lines single-file architecture)
- Read ComplaintsView.tsx (733 lines) and SettingsView.tsx (261 lines) before modifications
- Modified ComplaintsView.tsx:
  - Added `handleServerExport` useCallback that builds URL with `/api/export?format=csv` + optional `&status={filterStatus}` + `&token=...`
  - Uses `window.open(url, '_blank')` to trigger download
  - Shows `toast.success('Export started', { description: 'Your CSV file is being downloaded' })`
  - Replaced existing "Export CSV" button onClick from client-side `exportCSV()` to `handleServerExport`
  - Kept client-side `exportCSV` function for bulk actions toolbar usage
- Created `/api/export/route.ts`:
  - GET endpoint with CSV format support
  - Auth via query param `token` (since window.open can't set Authorization header)
  - Role-based filtering (BLOCK sees only block complaints, DISTRICT sees district)
  - Optional `status` filter parameter
  - Returns CSV with Content-Disposition attachment header
- Added `Feedback` model to `prisma/schema.prisma`:
  - Fields: id, name, email?, message, category (default: General), rating (default: 5), createdAt
  - Pushed to database with `bun run db:push` — success
- Created `/api/feedback/route.ts`:
  - POST endpoint for feedback submission
  - Validates name and message are required
  - Validates category against whitelist
  - Clamps rating to 1-5 range
  - Stores in database, returns 201 on success
- Modified SettingsView.tsx:
  - Added 6 feedback form state variables (name, email, category, rating, message, loading)
  - Added `handleFeedbackSubmit` useCallback that POSTs to `/api/feedback`
  - On success: toast.success and clear all form fields
  - On error: toast.error with description
  - Added "💬 Citizen Feedback" Card section between Notifications and About sections
  - Includes: Name input (required, red asterisk), Email input (optional), Category select dropdown (6 options), Star rating (1-5 clickable stars with amber fill), Textarea for feedback message, Submit button with loading spinner state, Disclaimer text
  - Updated About section animation delay from 0.4 to 0.5 to maintain stagger

Verification:
- ESLint: 0 errors
- Dev server: GET / 200, GET /api/auth/me 401 (expected - no token)
- Prisma schema synced and client regenerated
- All existing functionality preserved — no breaking changes

Stage Summary:
- 1 modified component: ComplaintsView (server-side export)
- 1 modified component: SettingsView (feedback section)
- 1 new API route: GET /api/export (CSV export)
- 1 new API route: POST /api/feedback (feedback submission)
- 1 new Prisma model: Feedback
