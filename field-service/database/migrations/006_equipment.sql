-- B02 equipment: camera-first, OCR as suggestions only, duplicates offered not merged.
-- PostgreSQL 16 target. Apply as fs_migrator.

-- equipment --------------------------------------------------------------------------------
-- Category is required; a nickname, brand, model and serial are all optional (faded or missing
-- nameplates must not block work). serial_normalized helps find candidates; it is not a key.
ALTER TABLE core.equipment
  ALTER COLUMN name DROP NOT NULL,
  ADD COLUMN serial_normalized text,
  ADD COLUMN installed_on date,
  ADD COLUMN note text,
  ADD COLUMN created_by_member_id uuid,
  ADD COLUMN create_request_key uuid,
  ADD CONSTRAINT equipment_category CHECK (length(trim(equipment_type)) BETWEEN 1 AND 40),
  ADD CONSTRAINT equipment_create_request UNIQUE (organization_id, create_request_key),
  ADD FOREIGN KEY (organization_id, created_by_member_id) REFERENCES core.organization_members(organization_id, id);
CREATE INDEX equipment_serial ON core.equipment(organization_id, serial_normalized) WHERE serial_normalized IS NOT NULL;

ALTER TABLE core.equipment_photos
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN caption text;

-- An OCR request may later point at the equipment it helped to create; accepted_fields keeps
-- what the person confirmed, separately from the raw suggestions.
ALTER TABLE core.ocr_requests
  ADD COLUMN equipment_id uuid,
  ADD FOREIGN KEY (organization_id, equipment_id) REFERENCES core.equipment(organization_id, id);

-- Technician scope follows locations: a technician sees equipment at locations they can see,
-- and photos of equipment they can see.
CREATE POLICY technician_scope ON core.equipment AS RESTRICTIVE TO fs_api
  USING (EXISTS (SELECT 1 FROM core.customer_locations l WHERE l.organization_id = equipment.organization_id AND l.id = equipment.location_id))
  WITH CHECK (EXISTS (SELECT 1 FROM core.customer_locations l WHERE l.organization_id = equipment.organization_id AND l.id = equipment.location_id));
CREATE POLICY technician_scope ON core.equipment_photos AS RESTRICTIVE TO fs_api
  USING (EXISTS (SELECT 1 FROM core.equipment e WHERE e.organization_id = equipment_photos.organization_id AND e.id = equipment_photos.equipment_id))
  WITH CHECK (EXISTS (SELECT 1 FROM core.equipment e WHERE e.organization_id = equipment_photos.organization_id AND e.id = equipment_photos.equipment_id));
