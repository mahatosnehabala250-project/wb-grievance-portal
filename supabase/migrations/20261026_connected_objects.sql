-- Connected objects: every seat, block, panchayat, village, booth and person
-- becomes something you can open. object_view returns the object, the trail
-- above it, what sits below it, and the complaints, booths and people linked to
-- it; object_search finds any of them by name (English or Bengali) or ticket.
--
-- p_seats limits everything to the seats the caller may see. NULL means every
-- seat in the served districts; the API decides which, never the browser.

-- LGD codes of the districts this product serves (Purulia today).
create or replace function public.served_district_codes()
returns setof text
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select d.district_code
  from lgd_districts d
  join served_districts s on lower(btrim(s.district)) = lower(btrim(d.district_name))
$$;

-- One row per complaint the caller may see, with the codes that tie it to
-- places: the village and panchayat it names, the block they sit in (or the
-- block its free-text name matches inside its own seat), and its booth.
create or replace function public.object_complaints(p_show_demo boolean, p_show_test boolean, p_seats text[])
returns table(
  id text, ticket text, citizen text, issue text, category text, urgency text, status text,
  ac text, district text, village text, village_code text, gp text, gp_code text,
  block text, block_code text, booth_key text, owner_id text, owner_name text,
  created_at timestamp, resolved_at timestamp, is_open boolean, age_days integer,
  past_due boolean, days_over integer)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select hc.id, hc.ticket, hc.citizen, hc.issue, hc.category, hc.urgency, hc.status,
         hc.ac, hc.district, hc.village, cx.village_code,
         coalesce(lg.gp_name, hc.gp), coalesce(cx.gp_code, lv.gp_code),
         hc.block, coalesce(lg.block_code, lv.block_code, lb.block_code),
         case when cb.ac_no is not null then cb.ac_no::text || '-' || cb.part_no::text end,
         hc.owner_id, hc.owner_name, hc.created_at, hc.resolved_at,
         hc.is_open, hc.age_days, hc.past_due, hc.days_over
  from home_complaints(p_show_demo, p_show_test) hc
  join complaints cx on cx.id = hc.id
  left join lgd_villages lv on lv.village_code = cx.village_code
  left join lgd_gram_panchayats lg on lg.gp_code = coalesce(cx.gp_code, lv.gp_code)
  left join lateral (
    select b.block_code from lgd_blocks b
    where norm_block(b.block_name) = norm_block(hc.block)
      and exists (select 1 from lgd_villages v
                  where v.block_code = b.block_code and lower(v.assembly_constituency) = lower(hc.ac))
    limit 1) lb on true
  left join lateral (select ac_no, part_no from complaint_booth where complaint_id = hc.id limit 1) cb on true
  where p_seats is null or lower(hc.ac) = any (select lower(s) from unnest(p_seats) s)
$$;

-- How well a name matches a query: 0 exact, 1 starts with, 2 contains, null no match.
-- Bengali input is also compared through bn_to_latin, since LGD village names are Latin.
create or replace function public.object_match_rank(p_name text, p_name_bn text, p_q text)
returns integer
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  with k as (
    select lower(p_q) ql, p_q q,
           nullif(lower(btrim(public.bn_to_latin(p_q))), '') qlat,
           lower(coalesce(p_name, '')) n, coalesce(p_name_bn, '') nb
  )
  select case
    when n = ql or nb = q or (qlat is not null and n = qlat) then 0
    when starts_with(n, ql) or (nb <> '' and starts_with(nb, q))
      or (qlat is not null and length(qlat) >= 2 and starts_with(n, qlat)) then 1
    when position(ql in n) > 0 or (nb <> '' and position(q in nb) > 0)
      or (qlat is not null and length(qlat) >= 3 and position(qlat in n) > 0) then 2
  end
  from k
$$;

