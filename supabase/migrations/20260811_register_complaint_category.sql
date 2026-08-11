-- register_complaint: stop filing every citizen complaint as OTHER.
--
-- The INSERT hardcoded the literal 'OTHER' into the category column and the
-- function took no category parameter at all, so there was no way to file a
-- complaint under what it was actually about. The API route computed a category
-- from the intake agent's payload and then had nowhere to put it — the value was
-- assembled and dropped on every single call.
--
-- The effect on real data: 23 of the 53 WhatsApp complaints in this database
-- read OTHER, including ones whose entire text is "drinking water" and "Bidyut".
-- A complaint filed as OTHER is invisible under Water Supply on every screen
-- that groups by category, cannot be routed to the department that handles it,
-- and makes the seat's own picture of its workload wrong.
--
-- Adding a parameter changes the signature, so the old twelve-argument version
-- is dropped rather than left behind as an overload — two functions differing
-- only by an all-defaulted trailing argument make every named-argument call
-- ambiguous. p_category is last, so existing positional callers are unaffected,
-- and it defaults to '' which COALESCEs to the same 'OTHER' as before: a caller
-- that does not know the category gets exactly today's behaviour.
--
-- Nothing else in the body is changed.

DROP FUNCTION IF EXISTS public.register_complaint(
  text, text, text, text, text, text, text, text, text, text,
  double precision, double precision
);

