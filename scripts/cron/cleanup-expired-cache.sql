-- ============================================================================
-- Cron: cleanup-expired-cache.sql
-- Schedule: Nightly (recommended: 02:00 UTC via pg_cron or Vercel cron)
-- Purpose:  Remove expired rows from query_cache to keep the table lean
--           and the ivfflat index performant.
--
-- Requirements: 34.11, 26.4 — Design §v1.1.7
--
-- Usage with pg_cron (if available):
--   SELECT cron.schedule('cleanup-expired-cache', '0 2 * * *',
--     $$DELETE FROM query_cache WHERE expires_at < now() - interval '1 day'$$
--   );
--
-- Usage with Vercel cron / external scheduler:
--   POST /api/cron/cleanup-cache (calls this SQL via supabase-js)
-- ============================================================================

DELETE FROM query_cache
 WHERE expires_at < now() - interval '1 day';
