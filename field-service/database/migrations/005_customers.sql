-- B01 customers and locations: phone-first search, optional name, retry-safe creation,
-- technician scope, explicit coordinate capture with version and audit.
-- PostgreSQL 16 target. Apply as fs_migrator.

-- Context helpers -------------------------------------------------------------------------
-- The caller's membership in the context shop. SECURITY DEFINER so policies on other tables
-- can use it without recursing into organization_members' own policy.
CREATE FUNCTION core.context_member_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id FROM core.organization_members m
  WHERE m.organization_id = core.context_organization_id() AND m.user_id = core.context_user_id() AND m.status = 'active'
$$;
CREATE FUNCTION core.context_is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT m.role = 'owner' FROM core.organization_members m
    WHERE m.organization_id = core.context_organization_id() AND m.user_id = core.context_user_id() AND m.status = 'active'), false)
$$;
REVOKE EXECUTE ON FUNCTION core.context_member_id(), core.context_is_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.context_member_id(), core.context_is_owner() TO fs_api;

-- customers --------------------------------------------------------------------------------
-- Phone is the main way to find a customer; the name can come later (the app then shows the
-- phone, never an invented name). Phones are not unique: people share numbers.
ALTER TABLE core.customers
  ALTER COLUMN name DROP NOT NULL,
  DROP CONSTRAINT customers_name_check,
  ADD COLUMN phone_normalized text CHECK (phone_normalized IS NULL OR phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  ADD COLUMN created_by_member_id uuid,
  ADD COLUMN create_request_key uuid,
  ADD CONSTRAINT customers_name_or_phone CHECK (nullif(trim(coalesce(name, '')), '') IS NOT NULL OR phone_normalized IS NOT NULL),
  ADD CONSTRAINT customers_create_request UNIQUE (organization_id, create_request_key),
  ADD FOREIGN KEY (organization_id, created_by_member_id) REFERENCES core.organization_members(organization_id, id);
CREATE INDEX customers_phone_normalized ON core.customers(organization_id, phone_normalized) WHERE archived_at IS NULL;

-- locations --------------------------------------------------------------------------------
ALTER TABLE core.customer_locations
  ADD COLUMN travel_note text,
  ADD COLUMN created_by_member_id uuid,
  ADD COLUMN create_request_key uuid,
  ADD CONSTRAINT locations_name CHECK (length(trim(name)) > 0),
  ADD CONSTRAINT locations_create_request UNIQUE (organization_id, create_request_key),
  ADD FOREIGN KEY (organization_id, created_by_member_id) REFERENCES core.organization_members(organization_id, id);
CREATE INDEX locations_by_customer ON core.customer_locations(organization_id, customer_id) WHERE archived_at IS NULL;

-- Technician scope -------------------------------------------------------------------------
-- Owners see every customer and location of the shop. Until jobs exist (B03 widens this to
-- customers of assigned work), a technician sees only what they created on site.
CREATE POLICY technician_scope ON core.customers AS RESTRICTIVE TO fs_api
  USING (core.context_is_owner() OR created_by_member_id = core.context_member_id())
  WITH CHECK (core.context_is_owner() OR created_by_member_id = core.context_member_id());
CREATE POLICY technician_scope ON core.customer_locations AS RESTRICTIVE TO fs_api
  USING (core.context_is_owner() OR created_by_member_id = core.context_member_id()
    OR EXISTS (SELECT 1 FROM core.customers c WHERE c.organization_id = customer_locations.organization_id AND c.id = customer_locations.customer_id))
  WITH CHECK (core.context_is_owner() OR created_by_member_id = core.context_member_id()
    OR EXISTS (SELECT 1 FROM core.customers c WHERE c.organization_id = customer_locations.organization_id AND c.id = customer_locations.customer_id));
