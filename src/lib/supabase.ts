import { createClient } from "@supabase/supabase-js";

// Shared Supabase admin client — single instance per Lambda cold start
// Never instantiate createClient() inside route handlers
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error("[Supabase] NEXT_PUBLIC_SUPABASE_URL is not configured");
}

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const supabasePublic = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
