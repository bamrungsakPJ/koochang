-- Deliberately limited public projection: no accounts, billing documents or drafts.
CREATE FUNCTION padmin.public_catalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.technician_seats,c.code,c.interval_unit),'[]'::jsonb)) FROM (
 SELECT DISTINCT ON (p.id,pr.interval_unit) p.code,p.name_th,p.name_en,p.kind,
 pv.technician_seats,pv.storage_bytes,pv.trial_days,pr.amount_minor,pr.currency,pr.interval_unit
 FROM billing.plans p
 JOIN billing.plan_versions pv ON pv.plan_id=p.id AND pv.published_at<=now()
 JOIN billing.price_versions pr ON pr.plan_version_id=pv.id AND pr.effective_from<=now()
 WHERE p.status='active' AND pv.version_no=(SELECT max(v.version_no) FROM billing.plan_versions v WHERE v.plan_id=p.id AND v.published_at<=now())
 ORDER BY p.id,pr.interval_unit,pr.effective_from DESC,pr.id
 ) c
$$;
REVOKE ALL ON FUNCTION padmin.public_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.public_catalog() TO fs_platform;
