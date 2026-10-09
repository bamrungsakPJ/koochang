-- 036: seller details and logo for the receipt header live in the console (owner decision 2026-10-09).
-- The ITISME Company row is not what the legacy program prints (it held a wrong English name and tax id), so the
-- ITISME section gains `seller` (name, tax id, branch, address, phone) and `logo` (PNG/JPEG, base64). ITISME
-- still numbers every document.
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
   (p_section='itisme' AND p_value-ARRAY['enabled','server','port','database','user','passwordSealed','seller','logo']<>'{}'::jsonb) THEN
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