create or replace function public.object_view(
  p_type text, p_key text, p_seats text[] default null,
  p_show_demo boolean default false, p_show_test boolean default false)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_seats text[] := (select array_agg(lower(s)) from unnest(p_seats) s);
  v_obj_seats text[];
  v_district text;
  v_title text; v_title_bn text; v_kind text;
  v_seat text; v_block_code text; v_block text; v_block_bn text; v_gp_code text; v_gp text; v_gp_bn text;
  v_village_code text; v_village text;
  v_trail jsonb := '[]'; v_facts jsonb := '[]';
  v_children jsonb; v_booths jsonb := '[]';
  v_team_ids text[] := '{}';
  v_body jsonb;
  v_lat numeric; v_lng numeric; v_ps text; v_ps_name text; v_ac_no int; v_kk text; v_kk_name text;
  v_role text; v_ublock text; v_villages text[];
begin
  select d.district_name into v_district
  from lgd_districts d where d.district_code in (select served_district_codes())
  order by d.district_name limit 1;

  if p_type = 'district' then
    select d.district_name into v_title
    from lgd_districts d
    where d.district_code in (select served_district_codes()) and lower(d.district_name) = lower(p_key);
    if v_title is null then return jsonb_build_object('error', 'not_found'); end if;
    v_kind := 'District';
    v_facts := jsonb_build_array(
      jsonb_build_object('label', 'Assembly seats', 'value', (select count(distinct v.assembly_constituency) from lgd_villages v
         where v.district_code in (select served_district_codes()) and (v_seats is null or lower(v.assembly_constituency) = any(v_seats)))),
      jsonb_build_object('label', 'Blocks', 'value', (select count(*) from lgd_blocks b where b.district_code in (select served_district_codes()))),
      jsonb_build_object('label', 'Panchayats', 'value', (select count(*) from lgd_gram_panchayats g where g.district_code in (select served_district_codes()))),
      jsonb_build_object('label', 'Villages', 'value', (select count(*) from lgd_villages v where v.district_code in (select served_district_codes()))),
      jsonb_build_object('label', 'Booths', 'value', (select count(*) from polling_stations p
         where v_seats is null or lower(p.ac) = any(v_seats))));
    select jsonb_build_object('title', 'Assembly seats', 'type', 'seat', 'items', coalesce(jsonb_agg(jsonb_build_object(
             'type', 'seat', 'key', s.ac, 'label', s.ac, 'sub', s.mla,
             'open', coalesce(k.open, 0), 'total', coalesce(k.total, 0), 'past_due', coalesce(k.past_due, 0))
           order by coalesce(k.open, 0) desc, s.ac), '[]'))
    into v_children
    from (select v.assembly_constituency ac,
                 (select min(m.mla_name) from constituency_block_mapping m where lower(m.constituency) = lower(v.assembly_constituency)) mla
          from lgd_villages v
          where v.district_code in (select served_district_codes())
            and (v_seats is null or lower(v.assembly_constituency) = any(v_seats))
          group by v.assembly_constituency) s
    left join (select lower(c.ac) ac, count(*) filter (where c.is_open) open, count(*) total, count(*) filter (where c.past_due) past_due
               from object_complaints(p_show_demo, p_show_test, p_seats) c group by 1) k on k.ac = lower(s.ac);
    select coalesce(array_agg(u.id), '{}') into v_team_ids from users u
    where u."isActive" and u.role_level in ('DISTRICT_ADMIN', 'MP', 'MLA')
      and (v_seats is null or lower(u.constituency) = any(v_seats) or u.role_level <> 'MLA');

  elsif p_type = 'seat' then
    select v.assembly_constituency into v_title
    from lgd_villages v
    where v.district_code in (select served_district_codes()) and lower(v.assembly_constituency) = lower(p_key)
    limit 1;
    if v_title is null then return jsonb_build_object('error', 'not_found'); end if;
    v_kind := 'Assembly seat';
    v_obj_seats := array[lower(v_title)];
    v_trail := jsonb_build_array(jsonb_build_object('type', 'district', 'key', v_district, 'label', v_district));
    v_facts := jsonb_build_array(
      jsonb_build_object('label', 'Seat number', 'value', (select min(p.ac_no) from polling_stations p where lower(p.ac) = lower(v_title))),
      jsonb_build_object('label', 'MLA', 'value', (select min(m.mla_name) from constituency_block_mapping m where lower(m.constituency) = lower(v_title))),
      jsonb_build_object('label', 'Panchayats', 'value', (select count(distinct v.gp_code) from lgd_villages v where lower(v.assembly_constituency) = lower(v_title))),
      jsonb_build_object('label', 'Villages', 'value', (select count(*) from lgd_villages v where lower(v.assembly_constituency) = lower(v_title))),
      jsonb_build_object('label', 'Booths', 'value', (select count(*) from polling_stations p where lower(p.ac) = lower(v_title))),
      jsonb_build_object('label', 'Booths with a karyakarta', 'value', (select count(*) from polling_stations p
         where lower(p.ac) = lower(v_title) and p.karyakarta_user_id is not null)));
    select jsonb_build_object('title', 'Blocks', 'type', 'block', 'items', coalesce(jsonb_agg(jsonb_build_object(
             'type', 'block', 'key', b.block_code, 'label', b.block_name, 'label_bn', b.block_name_bn,
             'sub', s.villages || ' villages',
             'open', coalesce(k.open, 0), 'total', coalesce(k.total, 0), 'past_due', coalesce(k.past_due, 0))
           order by coalesce(k.open, 0) desc, b.block_name), '[]'))
    into v_children
    from (select v.block_code, count(*) villages from lgd_villages v
          where lower(v.assembly_constituency) = lower(v_title) group by v.block_code) s
    join lgd_blocks b on b.block_code = s.block_code
    left join (select c.block_code, count(*) filter (where c.is_open) open, count(*) total, count(*) filter (where c.past_due) past_due
               from object_complaints(p_show_demo, p_show_test, p_seats) c
               where lower(c.ac) = lower(v_title) group by 1) k on k.block_code = b.block_code;
    select coalesce(array_agg(u.id), '{}') into v_team_ids from users u
    where u."isActive" and lower(u.constituency) = lower(v_title)
      and u.role_level in ('MLA', 'BLOCK_COORD', 'GP_COORD', 'KARYAKARTA');

  elsif p_type = 'block' then
    select b.block_name, b.block_name_bn into v_title, v_title_bn
    from lgd_blocks b
    where b.block_code = p_key and b.district_code in (select served_district_codes());
    if v_title is null then return jsonb_build_object('error', 'not_found'); end if;
    v_kind := 'Block';
    select array_agg(distinct lower(v.assembly_constituency)) into v_obj_seats from lgd_villages v where v.block_code = p_key;
    -- the seat holding most of this block's villages the caller can see
    select v.assembly_constituency into v_seat from lgd_villages v
    where v.block_code = p_key and (v_seats is null or lower(v.assembly_constituency) = any(v_seats))
    group by 1 order by count(*) desc limit 1;
    v_trail := jsonb_build_array(
      jsonb_build_object('type', 'district', 'key', v_district, 'label', v_district),
      jsonb_build_object('type', 'seat', 'key', v_seat, 'label', v_seat));
    v_facts := jsonb_build_array(
      jsonb_build_object('label', 'LGD block code', 'value', p_key),
      jsonb_build_object('label', 'Assembly seats', 'value', (select string_agg(distinct v.assembly_constituency, ', ') from lgd_villages v where v.block_code = p_key)),
      jsonb_build_object('label', 'Panchayats', 'value', (select count(*) from lgd_gram_panchayats g where g.block_code = p_key)),
      jsonb_build_object('label', 'Villages', 'value', (select count(*) from lgd_villages v where v.block_code = p_key)),
      jsonb_build_object('label', 'Booths', 'value', (select count(*) from polling_stations p
         join lgd_villages v on v.village_code = p.village_code where v.block_code = p_key)));
    select jsonb_build_object('title', 'Panchayats', 'type', 'gp', 'items', coalesce(jsonb_agg(jsonb_build_object(
             'type', 'gp', 'key', g.gp_code, 'label', g.gp_name, 'label_bn', g.gp_name_bn,
             'sub', (select count(*) from lgd_villages v where v.gp_code = g.gp_code) || ' villages',
             'open', coalesce(k.open, 0), 'total', coalesce(k.total, 0), 'past_due', coalesce(k.past_due, 0))
           order by coalesce(k.open, 0) desc, coalesce(k.total, 0) desc, g.gp_name), '[]'))
    into v_children
    from lgd_gram_panchayats g
    left join (select c.gp_code, count(*) filter (where c.is_open) open, count(*) total, count(*) filter (where c.past_due) past_due
               from object_complaints(p_show_demo, p_show_test, p_seats) c group by 1) k on k.gp_code = g.gp_code
    where g.block_code = p_key
      and exists (select 1 from lgd_villages v where v.gp_code = g.gp_code
                  and (v_seats is null or lower(v.assembly_constituency) = any(v_seats)));
    select coalesce(array_agg(u.id), '{}') into v_team_ids from users u
    where u."isActive" and norm_block(u.block) = norm_block(v_title)
      and u.role_level in ('BLOCK_COORD', 'GP_COORD', 'KARYAKARTA');

  elsif p_type = 'gp' then
    select g.gp_name, g.gp_name_bn, g.block_code, b.block_name, b.block_name_bn
      into v_title, v_title_bn, v_block_code, v_block, v_block_bn
    from lgd_gram_panchayats g join lgd_blocks b on b.block_code = g.block_code
    where g.gp_code = p_key and g.district_code in (select served_district_codes());
    if v_title is null then return jsonb_build_object('error', 'not_found'); end if;
    v_kind := 'Gram panchayat';
    select array_agg(distinct lower(v.assembly_constituency)) into v_obj_seats from lgd_villages v where v.gp_code = p_key;
    select v.assembly_constituency into v_seat from lgd_villages v
    where v.gp_code = p_key and (v_seats is null or lower(v.assembly_constituency) = any(v_seats))
    group by 1 order by count(*) desc limit 1;
    v_trail := jsonb_build_array(
      jsonb_build_object('type', 'district', 'key', v_district, 'label', v_district),
      jsonb_build_object('type', 'seat', 'key', v_seat, 'label', v_seat),
      jsonb_build_object('type', 'block', 'key', v_block_code, 'label', v_block, 'label_bn', v_block_bn));
    v_facts := jsonb_build_array(
      jsonb_build_object('label', 'LGD panchayat code', 'value', p_key),
      jsonb_build_object('label', 'Block', 'value', coalesce(v_block_bn, v_block), 'type', 'block', 'key', v_block_code),
      jsonb_build_object('label', 'Villages', 'value', (select count(*) from lgd_villages v where v.gp_code = p_key)),
      jsonb_build_object('label', 'Booths', 'value', (select count(*) from polling_stations p where p.gp_code = p_key)));
    select jsonb_build_object('title', 'Villages', 'type', 'village', 'items', coalesce(jsonb_agg(jsonb_build_object(
             'type', 'village', 'key', v.village_code, 'label', v.village_name,
             'sub', (select count(*) from polling_stations p where p.village_code = v.village_code) || ' booths',
             'open', coalesce(k.open, 0), 'total', coalesce(k.total, 0), 'past_due', coalesce(k.past_due, 0))
           order by coalesce(k.open, 0) desc, coalesce(k.total, 0) desc, v.village_name), '[]'))
    into v_children
    from lgd_villages v
    left join (select c.village_code, count(*) filter (where c.is_open) open, count(*) total, count(*) filter (where c.past_due) past_due
               from object_complaints(p_show_demo, p_show_test, p_seats) c group by 1) k on k.village_code = v.village_code
    where v.gp_code = p_key and (v_seats is null or lower(v.assembly_constituency) = any(v_seats));
    select coalesce(array_agg(u.id), '{}') into v_team_ids from users u
    where u."isActive" and (u.gp_code = p_key or lower(u.gp_name) = lower(v_title) and norm_block(u.block) = norm_block(v_block));

  elsif p_type = 'village' then
    select v.village_name, v.gp_code, g.gp_name, g.gp_name_bn, v.block_code, b.block_name, b.block_name_bn,
           v.assembly_constituency, v.lat, v.lng
      into v_title, v_gp_code, v_gp, v_gp_bn, v_block_code, v_block, v_block_bn, v_seat, v_lat, v_lng
    from lgd_villages v
    left join lgd_gram_panchayats g on g.gp_code = v.gp_code
    left join lgd_blocks b on b.block_code = v.block_code
    where v.village_code = p_key and v.district_code in (select served_district_codes());
    if v_title is null then return jsonb_build_object('error', 'not_found'); end if;
    v_kind := 'Village';
    v_obj_seats := array[lower(v_seat)];
    v_trail := jsonb_build_array(
      jsonb_build_object('type', 'district', 'key', v_district, 'label', v_district),
      jsonb_build_object('type', 'seat', 'key', v_seat, 'label', v_seat),
      jsonb_build_object('type', 'block', 'key', v_block_code, 'label', v_block, 'label_bn', v_block_bn),
      jsonb_build_object('type', 'gp', 'key', v_gp_code, 'label', v_gp, 'label_bn', v_gp_bn));
    v_facts := jsonb_build_array(
      jsonb_build_object('label', 'LGD village code', 'value', p_key),
      jsonb_build_object('label', 'Panchayat', 'value', coalesce(v_gp_bn, v_gp), 'type', 'gp', 'key', v_gp_code),
      jsonb_build_object('label', 'Block', 'value', coalesce(v_block_bn, v_block), 'type', 'block', 'key', v_block_code),
      jsonb_build_object('label', 'Assembly seat', 'value', v_seat, 'type', 'seat', 'key', v_seat),
      jsonb_build_object('label', 'Location', 'value', case when v_lat is not null then round(v_lat, 4) || ', ' || round(v_lng, 4) end,
                         'href', case when v_lat is not null then 'https://www.google.com/maps?q=' || v_lat || ',' || v_lng end));
    select coalesce(array_agg(u.id), '{}') into v_team_ids from users u
    where u."isActive" and (lower(v_title) = any (select lower(x) from unnest(u.assigned_villages) x)
                            or (u.gp_code is not null and u.gp_code = v_gp_code));

  elsif p_type = 'booth' then
    select p.ps_no, p.ps_name, p.ac_no, p.ac, p.village_code, v.village_name, v.gp_code, g.gp_name, g.gp_name_bn,
           v.block_code, b.block_name, b.block_name_bn, p.karyakarta_user_id, u.name
      into v_ps, v_ps_name, v_ac_no, v_seat, v_village_code, v_village, v_gp_code, v_gp, v_gp_bn,
           v_block_code, v_block, v_block_bn, v_kk, v_kk_name
    from polling_stations p
    left join lgd_villages v on v.village_code = p.village_code
    left join lgd_gram_panchayats g on g.gp_code = v.gp_code
    left join lgd_blocks b on b.block_code = v.block_code
    left join users u on u.id = p.karyakarta_user_id
    where p.ac_no::text || '-' || p.ps_no = p_key;
    if v_ps is null then return jsonb_build_object('error', 'not_found'); end if;
    v_title := 'Booth ' || v_ps;
    v_title_bn := v_ps_name;
    v_kind := 'Polling booth';
    v_obj_seats := array[lower(v_seat)];
    v_trail := jsonb_build_array(
      jsonb_build_object('type', 'district', 'key', v_district, 'label', v_district),
      jsonb_build_object('type', 'seat', 'key', v_seat, 'label', v_seat),
      jsonb_build_object('type', 'block', 'key', v_block_code, 'label', v_block, 'label_bn', v_block_bn),
      jsonb_build_object('type', 'gp', 'key', v_gp_code, 'label', v_gp, 'label_bn', v_gp_bn),
      jsonb_build_object('type', 'village', 'key', v_village_code, 'label', v_village));
    v_facts := jsonb_build_array(
      jsonb_build_object('label', 'Polling station', 'value', v_ps_name),
      jsonb_build_object('label', 'Seat and part', 'value', v_seat || ' ' || v_ac_no || ', part ' || v_ps),
      jsonb_build_object('label', 'Village', 'value', v_village, 'type', 'village', 'key', v_village_code),
      jsonb_build_object('label', 'Karyakarta', 'value', coalesce(v_kk_name, 'Nobody yet'), 'type', case when v_kk is not null then 'person' end, 'key', v_kk));
    v_team_ids := case when v_kk is not null then array[v_kk] else '{}' end;

  elsif p_type = 'person' then
    select u.name, u.role_level, u.constituency, u.block, u.assigned_villages
      into v_title, v_role, v_seat, v_ublock, v_villages
    from users u where u.id = p_key;
    if v_title is null then return jsonb_build_object('error', 'not_found'); end if;
    v_kind := case v_role
      when 'KARYAKARTA' then 'Karyakarta' when 'GP_COORD' then 'GP coordinator' when 'BLOCK_COORD' then 'Block president'
      when 'MLA' then 'MLA' when 'MP' then 'MP' when 'DISTRICT_ADMIN' then 'District president' else 'Office' end;
    if v_seats is not null
       and not (lower(coalesce(v_seat, '')) = any(v_seats))
       and not exists (select 1 from object_complaints(p_show_demo, p_show_test, p_seats) c where c.owner_id = p_key) then
      return jsonb_build_object('error', 'out_of_scope');
    end if;
    select b.block_code, b.block_name, b.block_name_bn into v_block_code, v_block, v_block_bn
    from lgd_blocks b where b.district_code in (select served_district_codes()) and norm_block(b.block_name) = norm_block(v_ublock)
    limit 1;
    v_trail := jsonb_build_array(jsonb_build_object('type', 'district', 'key', v_district, 'label', v_district));
    if v_seat is not null then
      v_trail := v_trail || jsonb_build_object('type', 'seat', 'key', v_seat, 'label', v_seat);
    end if;
    v_facts := jsonb_build_array(
      jsonb_build_object('label', 'Role', 'value', v_kind),
      jsonb_build_object('label', 'Assembly seat', 'value', v_seat, 'type', case when v_seat is not null then 'seat' end, 'key', v_seat),
      jsonb_build_object('label', 'Block', 'value', coalesce(v_block_bn, v_block), 'type', case when v_block_code is not null then 'block' end, 'key', v_block_code),
      jsonb_build_object('label', 'Villages', 'value', nullif(array_to_string(v_villages, ', '), '')));

  else
    return jsonb_build_object('error', 'not_found');
  end if;

  if v_seats is not null and v_obj_seats is not null and not (v_obj_seats && v_seats) then
    return jsonb_build_object('error', 'out_of_scope');
  end if;

  -- booths: every booth of a village or panchayat; the busiest few of a block or seat
  if p_type in ('village', 'gp', 'block', 'seat') then
    select coalesce(jsonb_agg(x.j order by x.open desc, x.total desc, x.ord), '[]') into v_booths
    from (
      select jsonb_build_object('type', 'booth', 'key', p.ac_no::text || '-' || p.ps_no, 'label', 'Booth ' || p.ps_no,
               'sub', concat_ws(', ', p.ps_name, v.village_name), 'village_code', p.village_code,
               'karyakarta', u.name, 'karyakarta_id', p.karyakarta_user_id,
               'open', coalesce(k.open, 0), 'total', coalesce(k.total, 0)) j,
             coalesce(k.open, 0) open, coalesce(k.total, 0) total,
             p.ac_no * 10000 + coalesce(substring(p.ps_no from '^\d+')::int, 0) ord
      from polling_stations p
      left join lgd_villages v on v.village_code = p.village_code
      left join users u on u.id = p.karyakarta_user_id
      left join (select c.booth_key, count(*) filter (where c.is_open) open, count(*) total
                 from object_complaints(p_show_demo, p_show_test, p_seats) c group by 1) k
             on k.booth_key = p.ac_no::text || '-' || p.ps_no
      where (v_seats is null or lower(p.ac) = any(v_seats))
        and case p_type
              when 'village' then p.village_code = p_key
              when 'gp' then p.gp_code = p_key
              when 'block' then v.block_code = p_key and coalesce(k.total, 0) > 0
              when 'seat' then lower(p.ac) = lower(v_title) and coalesce(k.total, 0) > 0
            end
      order by coalesce(k.open, 0) desc, coalesce(k.total, 0) desc
      limit case when p_type in ('village', 'gp') then 200 else 12 end
    ) x;
  end if;

  with c as (select * from object_complaints(p_show_demo, p_show_test, p_seats)),
  mine as (
    select * from c where case p_type
      when 'district' then true
      when 'seat' then lower(c.ac) = lower(v_title)
      when 'block' then c.block_code = p_key
      when 'gp' then c.gp_code = p_key
      when 'village' then c.village_code = p_key
      when 'booth' then c.booth_key = p_key
      when 'person' then c.owner_id = p_key
    end)
  select jsonb_build_object(
    'figures', (select jsonb_build_object(
        'total', count(*),
        'open', count(*) filter (where m.is_open),
        'no_owner', count(*) filter (where m.is_open and m.owner_id is null),
        'past_due', count(*) filter (where m.past_due),
        'new_30d', count(*) filter (where m.created_at > (now() at time zone 'utc') - interval '30 days'),
        'resolved_30d', count(*) filter (where m.status in ('RESOLVED', 'CLOSED')
                                         and m.resolved_at > (now() at time zone 'utc') - interval '30 days'),
        'oldest_days', max(m.age_days) filter (where m.is_open),
        'last_filed_at', max(m.created_at)) from mine m),
    'weekly', (select jsonb_agg(n order by w desc) from (
        select w, (select count(*) from mine m
                   where m.created_at >= date_trunc('week', now() at time zone 'utc') - w * interval '1 week'
                     and m.created_at <  date_trunc('week', now() at time zone 'utc') - (w - 1) * interval '1 week') n
        from generate_series(11, 0, -1) w) s),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('category', x.category, 'open', x.open, 'total', x.total)
                                             order by x.open desc, x.total desc)
        from (select coalesce(m.category, 'OTHER') category, count(*) filter (where m.is_open) open, count(*) total
              from mine m group by 1 order by 2 desc, 3 desc limit 8) x), '[]'),
    'complaints', coalesce((select jsonb_agg(to_jsonb(x) order by x.is_open desc, x.past_due desc, x.age_days desc)
        from (select m.id, m.ticket, m.citizen, m.issue, m.category, m.urgency, m.status, m.ac, m.village, m.village_code,
                     m.gp, m.gp_code, m.block, m.block_code, m.booth_key, m.owner_id, m.owner_name, m.created_at,
                     m.is_open, m.age_days, m.past_due, m.days_over
              from mine m order by m.is_open desc, m.past_due desc, m.age_days desc limit 60) x), '[]'),
    'team', coalesce((select jsonb_agg(jsonb_build_object('type', 'person', 'key', u.id, 'label', u.name,
                                'role_level', u.role_level, 'block', u.block,
                                'open', (select count(*) from mine m where m.owner_id = u.id and m.is_open),
                                'oldest', (select max(m.age_days) from mine m where m.owner_id = u.id and m.is_open))
                             order by u.name)
        from users u
        where p_type <> 'person' and u."isActive"
          and (u.id = any(v_team_ids) or u.id in (select m.owner_id from mine m where m.is_open and m.owner_id is not null))), '[]')
  ) into v_body;

  return jsonb_build_object(
    'type', p_type, 'key', p_key, 'kind', v_kind, 'title', v_title, 'title_bn', v_title_bn,
    'trail', v_trail, 'facts', v_facts, 'children', v_children, 'booths', v_booths) || v_body;
