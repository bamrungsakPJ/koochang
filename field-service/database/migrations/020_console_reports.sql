-- Console completion: erasure replay after a restore, finance summary, incident overview and paged lists.
-- PostgreSQL 16 target. Apply as fs_migrator.

-- A restore can bring back business content and image bytes that were already erased. The worker keeps
-- an off-database registry of erased shops (see worker.ts); replay takes that list, so a tombstone written
-- after the backup was taken is not lost. Tombstones recreated from the registry have no request row.
ALTER TABLE platform.deletion_tombstones ALTER COLUMN request_id DROP NOT NULL, ALTER COLUMN erased_by DROP NOT NULL,
 ADD COLUMN source text NOT NULL DEFAULT 'request' CHECK(source IN ('request','registry'));

-- Same as 019, plus three free-text/derived columns found in the column review: rendered notification
-- text, accepted OCR values (serials) and maintenance close reasons.
CREATE OR REPLACE FUNCTION padmin.erase_business_content(p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 INSERT INTO platform.media_erasure_jobs(organization_id,object_key) SELECT p_org,object_key FROM core.media_assets WHERE organization_id=p_org UNION SELECT p_org,thumbnail_key FROM core.media_assets WHERE organization_id=p_org AND thumbnail_key IS NOT NULL ON CONFLICT(object_key) DO NOTHING;
 UPDATE core.organizations SET status='closed',name='Deleted shop',contact_phone=NULL WHERE id=p_org;
 UPDATE core.customers SET name='Deleted customer',phone=NULL,phone_normalized=NULL,note=NULL,archived_at=now() WHERE organization_id=p_org;
 UPDATE core.customer_locations SET name='Deleted location',address=NULL,travel_note=NULL,latitude=NULL,longitude=NULL,accuracy_meters=NULL,capture_method=NULL,location_captured_at=NULL,location_captured_by=NULL,archived_at=now() WHERE organization_id=p_org;
 UPDATE core.equipment SET name=NULL,brand=NULL,model=NULL,serial_number=NULL,serial_normalized=NULL,note=NULL,installation_note=NULL,qr_code=NULL,status='archived' WHERE organization_id=p_org;
 UPDATE core.jobs SET title='Deleted job',description=NULL,cancellation_reason=CASE WHEN status='cancelled' THEN 'Deleted' ELSE NULL END WHERE organization_id=p_org;
 UPDATE core.job_equipment SET request_note=NULL WHERE organization_id=p_org;
 UPDATE core.service_events SET note=NULL WHERE organization_id=p_org;
 UPDATE core.service_event_equipment SET note=NULL,work_note=NULL,problem_note=NULL,not_done_reason=CASE WHEN outcome<>'done' THEN 'Deleted' END,equipment_snapshot='{}' WHERE organization_id=p_org;
 UPDATE core.equipment_photos SET caption=NULL WHERE organization_id=p_org;
 UPDATE core.ocr_requests SET result=NULL,accepted_fields=NULL,status=CASE WHEN status IN ('queued','running') THEN 'cancelled' ELSE status END WHERE organization_id=p_org;
 UPDATE core.organization_members SET display_name='Deleted member' WHERE organization_id=p_org;
 UPDATE core.job_assignments SET reason=NULL WHERE organization_id=p_org;
 UPDATE core.job_state_changes SET reason=NULL WHERE organization_id=p_org;
 UPDATE core.maintenance_cycles SET close_reason=NULL WHERE organization_id=p_org;
 UPDATE ops.audit_logs SET reason=NULL,details='{}' WHERE organization_id=p_org;
 UPDATE core.media_assets SET status='deleted' WHERE organization_id=p_org;
 UPDATE core.notifications SET parameters='{}',sent_snapshot=NULL WHERE organization_id=p_org;
 UPDATE ops.notification_deliveries SET status='skipped' WHERE organization_id=p_org AND status IN ('queued','sending','failed');
 UPDATE core.maintenance_contact_logs SET note=NULL WHERE organization_id=p_org;
 UPDATE platform.support_messages SET body='Deleted' WHERE organization_id=p_org;
 UPDATE platform.support_tickets SET subject='Deleted ticket',status='closed' WHERE organization_id=p_org;
 UPDATE platform.support_access_grants SET status='revoked',ended_at=now() WHERE organization_id=p_org AND status IN ('pending','active');
 UPDATE ops.outbox_events SET payload='{}',processed_at=now() WHERE organization_id=p_org;
 UPDATE ops.idempotency_keys SET response=NULL WHERE organization_id=p_org;
 DELETE FROM platform.export_artifacts a USING platform.data_requests d WHERE a.request_id=d.id AND d.organization_id=p_org;
END $$;

CREATE FUNCTION worker.erasure_registry() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('organization_id',organization_id,'erased_at',erased_at) ORDER BY erased_at),'[]') FROM platform.deletion_tombstones
$$;

