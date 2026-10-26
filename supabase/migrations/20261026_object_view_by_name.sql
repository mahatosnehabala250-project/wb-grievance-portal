-- Screens that only know a block or panchayat by name ("Hura", "হুড়া") can
-- link to it too: object_view now resolves a name to its LGD code first, then
-- hands over to the code-keyed implementation. The returned `key` is always the
-- code, so a link made from a name settles on the canonical address.
alter function public.object_view(text, text, text[], boolean, boolean) rename to object_view_by_code;

create or replace function public.object_view(
  p_type text, p_key text, p_seats text[] default null,
  p_show_demo boolean default false, p_show_test boolean default false)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_key text := btrim(normalize(coalesce(p_key, ''), nfc));
  v_code text;
  v_n int;
begin
  if p_type = 'block' and v_key !~ '^\d+$' then
    select b.block_code into v_code
    from lgd_blocks b
    where b.district_code in (select served_district_codes())
      and (norm_block(b.block_name) = norm_block(v_key) or b.block_name_bn = v_key)
    limit 1;
    if v_code is null then return jsonb_build_object('error', 'not_found'); end if;
    v_key := v_code;
  elsif p_type = 'gp' and v_key !~ '^\d+$' then
    -- panchayat names repeat across blocks; a bare name only resolves when it is unique
    select count(*), min(g.gp_code) into v_n, v_code
    from lgd_gram_panchayats g
    where g.district_code in (select served_district_codes())
      and (lower(g.gp_name) = lower(v_key) or g.gp_name_bn = v_key);
    if v_n <> 1 then return jsonb_build_object('error', 'not_found'); end if;
    v_key := v_code;
  end if;
  return public.object_view_by_code(p_type, v_key, p_seats, p_show_demo, p_show_test);
end;
$$;

revoke all on function public.object_view(text, text, text[], boolean, boolean) from public, anon, authenticated;
revoke all on function public.object_view_by_code(text, text, text[], boolean, boolean) from public, anon, authenticated;
grant execute on function public.object_view(text, text, text[], boolean, boolean) to service_role;
grant execute on function public.object_view_by_code(text, text, text[], boolean, boolean) to service_role;
