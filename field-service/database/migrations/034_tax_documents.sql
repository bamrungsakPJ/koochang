-- 034: ใบแจ้งหนี้ + ใบเสร็จรับเงิน/ใบกำกับภาษี and ใบลดหนี้ issued in the company database ITISME (2026-10-09).
-- Every new payment queues one receipt document; every refund that succeeds queues one credit note against it.
-- The worker issues them through the ITISME procedures (infra/itisme/02_koochang_objects.sql), which give the
-- numbers (IV / R / CN, continuing the legacy books). Issuing never blocks a payment or the entitlement: a
-- document waits in the queue while ITISME is off or unreachable. Prices are VAT-included; ITISME takes VAT
-- out the legacy way (subtotal = gross × 100/107). The PDF is drawn by the API from the row kept here.

-- Who the documents are made out to (owner-maintained). Without a profile the shop name is used.
CREATE TABLE billing.buyer_profiles (
 organization_id uuid PRIMARY KEY REFERENCES core.organizations(id),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 buyer_name text NOT NULL CHECK (length(trim(buyer_name)) BETWEEN 1 AND 200),
 tax_id text CHECK (tax_id ~ '^[0-9]{13}$'),
 branch_no text CHECK (branch_no ~ '^[0-9]{5}$'),       -- 00000 = สำนักงานใหญ่; only with a tax id
 address text NOT NULL CHECK (length(trim(address)) BETWEEN 1 AND 500),
 phone text CHECK (length(phone) <= 30),
 email text CHECK (length(email) <= 100),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES core.users(id),
 CHECK ((tax_id IS NULL) = (branch_no IS NULL))
);
ALTER TABLE billing.buyer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.buyer_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY buyer_owner_read ON billing.buyer_profiles FOR SELECT TO fs_api USING (core.owner_allowed(organization_id));
CREATE POLICY buyer_functions ON billing.buyer_profiles TO fs_migrator USING (true) WITH CHECK (true);
GRANT SELECT ON billing.buyer_profiles TO fs_api;

CREATE TABLE billing.tax_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES core.organizations(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 kind text NOT NULL CHECK (kind IN ('receipt','credit_note')),
 payment_id uuid NOT NULL,
 refund_id uuid UNIQUE,
 ref text NOT NULL UNIQUE CHECK (ref ~ '^[A-Za-z0-9-]{1,20}$'),   -- ITISME Ref: retries with it never issue twice
 doc_date date NOT NULL,                                           -- Bangkok date the money moved
 gross_minor bigint NOT NULL CHECK (gross_minor > 0),              -- VAT included
 buyer jsonb NOT NULL,
 reason text,                                                      -- credit notes: why
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','issued','failed','skipped')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 -- Filled from ITISME when issued.
 item_name text, customer_id text, invoice_no text, receipt_no text, credit_note_no text, receipt_date date,
 subtotal_minor bigint, vat_minor bigint, original_minor bigint, correct_minor bigint, seller jsonb,
 issued_at timestamptz,
 skipped_by uuid REFERENCES platform.accounts(id), skip_reason text,
 UNIQUE (organization_id, id),
 FOREIGN KEY (organization_id, payment_id) REFERENCES billing.payments(organization_id, id),
 FOREIGN KEY (organization_id, refund_id) REFERENCES billing.refunds(organization_id, id),
 CHECK ((kind = 'credit_note') = (refund_id IS NOT NULL)),
 CHECK (status <> 'issued' OR (customer_id IS NOT NULL AND subtotal_minor IS NOT NULL AND vat_minor IS NOT NULL
   AND CASE kind WHEN 'receipt' THEN invoice_no IS NOT NULL AND receipt_no IS NOT NULL ELSE credit_note_no IS NOT NULL END))
);
CREATE UNIQUE INDEX one_receipt_per_payment ON billing.tax_documents(payment_id) WHERE kind = 'receipt';
CREATE INDEX tax_documents_queue ON billing.tax_documents(next_attempt_at) WHERE status = 'queued';
CREATE INDEX tax_documents_org ON billing.tax_documents(organization_id, created_at DESC);
ALTER TABLE billing.tax_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.tax_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_owner_read ON billing.tax_documents FOR SELECT TO fs_api USING (core.owner_allowed(organization_id));
CREATE POLICY tax_functions ON billing.tax_documents TO fs_migrator USING (true) WITH CHECK (true);
GRANT SELECT ON billing.tax_documents TO fs_api;

