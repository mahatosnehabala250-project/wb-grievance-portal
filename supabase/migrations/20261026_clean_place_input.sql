-- What a citizen types, or what a model passes, is rarely a bare place name:
-- "লখনপুর পঞ্চায়েত", "Hura block", or the literal "undefined" when the model
-- leaves an optional field out. Strip the trailing admin word (only as its own
-- word, so নতুনগ্রাম keeps its গ্রাম) and treat placeholders as unknown.
-- Applied live on 2026-10-26 after a WhatsApp test where the village lookup
-- received block="undefined" and gp="লখনপুর পঞ্চায়েত" and found nothing.
create or replace function public.clean_place_input(p text)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          case when lower(btrim(coalesce(normalize(p, nfc), ''))) in ('undefined', 'null', 'none', 'n/a', 'na', 'unknown')
               then '' else normalize(p, nfc) end,
          '\s+(গ্রাম\s*পঞ্চায়েত|পঞ্চায়েত|পঞ্চায়েৎ|ব্লক|গ্রাম)\s*$', ''),
        '\s+(gram\s*panchayat|panchayat|g\.?\s?p\.?|block|village|gram)\s*$', '', 'i'),
      ' ,.-'),
    '');
$$;

create or replace function public.lookup_village_coords(p_village text, p_block text default null, p_gp text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- "not known yet" arrives as '' (or "undefined") from the agent; treat it as unknown
  v_village text := coalesce(public.clean_place_input(p_village), '');
  v_block text := public.clean_place_input(p_block);
  v_gp    text := public.clean_place_input(p_gp);
  v_res_block text := public.resolve_block(v_block);
  v_skel text := public.village_skeleton(public.bn_to_latin(v_village));
  v_gps int;
  r jsonb;
begin
  r := public.lookup_village_coords_impl(
    public.bn_to_latin(v_village),
    v_res_block,
    public.resolve_gp(v_gp, v_block)
  );
  if coalesce((r->>'found')::boolean, false) then
    -- what the citizen should SEE: the confirmed Bengali where it exists
    r := r || jsonb_build_object(
      'block_display', (select coalesce(b.block_name_bn, b.block_name) from lgd_blocks b where b.block_code::text = r->>'block_code' limit 1),
      'gp_display',    (select coalesce(g.gp_name_bn, g.gp_name) from lgd_gram_panchayats g where g.gp_code::text = r->>'gp_code' limit 1)
    );
    -- how many panchayats hold a village that sounds like this one?
    if v_gp is null and length(v_skel) >= 3 then
      select count(distinct v.gp_code) into v_gps
        from lgd_villages v
       where public.village_skeleton(v.village_name) = v_skel
         and (v_res_block is null
              or v.block_code::text = (select b.block_code::text from lgd_blocks b where b.block_name = v_res_block limit 1));
      if v_gps > 1 then
        r := r || jsonb_build_object('multiple_matches', true);
      elsif v_res_block is not null then
        -- the block has done the disambiguating
        r := r || jsonb_build_object('multiple_matches', false);
      end if;
    elsif v_res_block is not null then
      r := r || jsonb_build_object('multiple_matches', false);
    end if;
  end if;
  return r;
end;
$function$;
