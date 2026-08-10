-- Re-anchor the Purulia demo's open complaints to right now.
--
-- Demo data is backdated, which means it rots. A set of ages chosen on Monday
-- reads three days worse by Thursday: a seat that looked well-run turns into a
-- backlog on its own, with no one having done anything. This session watched it
-- happen — six cases set at 0.8 to 5 days drifted to 4.3 to 8.5 over a few days,
-- and the "past deadline" count climbed with them.
--
-- Run this immediately before any demo:
--
--     SELECT * FROM refresh_purulia_demo();
--
-- It returns the resulting open cases so the state can be eyeballed before
-- anyone opens the dashboard in front of a client.
--
-- Ages are chosen against the SLA allowances in src/lib/sla.ts
-- (CRITICAL 1 / HIGH 3 / MEDIUM 7 / LOW 15 days) so exactly one case — the
-- critical one — is genuinely late. A demo with nothing late gives the MLA
-- nothing to act on; a demo with everything late is the screen this project
-- spent a day fixing, and it teaches a client to ignore the colour red.
--
-- Only source='DEMO' rows are touched. The n8n notification trigger is held off
-- so no message reaches a phone, and updatedAt is set explicitly rather than
-- being bumped by the audit trigger, because this is not an edit anyone made.

CREATE OR REPLACE FUNCTION public.refresh_purulia_demo()
 RETURNS TABLE("ticketNo" text, urgency text, status text, age_days numeric, is_late boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  t record;
BEGIN
  ALTER TABLE complaints DISABLE TRIGGER trg_js04_status_update;
  ALTER TABLE complaints DISABLE TRIGGER trg_set_resolved_at;
  ALTER TABLE complaints DISABLE TRIGGER complaints_updated_at;

  FOR t IN
    SELECT * FROM (VALUES
      ('WB-DEMO-24DCACF5', interval '30 hours', interval '30 hours', 'OPEN'),
      ('WB-DEMO-76C85200', interval '20 hours', interval '20 hours', 'OPEN'),
      ('WB-DEMO-F6DDDD7C', interval '2 days',   interval '1 day',    'ASSIGNED'),
      ('WB-DEMO-72110C4B', interval '1 day',    interval '6 hours',  'IN_PROGRESS'),
      ('WB-DEMO-F6922780', interval '5 days',   interval '2 days',   'ASSIGNED'),
      ('WB-DEMO-67BA9311', interval '3 days',   interval '1 day',    'IN_PROGRESS')
    ) AS v(tkt, age, touched, st)
  LOOP
    UPDATE complaints c
       SET "createdAt" = now() - t.age,
           "updatedAt" = now() - t.touched,
           status      = t.st,
           "resolvedAt" = NULL,
           resolution   = NULL,
           "slaDeadline" = (now() - t.age) + CASE c.urgency
              WHEN 'CRITICAL' THEN interval '1 day'  WHEN 'HIGH' THEN interval '3 days'
              WHEN 'MEDIUM'   THEN interval '7 days' ELSE interval '15 days' END
     WHERE c."ticketNo" = t.tkt AND c.source = 'DEMO';
  END LOOP;

  ALTER TABLE complaints ENABLE TRIGGER trg_js04_status_update;
  ALTER TABLE complaints ENABLE TRIGGER trg_set_resolved_at;
  ALTER TABLE complaints ENABLE TRIGGER complaints_updated_at;

  RETURN QUERY
    SELECT c."ticketNo", c.urgency, c.status,
           round((EXTRACT(epoch FROM now()-c."createdAt")/86400.0)::numeric, 1),
           now() > c."slaDeadline"
      FROM complaints c
     WHERE COALESCE(c.assembly_constituency, c.constituency) = 'Purulia'
       AND c.status NOT IN ('RESOLVED','REJECTED','CLOSED')
     ORDER BY c."createdAt";
END;
$function$;