-- Buyer details frozen into a document when it is queued.
CREATE FUNCTION billing.buyer_snapshot(p_organization_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce(
   (SELECT jsonb_strip_nulls(jsonb_build_object('name', b.buyer_name, 'tax_id', b.tax_id, 'branch_no', b.branch_no,
      'address', b.address, 'phone', b.phone, 'email', b.email)) FROM billing.buyer_profiles b WHERE b.organization_id = p_organization_id),
   (SELECT jsonb_build_object('name', o.name) FROM core.organizations o WHERE o.id = p_organization_id))
$$;
REVOKE ALL ON FUNCTION billing.buyer_snapshot(uuid) FROM PUBLIC;

-- New payment → receipt document. Ref is the KooChang invoice number (INV-2610-000002); a second payment on the
-- same invoice (should not happen) gets a payment-based ref instead. Never raises: a payment always goes through.
CREATE FUNCTION billing.queue_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_number text;
BEGIN
 SELECT i.number INTO v_number FROM billing.invoices i WHERE i.organization_id = NEW.organization_id AND i.id = NEW.invoice_id;
 IF v_number IS NULL OR v_number !~ '^[A-Za-z0-9-]{1,20}$' OR EXISTS (SELECT 1 FROM billing.tax_documents t WHERE t.ref = v_number) THEN
   v_number := 'P' || left(replace(NEW.id::text, '-', ''), 19);
 END IF;
 INSERT INTO billing.tax_documents(organization_id, kind, payment_id, ref, doc_date, gross_minor, buyer)
 VALUES (NEW.organization_id, 'receipt', NEW.id, v_number,
   (coalesce(NEW.received_at, NEW.verified_at, now()) AT TIME ZONE 'Asia/Bangkok')::date, NEW.amount_minor,
   billing.buyer_snapshot(NEW.organization_id))
 ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;
CREATE TRIGGER queue_receipt AFTER INSERT ON billing.payments FOR EACH ROW EXECUTE FUNCTION billing.queue_receipt();

-- Refund that succeeded → credit note against the payment's receipt (payments made before 034 have none).
CREATE FUNCTION billing.queue_credit_note() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 INSERT INTO billing.tax_documents(organization_id, kind, payment_id, refund_id, ref, doc_date, gross_minor, buyer, reason)
 SELECT NEW.organization_id, 'credit_note', NEW.payment_id, NEW.id, 'RF' || left(replace(NEW.id::text, '-', ''), 18),
   (coalesce(NEW.completed_at, now()) AT TIME ZONE 'Asia/Bangkok')::date, NEW.amount_minor, r.buyer, left(NEW.reason, 250)
 FROM billing.tax_documents r WHERE r.payment_id = NEW.payment_id AND r.kind = 'receipt' AND r.status <> 'skipped'
 ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;
CREATE TRIGGER queue_credit_note AFTER UPDATE OF status ON billing.refunds FOR EACH ROW
 WHEN (NEW.status = 'succeeded' AND OLD.status IS DISTINCT FROM 'succeeded') EXECUTE FUNCTION billing.queue_credit_note();
REVOKE ALL ON FUNCTION billing.queue_receipt(), billing.queue_credit_note() FROM PUBLIC;

-- Owner saves the buyer details. outcome: ok | forbidden | conflict | invalid
CREATE FUNCTION auth.save_buyer_profile(p_user_id uuid, p_organization_id uuid, p_version integer, p_buyer_name text, p_tax_id text,
  p_branch_no text, p_address text, p_phone text, p_email text)
RETURNS TABLE (outcome text, version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE b billing.buyer_profiles%ROWTYPE;
BEGIN
 IF auth.owner_member_id(p_user_id, p_organization_id) IS NULL THEN RETURN QUERY SELECT 'forbidden'::text, NULL::integer; RETURN; END IF;
 IF length(trim(coalesce(p_buyer_name, ''))) NOT BETWEEN 1 AND 200 OR length(trim(coalesce(p_address, ''))) NOT BETWEEN 1 AND 500
   OR (p_tax_id IS NOT NULL AND p_tax_id !~ '^[0-9]{13}$') OR (p_branch_no IS NOT NULL AND p_branch_no !~ '^[0-9]{5}$')
   OR ((p_tax_id IS NULL) <> (p_branch_no IS NULL)) OR length(p_phone) > 30 OR length(p_email) > 100 THEN
   RETURN QUERY SELECT 'invalid'::text, NULL::integer; RETURN; END IF;
 SELECT * INTO b FROM billing.buyer_profiles x WHERE x.organization_id = p_organization_id FOR UPDATE;
 IF coalesce(b.version, 0) <> p_version THEN RETURN QUERY SELECT 'conflict'::text, b.version; RETURN; END IF;
 IF b.organization_id IS NULL THEN
   INSERT INTO billing.buyer_profiles(organization_id, buyer_name, tax_id, branch_no, address, phone, email, updated_by)
   VALUES (p_organization_id, trim(p_buyer_name), p_tax_id, p_branch_no, trim(p_address), nullif(trim(p_phone), ''), nullif(trim(p_email), ''), p_user_id);
 ELSE
   UPDATE billing.buyer_profiles x SET version = x.version + 1, buyer_name = trim(p_buyer_name), tax_id = p_tax_id, branch_no = p_branch_no,
     address = trim(p_address), phone = nullif(trim(p_phone), ''), email = nullif(trim(p_email), ''), updated_at = now(), updated_by = p_user_id
   WHERE x.organization_id = p_organization_id;
 END IF;
 -- Documents still waiting are made out with the details the owner just saved.
 UPDATE billing.tax_documents t SET buyer = billing.buyer_snapshot(p_organization_id), updated_at = now()
   WHERE t.organization_id = p_organization_id AND t.status = 'queued';
 INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id)
   VALUES (p_organization_id, p_user_id, 'buyer_profile.saved', 'organization', p_organization_id, gen_random_uuid());
 RETURN QUERY SELECT 'ok'::text, (SELECT x.version FROM billing.buyer_profiles x WHERE x.organization_id = p_organization_id);
END $$;
REVOKE ALL ON FUNCTION auth.save_buyer_profile(uuid,uuid,integer,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.save_buyer_profile(uuid,uuid,integer,text,text,text,text,text,text) TO fs_api;

-- The row behind a signed PDF link. The API only calls it after checking the link's signature, which it issues
-- to the shop's owner; the link is the permission, like signed image links.
CREATE FUNCTION auth.tax_document_file(p_organization_id uuid, p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT to_jsonb(t) FROM billing.tax_documents t WHERE t.organization_id = p_organization_id AND t.id = p_id AND t.status = 'issued'
$$;
REVOKE ALL ON FUNCTION auth.tax_document_file(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.tax_document_file(uuid,uuid) TO fs_api;

-- Worker -----------------------------------------------------------------------------------------
ALTER TABLE platform.runtime_settings ADD COLUMN itisme jsonb;

CREATE FUNCTION worker.itisme_settings() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT itisme FROM platform.runtime_settings WHERE id
$$;

-- Due documents with what the item line needs. A credit note waits until its receipt is issued.
CREATE FUNCTION worker.claim_tax_documents(p_limit integer)
RETURNS TABLE (id uuid, organization_id uuid, kind text, ref text, doc_date text, gross_minor bigint, buyer jsonb, reason text, attempts integer,
  invoice_number text, plan_name_th text, interval_unit text, period_start timestamptz, period_end timestamptz, receipt_no text, receipt_item text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 WITH picked AS (
   SELECT t.id FROM billing.tax_documents t
   WHERE t.status = 'queued' AND t.next_attempt_at <= now()
     AND (t.kind = 'receipt' OR EXISTS (SELECT 1 FROM billing.tax_documents r WHERE r.payment_id = t.payment_id AND r.kind = 'receipt' AND r.status = 'issued'))
   ORDER BY t.next_attempt_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
 UPDATE billing.tax_documents t SET status = 'running', attempts = t.attempts + 1, updated_at = now()
 FROM picked, billing.payments p, billing.invoices i
 WHERE t.id = picked.id AND p.organization_id = t.organization_id AND p.id = t.payment_id
   AND i.organization_id = p.organization_id AND i.id = p.invoice_id
 RETURNING t.id, t.organization_id, t.kind, t.ref, t.doc_date::text, t.gross_minor, t.buyer, t.reason, t.attempts, i.number,
   i.plan_snapshot->>'name_th', i.price_snapshot->>'interval_unit',
   (SELECT sp.start_at FROM billing.subscription_periods sp WHERE sp.organization_id = i.organization_id AND sp.invoice_id = i.id),
   (SELECT sp.end_at FROM billing.subscription_periods sp WHERE sp.organization_id = i.organization_id AND sp.invoice_id = i.id),
   (SELECT r.receipt_no FROM billing.tax_documents r WHERE r.payment_id = t.payment_id AND r.kind = 'receipt' AND r.status = 'issued'),
   (SELECT r.item_name FROM billing.tax_documents r WHERE r.payment_id = t.payment_id AND r.kind = 'receipt' AND r.status = 'issued')
$$;

-- outcome: issued (p_result holds the ITISME numbers/amounts) | retry (temporary; failed after 10 attempts) | failed
CREATE FUNCTION worker.finish_tax_document(p_id uuid, p_outcome text, p_result jsonb, p_error text, p_retry_seconds integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE t billing.tax_documents%ROWTYPE;
BEGIN
 SELECT * INTO t FROM billing.tax_documents WHERE id = p_id FOR UPDATE;
 IF t.id IS NULL OR t.status <> 'running' THEN RETURN 'ignored'; END IF;
 IF p_outcome = 'issued' THEN
   UPDATE billing.tax_documents SET status = 'issued', issued_at = now(), updated_at = now(), last_error = NULL,
     item_name = p_result->>'item_name', customer_id = p_result->>'customer_id', invoice_no = p_result->>'invoice_no',
     receipt_no = coalesce(p_result->>'receipt_no', receipt_no), credit_note_no = p_result->>'credit_note_no',
     receipt_date = (p_result->>'receipt_date')::date,
     subtotal_minor = (p_result->>'subtotal_minor')::bigint, vat_minor = (p_result->>'vat_minor')::bigint,
     original_minor = (p_result->>'original_minor')::bigint, correct_minor = (p_result->>'correct_minor')::bigint,
     seller = p_result->'seller'
   WHERE id = p_id;
 ELSIF p_outcome = 'retry' AND t.attempts < 10 THEN
   UPDATE billing.tax_documents SET status = 'queued', last_error = left(p_error, 200), updated_at = now(),
     next_attempt_at = now() + make_interval(secs => greatest(p_retry_seconds, 5)) WHERE id = p_id;
 ELSE
   UPDATE billing.tax_documents SET status = 'failed', last_error = left(coalesce(p_error, 'FAILED'), 200), updated_at = now() WHERE id = p_id;
 END IF;
 RETURN p_outcome;
END $$;

-- Documents left running by a crashed worker go back to the queue (the ITISME Ref makes a repeat harmless).
CREATE FUNCTION worker.requeue_stale_tax_documents(p_older_than_seconds integer) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 WITH r AS (UPDATE billing.tax_documents SET status = 'queued', next_attempt_at = now(), updated_at = now()
   WHERE status = 'running' AND updated_at < now() - make_interval(secs => p_older_than_seconds) RETURNING 1)
 SELECT count(*)::integer FROM r
$$;
REVOKE ALL ON FUNCTION worker.itisme_settings(), worker.claim_tax_documents(integer), worker.finish_tax_document(uuid,text,jsonb,text,integer),
 worker.requeue_stale_tax_documents(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker.itisme_settings(), worker.claim_tax_documents(integer), worker.finish_tax_document(uuid,text,jsonb,text,integer),
 worker.requeue_stale_tax_documents(integer) TO fs_worker;

-- Console ----------------------------------------------------------------------------------------
CREATE FUNCTION padmin.tax_documents(p_account uuid, p_status text, p_organization_id uuid, p_limit integer, p_offset integer)
RETURNS TABLE (id uuid, organization_id uuid, organization_name text, kind text, ref text, doc_date date, gross_minor bigint, status text,
  attempts integer, last_error text, invoice_no text, receipt_no text, credit_note_no text, issued_at timestamptz, created_at timestamptz, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 PERFORM padmin.require(p_account, 'billing.read');
 RETURN QUERY SELECT t.id, t.organization_id, o.name, t.kind, t.ref, t.doc_date, t.gross_minor, t.status, t.attempts, t.last_error,
   t.invoice_no, t.receipt_no, t.credit_note_no, t.issued_at, t.created_at, count(*) OVER ()
 FROM billing.tax_documents t JOIN core.organizations o ON o.id = t.organization_id
 WHERE (p_status IS NULL OR t.status = p_status OR (p_status = 'open' AND t.status IN ('queued','running','failed')))
   AND (p_organization_id IS NULL OR t.organization_id = p_organization_id)
 ORDER BY t.created_at DESC LIMIT least(greatest(p_limit, 1), 100) OFFSET greatest(p_offset, 0);
END $$;

-- One document of any shop, for the console PDF.
CREATE FUNCTION padmin.tax_document(p_account uuid, p_id uuid, p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v jsonb;
BEGIN
 PERFORM padmin.require(p_account, 'billing.read');
 SELECT to_jsonb(t) INTO v FROM billing.tax_documents t WHERE t.id = p_id;
 IF v IS NOT NULL THEN
   INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, request_id)
   VALUES (p_account, (v->>'organization_id')::uuid, 'billing.read', 'tax_document.viewed', 'tax_document', p_id, p_request);
 END IF;
 RETURN v;
END $$;

-- retry: failed/queued → queued now. skip: never issue through KooChang (made by hand in the legacy program).
-- outcome: ok | not_found | not_allowed
CREATE FUNCTION padmin.act_tax_document(p_account uuid, p_id uuid, p_action text, p_reason text, p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE t billing.tax_documents%ROWTYPE;
BEGIN
 PERFORM padmin.require(p_account, 'billing.verify');
 IF p_action NOT IN ('retry','skip') OR length(trim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'invalid action' USING ERRCODE = '22023'; END IF;
 SELECT * INTO t FROM billing.tax_documents x WHERE x.id = p_id FOR UPDATE;
 IF t.id IS NULL THEN RETURN 'not_found'; END IF;
 IF t.status NOT IN ('queued','failed') THEN RETURN 'not_allowed'; END IF;
 IF p_action = 'retry' THEN
   UPDATE billing.tax_documents SET status = 'queued', attempts = 0, next_attempt_at = now(), updated_at = now() WHERE id = p_id;
 ELSE
   IF t.kind = 'receipt' AND EXISTS (SELECT 1 FROM billing.tax_documents c WHERE c.payment_id = t.payment_id AND c.kind = 'credit_note' AND c.status IN ('queued','running','issued')) THEN
     RETURN 'not_allowed'; END IF;
   UPDATE billing.tax_documents SET status = 'skipped', skipped_by = p_account, skip_reason = trim(p_reason), updated_at = now() WHERE id = p_id;
 END IF;
 INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, details, request_id)
 VALUES (p_account, t.organization_id, 'billing.verify', 'tax_document.' || p_action, 'tax_document', p_id, jsonb_build_object('reason', trim(p_reason)), p_request);
 RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION padmin.tax_documents(uuid,text,uuid,integer,integer), padmin.tax_document(uuid,uuid,uuid),
 padmin.act_tax_document(uuid,uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.tax_documents(uuid,text,uuid,integer,integer), padmin.tax_document(uuid,uuid,uuid),
 padmin.act_tax_document(uuid,uuid,text,text,uuid) TO fs_platform;

-- Console settings gain the ITISME connection (password sealed like the provider keys).
CREATE OR REPLACE FUNCTION padmin.console_settings(p_account uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s platform.runtime_settings%ROWTYPE;
BEGIN
 PERFORM padmin.require(p_account,'settings.manage');
 SELECT * INTO s FROM platform.runtime_settings WHERE id;
 RETURN jsonb_build_object('version',coalesce(s.version,0),'bank',s.bank,
 'sms',CASE WHEN s.sms IS NULL THEN NULL ELSE s.sms-'apiKeySealed'-'secretKeySealed' ||
   jsonb_build_object('key_configured',s.sms ? 'apiKeySealed' AND s.sms ? 'secretKeySealed') END,
 'ocr',CASE WHEN s.ocr IS NULL THEN NULL ELSE s.ocr-'keySealed' || jsonb_build_object('key_configured',s.ocr ? 'keySealed') END,
 'easyslip',CASE WHEN s.easyslip IS NULL THEN NULL ELSE s.easyslip-'keySealed' ||
   jsonb_build_object('key_configured',s.easyslip ? 'keySealed') END,
 'itisme',CASE WHEN s.itisme IS NULL THEN NULL ELSE s.itisme-'passwordSealed' || jsonb_build_object('key_configured',s.itisme ? 'passwordSealed') END);
END $$;
CREATE OR REPLACE FUNCTION padmin.save_console_settings(p_account uuid,p_section text,p_value jsonb,p_version integer,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s platform.runtime_settings%ROWTYPE;
BEGIN
 PERFORM padmin.require(p_account,'settings.manage');
 IF p_section NOT IN ('bank','sms','easyslip','ocr','itisme') OR jsonb_typeof(p_value)<>'object' THEN RAISE EXCEPTION 'invalid settings' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_value->'enabled') IS DISTINCT FROM 'boolean' OR
   (p_section='bank' AND p_value-ARRAY['enabled','bankName','accountName','accountNumber','bankCode','promptPayId']<>'{}'::jsonb) OR
   (p_section='sms' AND p_value-ARRAY['enabled','sender','apiKeySealed','secretKeySealed']<>'{}'::jsonb) OR
   (p_section='ocr' AND p_value-ARRAY['enabled','model','keySealed']<>'{}'::jsonb) OR
   (p_section='easyslip' AND p_value-ARRAY['enabled','keySealed']<>'{}'::jsonb) OR
   (p_section='itisme' AND p_value-ARRAY['enabled','server','port','database','user','passwordSealed']<>'{}'::jsonb) THEN
   RAISE EXCEPTION 'invalid settings fields' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(16016);
 SELECT * INTO s FROM platform.runtime_settings WHERE id FOR UPDATE;
 IF coalesce(s.version,0)<>p_version THEN RETURN 'conflict'; END IF;
 IF s.id IS NULL THEN INSERT INTO platform.runtime_settings(id,version) VALUES(true,1);
 ELSE UPDATE platform.runtime_settings SET version=version+1,updated_at=now() WHERE id; END IF;
 IF p_section='bank' THEN UPDATE platform.runtime_settings SET bank=p_value WHERE id;
 ELSIF p_section='sms' THEN UPDATE platform.runtime_settings SET sms=coalesce(s.sms,'{}')||p_value WHERE id;
 ELSIF p_section='ocr' THEN UPDATE platform.runtime_settings SET ocr=coalesce(s.ocr,'{}')||p_value WHERE id;
 ELSIF p_section='itisme' THEN UPDATE platform.runtime_settings SET itisme=coalesce(s.itisme,'{}')||p_value WHERE id;
 ELSE UPDATE platform.runtime_settings SET easyslip=coalesce(s.easyslip,'{}')||p_value WHERE id; END IF;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,details,request_id)
 VALUES(p_account,'console_settings.updated','platform_settings',jsonb_build_object('section',p_section,'enabled',p_value->'enabled'),p_request);
 RETURN 'ok';
END $$;