end;
$$;

-- Find any seat, block, panchayat, village, booth, person or ticket the caller may see.
create or replace function public.object_search(
  p_q text, p_seats text[] default null,
  p_show_demo boolean default false, p_show_test boolean default false, p_limit integer default 5)
returns jsonb
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  with k as (select btrim(normalize(coalesce(p_q, ''), nfc)) q),
  sc as (select lower(s) s from unnest(p_seats) s),
  vis as (
    select v.* from lgd_villages v
    where v.district_code in (select served_district_codes())
      and (p_seats is null or lower(v.assembly_constituency) in (select s from sc))),
  seats(type, key, label, label_bn, sub, rank, ord) as (
    select 'seat', a.ac, a.ac, null::text, 'Assembly seat', r, 1
    from (select distinct assembly_constituency ac from vis) a, k,
         lateral object_match_rank(a.ac, null, k.q) r
    where r is not null order by r, a.ac limit p_limit),
  blocks(type, key, label, label_bn, sub, rank, ord) as (
    select 'block', b.block_code, b.block_name, b.block_name_bn, 'Block', r, 2
    from lgd_blocks b, k, lateral object_match_rank(b.block_name, b.block_name_bn, k.q) r
    where r is not null and b.block_code in (select block_code from vis)
    order by r, b.block_name limit p_limit),
  gps(type, key, label, label_bn, sub, rank, ord) as (
    select 'gp', g.gp_code, g.gp_name, g.gp_name_bn, 'Panchayat, ' || b.block_name, r, 3
    from lgd_gram_panchayats g join lgd_blocks b on b.block_code = g.block_code, k,
         lateral object_match_rank(g.gp_name, g.gp_name_bn, k.q) r
    where r is not null and g.gp_code in (select gp_code from vis)
    order by r, g.gp_name limit p_limit),
  villages(type, key, label, label_bn, sub, rank, ord) as (
    select 'village', v.village_code, v.village_name, null::text, 'Village, ' || g.gp_name || ', ' || b.block_name, r, 4
    from vis v join lgd_gram_panchayats g on g.gp_code = v.gp_code join lgd_blocks b on b.block_code = v.block_code, k,
         lateral object_match_rank(v.village_name, null, k.q) r
    where r is not null order by r, v.village_name limit p_limit),
  booths(type, key, label, label_bn, sub, rank, ord) as (
    select 'booth', p.ac_no::text || '-' || p.ps_no, 'Booth ' || p.ps_no || ', ' || p.ps_name, null::text, p.ac || ' seat', r, 5
    from polling_stations p, k,
         lateral (select case when p.ps_no = k.q then 0 else object_match_rank(p.ps_name, null, k.q) end) x(r)
    where r is not null and (p_seats is null or lower(p.ac) in (select s from sc))
    order by r, p.ac, p.ps_no limit p_limit),
  people(type, key, label, label_bn, sub, rank, ord) as (
    select 'person', u.id, u.name, null::text,
           concat_ws(', ', case u.role_level when 'KARYAKARTA' then 'Karyakarta' when 'GP_COORD' then 'GP coordinator'
             when 'BLOCK_COORD' then 'Block president' when 'MLA' then 'MLA' when 'MP' then 'MP'
             when 'DISTRICT_ADMIN' then 'District president' else 'Office' end, u.constituency), r, 6
    from users u, k, lateral object_match_rank(u.name, null, k.q) r
    where r is not null and u."isActive"
      and (p_seats is null or lower(u.constituency) in (select s from sc))
    order by r, u.name limit p_limit),
  tickets(type, key, label, label_bn, sub, rank, ord) as (
    select 'complaint', c.id, c.ticket, null::text, concat_ws(', ', left(c.issue, 60), c.village), 0, 0
    from object_complaints(p_show_demo, p_show_test, p_seats) c, k
    where k.q ~ '\d{2,}' and position(upper(k.q) in upper(c.ticket)) > 0
    order by c.created_at desc limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object('type', type, 'key', key, 'label', label, 'label_bn', label_bn, 'sub', sub)
                            order by rank, ord, label), '[]')
  from (select * from tickets union all select * from seats union all select * from blocks union all select * from gps
        union all select * from villages union all select * from booths union all select * from people) h
  where length((select q from k)) >= 2
$$;

revoke all on function public.object_view(text, text, text[], boolean, boolean) from public, anon, authenticated;
revoke all on function public.object_search(text, text[], boolean, boolean, integer) from public, anon, authenticated;
revoke all on function public.object_complaints(boolean, boolean, text[]) from public, anon, authenticated;
revoke all on function public.served_district_codes() from public, anon, authenticated;
grant execute on function public.object_view(text, text, text[], boolean, boolean) to service_role;
grant execute on function public.object_search(text, text[], boolean, boolean, integer) to service_role;
grant execute on function public.object_complaints(boolean, boolean, text[]) to service_role;
grant execute on function public.served_district_codes() to service_role;
