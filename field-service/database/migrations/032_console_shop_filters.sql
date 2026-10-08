-- 032: console lists filtered by shop (2026-10-08).
-- Payments (invoice queue) and support tickets get an optional organization filter applied inside the query,
-- so paging (payments, 50 a page) and the 200-ticket cap count only that shop's rows. Audit already had one.
-- The older signatures stay for the API version that is still running while this migration is applied.

CREATE FUNCTION padmin.payment_queue(p_account_id uuid,p_status text,p_offset integer,p_organization_id uuid)
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
 WHERE (p_organization_id IS NULL OR i.organization_id=p_organization_id)
  AND ((p_status='pending' AND ((i.status='open' AND pp.status='pending') OR EXISTS(SELECT 1 FROM billing.stripe_checkouts sc WHERE sc.invoice_id=i.id AND sc.status='manual_review')
    OR EXISTS(SELECT 1 FROM billing.stripe_subscription_invoices sx WHERE sx.invoice_id=i.id AND sx.status='manual_review')))
  OR (p_status='open' AND i.status='open') OR (p_status='paid' AND i.status='paid') OR (p_status='all'))
 ORDER BY CASE WHEN pp.status='pending' THEN pp.created_at END NULLS LAST,i.created_at DESC,i.id
 LIMIT 51 OFFSET greatest(p_offset,0);
END $$;

CREATE FUNCTION padmin.tickets(p_account_id uuid, p_status text, p_organization_id uuid)
RETURNS TABLE (id uuid, organization_id uuid, organization_name text, subject text, status text, assigned_to text, created_at timestamptz, last_message_at timestamptz, last_from_shop boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'support.read');
  RETURN QUERY SELECT t.id, t.organization_id, o.name, t.subject, t.status, a.display_name, t.created_at, t.last_message_at,
    (SELECT m.author_user_id IS NOT NULL FROM platform.support_messages m WHERE m.ticket_id = t.id AND NOT m.internal ORDER BY m.created_at DESC LIMIT 1)
  FROM platform.support_tickets t JOIN core.organizations o ON o.id = t.organization_id LEFT JOIN platform.accounts a ON a.id = t.assigned_account_id
  WHERE (p_organization_id IS NULL OR t.organization_id = p_organization_id)
    AND ((p_status = 'open' AND t.status IN ('open','in_progress')) OR (p_status = 'all') OR t.status = p_status)
  ORDER BY t.last_message_at DESC LIMIT 200;
END $$;

REVOKE ALL ON FUNCTION padmin.payment_queue(uuid,text,integer,uuid), padmin.tickets(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.payment_queue(uuid,text,integer,uuid), padmin.tickets(uuid,text,uuid) TO fs_platform;
