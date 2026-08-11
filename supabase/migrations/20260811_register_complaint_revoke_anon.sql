-- Recreating register_complaint let Supabase's default privileges hand EXECUTE
-- to anon, which the dropped twelve-argument version never had. The function is
-- SECURITY DEFINER and inserts straight into complaints, and its only guard
-- fires when auth.uid() IS NOT NULL — never true for an anonymous caller. Left
-- as it stood, anyone holding the publishable anon key could file complaints at
-- will. This restores the original grant set: postgres, authenticated,
-- service_role.
REVOKE ALL ON FUNCTION public.register_complaint(
  text, text, text, text, text, text, text, text, text, text,
  double precision, double precision, text
) FROM anon;