DROP FUNCTION worker.replay_erasure();
CREATE FUNCTION worker.replay_erasure(p_orgs uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE o uuid;n integer=0;
BEGIN
 FOR o IN SELECT organization_id FROM platform.deletion_tombstones
  UNION SELECT x FROM unnest(coalesce(p_orgs,'{}')) x WHERE EXISTS(SELECT 1 FROM core.organizations WHERE id=x) LOOP
  INSERT INTO platform.deletion_tombstones(organization_id,policy_snapshot,source) VALUES(o,'{}','registry') ON CONFLICT(organization_id) DO NOTHING;
  PERFORM padmin.erase_business_content(o);
  -- Restored image bytes must be deleted again, even when the restored job row already says succeeded.
  UPDATE platform.media_erasure_jobs SET status='queued',updated_at=now()-interval '1 minute' WHERE organization_id=o AND status<>'queued';
  UPDATE core.organization_join_links SET status='revoked',revoked_at=now() WHERE organization_id=o AND status IN ('active','closed');
  INSERT INTO platform.audit_logs(organization_id,action,target_type,target_id) VALUES(o,'privacy.replayed','organization',o);
  n=n+1;
 END LOOP;
 RETURN n;
END $$;

-- Finance summary for a Bangkok-date range: money received and refunded, by source, plan and day,
-- plus what is outstanding now. Amounts are integer satang.
CREATE FUNCTION padmin.finance_report(p_actor uuid,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 PERFORM padmin.require(p_actor,'billing.read');
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>366 THEN RAISE EXCEPTION 'invalid range' USING ERRCODE='22023'; END IF;
 WITH pay AS (
  SELECT p.amount_minor,p.verification_source AS source,(p.verified_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
   i.plan_snapshot->>'plan_code' AS plan_code,i.plan_snapshot->>'name_th' AS name_th,i.plan_snapshot->>'name_en' AS name_en,pr.interval_unit
  FROM billing.payments p JOIN billing.invoices i ON i.organization_id=p.organization_id AND i.id=p.invoice_id
  JOIN billing.price_versions pr ON pr.id=i.price_version_id
  WHERE (p.verified_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN p_from AND p_to),
 ref AS (
  SELECT r.amount_minor,(r.completed_at AT TIME ZONE 'Asia/Bangkok')::date AS day FROM billing.refunds r
  WHERE r.status='succeeded' AND (r.completed_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN p_from AND p_to)
 SELECT jsonb_build_object(
  'from',p_from,'to',p_to,
  'received_minor',(SELECT coalesce(sum(amount_minor),0) FROM pay),'payments',(SELECT count(*) FROM pay),
  'refunded_minor',(SELECT coalesce(sum(amount_minor),0) FROM ref),'refunds',(SELECT count(*) FROM ref),
  'net_minor',(SELECT coalesce(sum(amount_minor),0) FROM pay)-(SELECT coalesce(sum(amount_minor),0) FROM ref),
  'by_source',(SELECT coalesce(jsonb_agg(x ORDER BY x.source),'[]') FROM (SELECT source,count(*) AS count,sum(amount_minor) AS amount_minor FROM pay GROUP BY source) x),
  'by_plan',(SELECT coalesce(jsonb_agg(x ORDER BY x.amount_minor DESC),'[]') FROM (SELECT plan_code,max(name_th) AS name_th,max(name_en) AS name_en,interval_unit,count(*) AS count,sum(amount_minor) AS amount_minor FROM pay GROUP BY plan_code,interval_unit) x),
  'by_day',(SELECT coalesce(jsonb_agg(x ORDER BY x.day),'[]') FROM (
    SELECT day,sum(received) AS received_minor,sum(refunded) AS refunded_minor FROM (
     SELECT day,amount_minor AS received,0 AS refunded FROM pay UNION ALL SELECT day,0,amount_minor FROM ref) d GROUP BY day) x),
  'open_invoices',(SELECT count(*) FROM billing.invoices WHERE status='open'),
  'open_minor',(SELECT coalesce(sum(amount_minor),0) FROM billing.invoices WHERE status='open'),
  'pending_refunds',(SELECT count(*) FROM billing.refunds WHERE status IN ('pending','approved')),
  'paid_shops',(SELECT count(*) FROM core.organizations o CROSS JOIN LATERAL billing.entitlement(o.id) e WHERE e.source='paid' AND e.state IN ('active','past_due'))) INTO v;
 RETURN v;
END $$;

-- Incident overview for the console home: unresolved incidents and the most recent resolution.
CREATE FUNCTION padmin.incident_summary(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM padmin.require(p_actor,'system.read');
 RETURN jsonb_build_object(
  'open',(SELECT coalesce(jsonb_agg(x ORDER BY array_position(ARRAY['critical','high','medium','low'],x.severity),x.created_at),'[]') FROM (
    SELECT id,title,severity,status,services,created_at,updated_at FROM platform.incidents WHERE status<>'resolved') x),
  'last_resolved',(SELECT jsonb_build_object('id',id,'title',title,'severity',severity,'updated_at',updated_at,'minutes',round(extract(epoch FROM updated_at-created_at)/60))
    FROM platform.incidents WHERE status='resolved' ORDER BY updated_at DESC LIMIT 1),
  'resolved_30d',(SELECT count(*) FROM platform.incidents WHERE status='resolved' AND updated_at>now()-interval '30 days'));
END $$;

-- Approvals show who an account change is about, so approvers do not decide on a bare ID.
CREATE OR REPLACE FUNCTION padmin.approvals(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 PERFORM padmin.require(p_actor,'approvals.read');
 IF NOT EXISTS(SELECT 1 FROM platform.accounts a JOIN platform.account_roles ar ON ar.account_id=a.id JOIN platform.role_permissions rp ON rp.role_id=ar.role_id JOIN platform.permissions p ON p.id=rp.permission_id
 WHERE a.id=p_actor AND a.status='active' AND p.code IN ('accounts.manage','accounts.approve','plans.manage','plans.publish','settings.manage','policy.approve')) THEN RAISE EXCEPTION 'permission required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(x),'[]') INTO v FROM (
 SELECT c.*,a.display_name AS requester,
  CASE WHEN c.kind IN ('roles','recovery') THEN (SELECT jsonb_build_object('display_name',t.display_name,'email',t.email,'status',t.status,
    'roles',(SELECT coalesce(jsonb_agg(r.code ORDER BY r.code),'[]') FROM platform.account_roles ar JOIN platform.roles r ON r.id=ar.role_id WHERE ar.account_id=t.id))
    FROM platform.accounts t WHERE t.id=c.target_id) END AS target
 FROM platform.change_requests c JOIN platform.accounts a ON a.id=c.requested_by
 WHERE (c.kind IN ('roles','recovery') AND EXISTS(SELECT 1 FROM platform.account_roles ar JOIN platform.role_permissions rp ON rp.role_id=ar.role_id JOIN platform.permissions p ON p.id=rp.permission_id WHERE ar.account_id=p_actor AND p.code IN ('accounts.manage','accounts.approve')))
 OR (c.kind='plan' AND EXISTS(SELECT 1 FROM platform.account_roles ar JOIN platform.role_permissions rp ON rp.role_id=ar.role_id JOIN platform.permissions p ON p.id=rp.permission_id WHERE ar.account_id=p_actor AND p.code IN ('plans.manage','plans.publish')))
 OR (c.kind='policy' AND EXISTS(SELECT 1 FROM platform.account_roles ar JOIN platform.role_permissions rp ON rp.role_id=ar.role_id JOIN platform.permissions p ON p.id=rp.permission_id WHERE ar.account_id=p_actor AND p.code IN ('settings.manage','policy.approve')))
 ORDER BY (c.status='pending') DESC,c.created_at DESC LIMIT 200) x;
 RETURN v;
END $$;

-- Paged lists (50 per page; the 51st row only tells the caller there is more).
CREATE FUNCTION padmin.organizations(p_account_id uuid,p_query text,p_state text,p_offset integer)
RETURNS TABLE (id uuid,name text,status text,created_at timestamptz,state text,plan_code text,period_end timestamptz,owner_name text,owner_phone text,active_technicians integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM padmin.require(p_account_id,'shops.read');
 RETURN QUERY
 SELECT o.id,o.name,o.status,o.created_at,e.state,e.plan_code,e.period_end,padmin.person_name(u.display_name),padmin.mask_phone(u.phone_e164),
  (SELECT count(*)::integer FROM core.organization_members m WHERE m.organization_id=o.id AND m.role='technician' AND m.status='active')
 FROM core.organizations o
 CROSS JOIN LATERAL billing.entitlement(o.id) e
 LEFT JOIN core.organization_members om ON om.organization_id=o.id AND om.role='owner' AND om.status='active'
 LEFT JOIN core.users u ON u.id=om.user_id
 WHERE (coalesce(p_query,'')='' OR o.name ILIKE '%'||p_query||'%' OR o.id::text=p_query OR right(u.phone_e164,4)=right(regexp_replace(p_query,'\D','','g'),4) AND length(regexp_replace(p_query,'\D','','g'))>=4)
  AND (coalesce(p_state,'')='' OR e.state=p_state)
 ORDER BY o.created_at DESC,o.id LIMIT 51 OFFSET greatest(p_offset,0);
END $$;

CREATE FUNCTION padmin.payment_queue(p_account_id uuid,p_status text,p_offset integer)
RETURNS TABLE (invoice_id uuid,number text,organization_id uuid,organization_name text,amount_minor bigint,status text,plan_name_th text,plan_name_en text,
 created_at timestamptz,proof_id uuid,proof_status text,proof_submitted_at timestamptz,proof_reason text,paid_at timestamptz,bank_reference text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM padmin.require(p_account_id,'billing.read');
 RETURN QUERY
 SELECT i.id,i.number,i.organization_id,o.name,i.amount_minor,i.status,i.plan_snapshot->>'name_th',i.plan_snapshot->>'name_en',i.created_at,
  pp.id,pp.status,pp.created_at,pp.reason,i.paid_at,pay.bank_reference
 FROM billing.invoices i JOIN core.organizations o ON o.id=i.organization_id
 LEFT JOIN LATERAL (SELECT * FROM billing.payment_proofs x WHERE x.organization_id=i.organization_id AND x.invoice_id=i.id ORDER BY x.created_at DESC LIMIT 1) pp ON true
 LEFT JOIN billing.payments pay ON pay.organization_id=i.organization_id AND pay.invoice_id=i.id
 WHERE (p_status='pending' AND ((i.status='open' AND pp.status='pending') OR EXISTS(SELECT 1 FROM billing.stripe_checkouts sc WHERE sc.invoice_id=i.id AND sc.status='manual_review')))
  OR (p_status='open' AND i.status='open') OR (p_status='paid' AND i.status='paid') OR (p_status='all')
 ORDER BY CASE WHEN pp.status='pending' THEN pp.created_at END NULLS LAST,i.created_at DESC,i.id
 LIMIT 51 OFFSET greatest(p_offset,0);
END $$;

CREATE FUNCTION padmin.data_requests(p_account_id uuid,p_offset integer)
RETURNS TABLE (id uuid,organization_id uuid,organization_name text,request_type text,status text,reason text,requested_by text,created_at timestamptz,decision_note text,completed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM padmin.require(p_account_id,'data.manage');
 RETURN QUERY SELECT d.id,d.organization_id,o.name,d.request_type,d.status,d.reason,padmin.person_name(u.display_name),d.created_at,d.decision_note,d.completed_at
 FROM platform.data_requests d JOIN core.organizations o ON o.id=d.organization_id JOIN core.users u ON u.id=d.requested_by
 ORDER BY (d.status IN ('pending','approved','running')) DESC,d.created_at DESC,d.id LIMIT 51 OFFSET greatest(p_offset,0);
END $$;

REVOKE ALL ON FUNCTION worker.erasure_registry(),worker.replay_erasure(uuid[]),padmin.finance_report(uuid,date,date),padmin.incident_summary(uuid),
 padmin.organizations(uuid,text,text,integer),padmin.payment_queue(uuid,text,integer),padmin.data_requests(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker.erasure_registry(),worker.replay_erasure(uuid[]) TO fs_worker;
GRANT EXECUTE ON FUNCTION padmin.finance_report(uuid,date,date),padmin.incident_summary(uuid),
 padmin.organizations(uuid,text,text,integer),padmin.payment_queue(uuid,text,integer),padmin.data_requests(uuid,integer) TO fs_platform;