CREATE OR REPLACE FUNCTION public.register_complaint(
  p_citizen_name text DEFAULT ''::text,
  p_phone text DEFAULT ''::text,
  p_village text DEFAULT ''::text,
  p_panchayat text DEFAULT ''::text,
  p_block text DEFAULT ''::text,
  p_district text DEFAULT ''::text,
  p_issue text DEFAULT ''::text,
  p_description text DEFAULT ''::text,
  p_source text DEFAULT 'WHATSAPP'::text,
  p_language text DEFAULT 'bn'::text,
  p_village_lat double precision DEFAULT NULL::double precision,
  p_village_lng double precision DEFAULT NULL::double precision,
  p_category text DEFAULT ''::text
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_no     TEXT;
  v_dist_code     TEXT;
  v_year_code     TEXT;
  v_seq           BIGINT;
  v_seq_name      TEXT;
  v_complaint_id  TEXT;
  v_matched_dist  TEXT;
  v_closest_dist  TEXT;
  v_lgd           JSONB;
  v_gp_check      JSONB;
  v_village_code  TEXT;
  v_gp_code       TEXT;
  v_gp_name_final TEXT;
  v_assembly      TEXT;
  v_parliament    TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND p_source != 'WHATSAPP' THEN
    RAISE EXCEPTION 'Complaint must go through WhatsApp/Sahayak';
  END IF;

  -- Match district
  v_matched_dist := match_district(p_district);
  IF v_matched_dist IS NULL THEN
    SELECT district INTO v_closest_dist FROM valid_districts
    ORDER BY similarity(LOWER(district), LOWER(p_district)) DESC LIMIT 1;
    RETURN json_build_object(
      'success', false, 'error', 'invalid_district',
      'input', p_district, 'closest_match', v_closest_dist
    );
  END IF;

  -- LGD auto-lookup: village + block + GP → constituency
  v_lgd := lookup_village_coords(p_village, p_block, p_panchayat);
  IF v_lgd IS NOT NULL AND (v_lgd->>'found')::boolean THEN
    v_village_code  := v_lgd->>'village_code';
    v_gp_code       := v_lgd->>'gp_code';
    v_gp_name_final := COALESCE(v_lgd->>'gp_name', p_panchayat);
    v_assembly      := v_lgd->>'assembly_constituency';
    v_parliament    := v_lgd->>'parliamentary_constituency';
  ELSE
    -- Fallback: GP+block validation (village mismatch never blocks)
    v_gp_check := validate_gp_in_block(p_panchayat, p_block);
    v_village_code  := NULL;
    v_gp_code       := v_gp_check->>'gp_code';
    v_gp_name_final := COALESCE(v_gp_check->>'gp_name', p_panchayat);
    -- Derive assembly from any village in this GP
    IF v_gp_code IS NOT NULL THEN
      SELECT lv.assembly_constituency, lv.parliamentary_constituency
      INTO v_assembly, v_parliament
      FROM lgd_villages lv
      WHERE lv.gp_code = v_gp_code AND lv.assembly_constituency IS NOT NULL
      LIMIT 1;
    END IF;
  END IF;

  -- FINAL fallback: still no assembly? derive from the block via the
  -- spelling-robust block→AC map so the row never stores a NULL constituency.
  IF v_assembly IS NULL AND COALESCE(TRIM(p_block),'') <> '' THEN
    SELECT g.constituency INTO v_assembly
    FROM get_constituency_for_block(v_matched_dist, p_block) g LIMIT 1;
    IF v_assembly IS NOT NULL THEN
      SELECT m.lok_sabha INTO v_parliament
      FROM constituency_block_mapping m
      WHERE LOWER(TRIM(m.district)) = LOWER(TRIM(v_matched_dist))
        AND LOWER(TRIM(m.constituency)) = LOWER(TRIM(v_assembly))
      LIMIT 1;
    END IF;
  END IF;

  -- Ticket number
  SELECT code INTO v_dist_code FROM valid_districts WHERE district = v_matched_dist;
  IF v_dist_code IS NULL THEN v_dist_code := 'GEN'; END IF;
  v_year_code := TO_CHAR(NOW(), 'YY');
  v_seq_name  := 'ticket_seq_' || v_dist_code;
  BEGIN
    EXECUTE 'SELECT nextval($1)' INTO v_seq USING v_seq_name;
  EXCEPTION WHEN undefined_table OR undefined_object THEN
    SELECT nextval('ticket_seq_GEN') INTO v_seq;
    v_dist_code := 'GEN';
  END;

  v_ticket_no    := 'WB-' || v_year_code || '-' || v_dist_code || '-' || LPAD(v_seq::TEXT, 6, '0');
  v_complaint_id := gen_random_uuid()::TEXT;

  INSERT INTO complaints (
    id, "ticketNo", "citizenName", phone,
    issue, description, category, urgency, status,
    block, district, village, subdivision, gp_name,
    language, source,
    village_code, gp_code,
    assembly_constituency, parliamentary_constituency,
    village_lat, village_lng,
    "n8nProcessed", "createdAt", "updatedAt"
  ) VALUES (
    v_complaint_id, v_ticket_no,
    COALESCE(NULLIF(TRIM(p_citizen_name),''), 'Unknown'),
    p_phone, p_issue,
    COALESCE(NULLIF(p_description,''), p_issue),
    -- Was the literal 'OTHER'.
    COALESCE(NULLIF(TRIM(p_category),''), 'OTHER'), 'MEDIUM', 'REGISTERED',
    COALESCE(NULLIF(TRIM(p_block),''), 'Unknown'),
    v_matched_dist,
    COALESCE(NULLIF(TRIM(p_village),''), ''),
    v_gp_name_final, v_gp_name_final,
    COALESCE(NULLIF(p_language,''), 'bn'),
    COALESCE(NULLIF(p_source,''), 'WHATSAPP'),
    v_village_code, v_gp_code,
    v_assembly, v_parliament,
    p_village_lat, p_village_lng,
    false, NOW(), NOW()
  );

  RETURN json_build_object(
    'success',    true,
    'ticketNo',   v_ticket_no,
    'complaintId', v_complaint_id,
    'district_used', v_matched_dist,
    'assembly_constituency', v_assembly,
    'parliamentary_constituency', v_parliament,
    'message', 'Complaint registered successfully'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- Restore the grants the dropped version carried: postgres, authenticated and
-- service_role, and deliberately not anon.
REVOKE ALL ON FUNCTION public.register_complaint(
  text, text, text, text, text, text, text, text, text, text,
  double precision, double precision, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.register_complaint(
  text, text, text, text, text, text, text, text, text, text,
  double precision, double precision, text
) TO postgres, authenticated, service_role;
