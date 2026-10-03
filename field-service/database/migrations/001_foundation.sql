-- Foundation migration. PostgreSQL 16 target. Apply as fs_migrator.

CREATE SCHEMA core;
REVOKE ALL ON SCHEMA core FROM PUBLIC;

CREATE SCHEMA billing;
REVOKE ALL ON SCHEMA billing FROM PUBLIC;

CREATE SCHEMA platform;
REVOKE ALL ON SCHEMA platform FROM PUBLIC;

CREATE SCHEMA ops;
REVOKE ALL ON SCHEMA ops FROM PUBLIC;

CREATE TABLE core.users (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
display_name text NOT NULL CHECK (length(trim(display_name)) > 0), phone_e164 text UNIQUE, preferred_language text NOT NULL DEFAULT 'th' CHECK (preferred_language IN ('th','en')), status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'))
);

CREATE TABLE core.organizations (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
name text NOT NULL CHECK (length(trim(name)) > 0), timezone text NOT NULL DEFAULT 'Asia/Bangkok', default_language text NOT NULL DEFAULT 'th' CHECK (default_language IN ('th','en')), status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed'))
);

CREATE TABLE core.organization_members (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
user_id uuid NOT NULL REFERENCES core.users(id), role text NOT NULL CHECK (role IN ('owner','technician')), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','suspended','removed')), approved_at timestamptz, UNIQUE (organization_id,user_id),
UNIQUE (organization_id,id)
);

CREATE UNIQUE INDEX one_active_owner ON core.organization_members(organization_id) WHERE role='owner' AND status='active';

CREATE TABLE core.organization_join_links (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
token_hash text NOT NULL UNIQUE CHECK (length(token_hash) >= 32), status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','revoked')), revoked_at timestamptz,
UNIQUE (organization_id,id)
);

CREATE UNIQUE INDEX one_active_join_link ON core.organization_join_links(organization_id) WHERE status='active';

CREATE TABLE core.customers (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
name text NOT NULL CHECK (length(trim(name)) > 0), customer_type text NOT NULL DEFAULT 'individual' CHECK (customer_type IN ('individual','business')), phone text, note text, archived_at timestamptz,
UNIQUE (organization_id,id)
);

CREATE TABLE core.customer_locations (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),

customer_id uuid NOT NULL, name text NOT NULL, address text,
latitude numeric(9,6), longitude numeric(9,6), accuracy_meters numeric CHECK (accuracy_meters >= 0),
capture_method text CHECK (capture_method IN ('current_location','manual_pin')),
location_captured_at timestamptz, location_captured_by uuid REFERENCES core.users(id), archived_at timestamptz,
CHECK ((latitude IS NULL) = (longitude IS NULL)), CHECK (latitude BETWEEN -90 AND 90), CHECK (longitude BETWEEN -180 AND 180),
CHECK ((latitude IS NULL AND capture_method IS NULL AND location_captured_at IS NULL AND location_captured_by IS NULL AND accuracy_meters IS NULL)
 OR (latitude IS NOT NULL AND capture_method IS NOT NULL AND location_captured_at IS NOT NULL AND location_captured_by IS NOT NULL)),
FOREIGN KEY (organization_id,customer_id) REFERENCES core.customers(organization_id,id),
UNIQUE (organization_id,id,customer_id)
,
UNIQUE (organization_id,id)
);

CREATE TABLE core.equipment (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
location_id uuid NOT NULL, name text NOT NULL, equipment_type text NOT NULL DEFAULT 'other', brand text, model text, serial_number text, installation_note text, qr_code text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired','archived')), FOREIGN KEY (organization_id,location_id) REFERENCES core.customer_locations(organization_id,id), UNIQUE (organization_id,id,location_id),
UNIQUE (organization_id,id)
);

CREATE TABLE core.jobs (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),

customer_id uuid NOT NULL, location_id uuid NOT NULL, title text NOT NULL,
job_type text NOT NULL CHECK (job_type IN ('installation','repair','inspection','maintenance','other')),
status text NOT NULL DEFAULT 'unassigned' CHECK (status IN ('draft','unassigned','scheduled','in_progress','completed','cancelled')),
current_assignee_id uuid, scheduled_start timestamptz, scheduled_end timestamptz, started_at timestamptz, completed_at timestamptz, cancellation_reason text,
CHECK (scheduled_end IS NULL OR (scheduled_start IS NOT NULL AND scheduled_end > scheduled_start)),
CHECK (status NOT IN ('scheduled','in_progress') OR current_assignee_id IS NOT NULL),
CHECK (status != 'in_progress' OR started_at IS NOT NULL), CHECK (status != 'cancelled' OR (cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) > 0)),
CHECK (status != 'completed' OR completed_at IS NOT NULL),
FOREIGN KEY (organization_id,customer_id) REFERENCES core.customers(organization_id,id),
FOREIGN KEY (organization_id,location_id,customer_id) REFERENCES core.customer_locations(organization_id,id,customer_id),
FOREIGN KEY (organization_id,current_assignee_id) REFERENCES core.organization_members(organization_id,id),
UNIQUE (organization_id,id,customer_id,location_id), UNIQUE (organization_id,id,location_id)
,
UNIQUE (organization_id,id)
);

CREATE TABLE core.job_equipment (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
job_id uuid NOT NULL, equipment_id uuid NOT NULL, location_id uuid NOT NULL, FOREIGN KEY (organization_id,job_id,location_id) REFERENCES core.jobs(organization_id,id,location_id), FOREIGN KEY (organization_id,equipment_id,location_id) REFERENCES core.equipment(organization_id,id,location_id), UNIQUE (organization_id,job_id,equipment_id),
UNIQUE (organization_id,id)
);

CREATE TABLE core.job_assignments (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
job_id uuid NOT NULL, member_id uuid NOT NULL, assigned_by uuid NOT NULL REFERENCES core.users(id), started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, CHECK (ended_at IS NULL OR ended_at >= started_at), FOREIGN KEY (organization_id,job_id) REFERENCES core.jobs(organization_id,id), FOREIGN KEY (organization_id,member_id) REFERENCES core.organization_members(organization_id,id),
UNIQUE (organization_id,id)
);

CREATE UNIQUE INDEX one_open_assignment ON core.job_assignments(organization_id,job_id) WHERE ended_at IS NULL;

CREATE TABLE core.service_events (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),

client_event_id uuid NOT NULL, job_id uuid, customer_id uuid NOT NULL, location_id uuid NOT NULL,
performed_by uuid NOT NULL, occurred_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'committed' CHECK (status IN ('committed','voided')), note text,
FOREIGN KEY (organization_id,customer_id) REFERENCES core.customers(organization_id,id),
FOREIGN KEY (organization_id,location_id,customer_id) REFERENCES core.customer_locations(organization_id,id,customer_id),
FOREIGN KEY (organization_id,job_id,customer_id,location_id) REFERENCES core.jobs(organization_id,id,customer_id,location_id),
FOREIGN KEY (organization_id,performed_by) REFERENCES core.organization_members(organization_id,id),
UNIQUE (organization_id,client_event_id), UNIQUE (organization_id,id,location_id)
,
UNIQUE (organization_id,id)
);

CREATE UNIQUE INDEX one_committed_event_per_job ON core.service_events(organization_id,job_id) WHERE status='committed' AND job_id IS NOT NULL;

CREATE TABLE core.service_event_equipment (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),

service_event_id uuid NOT NULL, equipment_id uuid NOT NULL, location_id uuid NOT NULL,
service_type text NOT NULL CHECK (service_type IN ('installation','repair','inspection','maintenance','other')),
outcome text NOT NULL CHECK (outcome IN ('done','not_done','deferred')), note text,
FOREIGN KEY (organization_id,service_event_id,location_id) REFERENCES core.service_events(organization_id,id,location_id),
FOREIGN KEY (organization_id,equipment_id,location_id) REFERENCES core.equipment(organization_id,id,location_id),
UNIQUE (organization_id,service_event_id,equipment_id,service_type)
,
UNIQUE (organization_id,id)
);

CREATE TABLE core.media_assets (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
object_key text NOT NULL UNIQUE, mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')), size_bytes bigint NOT NULL CHECK (size_bytes >= 0), status text NOT NULL DEFAULT 'pending_upload' CHECK (status IN ('pending_upload','processing','ready','failed','deleted')), uploaded_by uuid NOT NULL REFERENCES core.users(id),
UNIQUE (organization_id,id)
);

CREATE TABLE core.equipment_photos (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
equipment_id uuid NOT NULL, media_asset_id uuid NOT NULL, photo_type text NOT NULL CHECK (photo_type IN ('nameplate','equipment','other')), FOREIGN KEY (organization_id,equipment_id) REFERENCES core.equipment(organization_id,id), FOREIGN KEY (organization_id,media_asset_id) REFERENCES core.media_assets(organization_id,id), UNIQUE (organization_id,equipment_id,media_asset_id),
UNIQUE (organization_id,id)
);

CREATE TABLE core.service_photos (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
service_event_equipment_id uuid NOT NULL, media_asset_id uuid NOT NULL, photo_type text NOT NULL CHECK (photo_type IN ('before','after','issue','other')), FOREIGN KEY (organization_id,service_event_equipment_id) REFERENCES core.service_event_equipment(organization_id,id), FOREIGN KEY (organization_id,media_asset_id) REFERENCES core.media_assets(organization_id,id), UNIQUE (organization_id,service_event_equipment_id,media_asset_id),
UNIQUE (organization_id,id)
);

CREATE TABLE core.ocr_requests (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
request_key uuid NOT NULL, media_asset_id uuid NOT NULL, requested_by uuid NOT NULL REFERENCES core.users(id), status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')), result jsonb, quota_consumed boolean NOT NULL DEFAULT false, FOREIGN KEY (organization_id,media_asset_id) REFERENCES core.media_assets(organization_id,id), UNIQUE (organization_id,request_key),
UNIQUE (organization_id,id)
);

CREATE TABLE core.maintenance_schedules (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
equipment_id uuid NOT NULL, service_type text NOT NULL CHECK (service_type IN ('installation','repair','inspection','maintenance','other')), enabled boolean NOT NULL DEFAULT true, schedule_mode text NOT NULL DEFAULT 'months' CHECK (schedule_mode IN ('months','custom_date')), interval_months integer, custom_due_date date, CHECK (NOT enabled OR (schedule_mode='months' AND interval_months IS NOT NULL AND interval_months>0 AND custom_due_date IS NULL) OR (schedule_mode='custom_date' AND custom_due_date IS NOT NULL AND interval_months IS NULL)), FOREIGN KEY (organization_id,equipment_id) REFERENCES core.equipment(organization_id,id), UNIQUE (organization_id,equipment_id,service_type),
UNIQUE (organization_id,id)
);

CREATE TABLE core.maintenance_cycles (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
schedule_id uuid NOT NULL, source_service_event_equipment_id uuid, due_date date NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','fulfilled','superseded','disabled')), FOREIGN KEY (organization_id,schedule_id) REFERENCES core.maintenance_schedules(organization_id,id), FOREIGN KEY (organization_id,source_service_event_equipment_id) REFERENCES core.service_event_equipment(organization_id,id),
UNIQUE (organization_id,id)
);

CREATE UNIQUE INDEX one_open_cycle ON core.maintenance_cycles(organization_id,schedule_id) WHERE status='open';

CREATE TABLE core.maintenance_bookings (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
cycle_id uuid NOT NULL, job_id uuid NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','fulfilled')), FOREIGN KEY (organization_id,cycle_id) REFERENCES core.maintenance_cycles(organization_id,id), FOREIGN KEY (organization_id,job_id) REFERENCES core.jobs(organization_id,id), UNIQUE (organization_id,cycle_id,job_id),
UNIQUE (organization_id,id)
);

CREATE TABLE core.notifications (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
recipient_user_id uuid NOT NULL REFERENCES core.users(id), event_key text NOT NULL, template_key text NOT NULL, parameters jsonb NOT NULL DEFAULT '{}', sent_language text CHECK (sent_language IN ('th','en')), sent_snapshot text, read_at timestamptz, UNIQUE (organization_id,recipient_user_id,event_key),
UNIQUE (organization_id,id)
);

CREATE TABLE billing.plans (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
code text NOT NULL UNIQUE, name_th text NOT NULL, name_en text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))
);

CREATE TABLE billing.plan_versions (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
plan_id uuid NOT NULL REFERENCES billing.plans(id), version_no integer NOT NULL CHECK (version_no>0), technician_seats integer NOT NULL CHECK (technician_seats>0), storage_bytes bigint NOT NULL CHECK (storage_bytes>0), ocr_per_period integer NOT NULL CHECK (ocr_per_period>=0), trial_days integer NOT NULL DEFAULT 14 CHECK (trial_days>=0), grace_days integer NOT NULL DEFAULT 7 CHECK (grace_days>=0), published_at timestamptz NOT NULL, UNIQUE (plan_id,version_no)
);

CREATE TABLE billing.price_versions (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
plan_version_id uuid NOT NULL REFERENCES billing.plan_versions(id), amount_minor bigint NOT NULL CHECK (amount_minor>=0), currency char(3) NOT NULL DEFAULT 'THB' CHECK (currency='THB'), interval_unit text NOT NULL DEFAULT 'month' CHECK (interval_unit IN ('month','year')), effective_from timestamptz NOT NULL, UNIQUE (id,plan_version_id)
);

CREATE TABLE billing.subscriptions (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
plan_version_id uuid NOT NULL REFERENCES billing.plan_versions(id), price_version_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('trialing','pending_payment','active','past_due','expired','ended')), trial_started_at timestamptz, trial_end_at timestamptz, cancel_at_period_end boolean NOT NULL DEFAULT false, grace_until timestamptz, CHECK (trial_end_at IS NULL OR (trial_started_at IS NOT NULL AND trial_end_at>trial_started_at)), FOREIGN KEY (price_version_id,plan_version_id) REFERENCES billing.price_versions(id,plan_version_id), UNIQUE (organization_id),
UNIQUE (organization_id,id)
);

CREATE TABLE billing.invoices (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
number text NOT NULL UNIQUE, amount_minor bigint NOT NULL CHECK (amount_minor>=0), currency char(3) NOT NULL DEFAULT 'THB' CHECK (currency='THB'), price_version_id uuid NOT NULL REFERENCES billing.price_versions(id), status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','voided')), buyer_snapshot jsonb NOT NULL DEFAULT '{}',
UNIQUE (organization_id,id)
);

CREATE TABLE billing.payments (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
invoice_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK (amount_minor>0), currency char(3) NOT NULL DEFAULT 'THB' CHECK (currency='THB'), bank_reference text NOT NULL UNIQUE, verified_at timestamptz NOT NULL, verified_by uuid NOT NULL, FOREIGN KEY (organization_id,invoice_id) REFERENCES billing.invoices(organization_id,id),
UNIQUE (organization_id,id)
);

CREATE TABLE billing.subscription_periods (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
subscription_id uuid NOT NULL, invoice_id uuid, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, CHECK (end_at>start_at), FOREIGN KEY (organization_id,subscription_id) REFERENCES billing.subscriptions(organization_id,id), FOREIGN KEY (organization_id,invoice_id) REFERENCES billing.invoices(organization_id,id), UNIQUE (organization_id,invoice_id),
UNIQUE (organization_id,id)
);

CREATE TABLE billing.payment_proofs (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
invoice_id uuid NOT NULL, private_object_key text NOT NULL UNIQUE, submitted_by uuid NOT NULL REFERENCES core.users(id), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')), reason text, FOREIGN KEY (organization_id,invoice_id) REFERENCES billing.invoices(organization_id,id),
UNIQUE (organization_id,id)
);

CREATE TABLE billing.refunds (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
payment_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK (amount_minor>0), requested_by uuid NOT NULL, approved_by uuid, reason text NOT NULL CHECK (length(trim(reason))>0), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','succeeded','failed','rejected')), bank_reference text UNIQUE, CHECK (approved_by IS NULL OR approved_by<>requested_by), CHECK (status NOT IN ('approved','succeeded') OR approved_by IS NOT NULL), CHECK (status<>'succeeded' OR bank_reference IS NOT NULL), FOREIGN KEY (organization_id,payment_id) REFERENCES billing.payments(organization_id,id),
UNIQUE (organization_id,id)
);

CREATE TABLE billing.usage_counters (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
metric text NOT NULL CHECK (metric IN ('technician_seats','storage_bytes','ocr')), window_key text NOT NULL, used bigint NOT NULL DEFAULT 0 CHECK (used>=0), UNIQUE (organization_id,metric,window_key),
UNIQUE (organization_id,id)
);

CREATE TABLE billing.usage_reservations (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
metric text NOT NULL CHECK (metric IN ('storage_bytes','ocr')), request_key uuid NOT NULL, units bigint NOT NULL CHECK (units>0), status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','consumed','released','expired')), expires_at timestamptz NOT NULL, UNIQUE (organization_id,metric,request_key),
UNIQUE (organization_id,id)
);

CREATE TABLE billing.entitlement_grants (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
reason text NOT NULL CHECK (length(trim(reason))>0), grant_kind text NOT NULL CHECK (grant_kind IN ('pilot','compensation','temporary_upgrade')), valid_from timestamptz NOT NULL, valid_until timestamptz NOT NULL, entitlements jsonb NOT NULL, granted_by uuid NOT NULL, CHECK (valid_until>valid_from),
UNIQUE (organization_id,id)
);

CREATE TABLE platform.accounts (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
display_name text NOT NULL, email text NOT NULL UNIQUE, preferred_language text NOT NULL DEFAULT 'th' CHECK (preferred_language IN ('th','en')), status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')), mfa_enrolled boolean NOT NULL DEFAULT false
);

CREATE TABLE platform.roles (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
code text NOT NULL UNIQUE CHECK (code IN ('super_admin','platform_admin','billing_operator','billing_approver','support_agent','operations','auditor'))
);

CREATE TABLE platform.account_roles (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
account_id uuid NOT NULL REFERENCES platform.accounts(id), role_id uuid NOT NULL REFERENCES platform.roles(id), UNIQUE (account_id,role_id)
);

ALTER TABLE billing.payments ADD FOREIGN KEY (verified_by) REFERENCES platform.accounts(id);
ALTER TABLE billing.refunds ADD FOREIGN KEY (requested_by) REFERENCES platform.accounts(id), ADD FOREIGN KEY (approved_by) REFERENCES platform.accounts(id);
ALTER TABLE billing.entitlement_grants ADD FOREIGN KEY (granted_by) REFERENCES platform.accounts(id);

CREATE TABLE platform.support_tickets (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
opened_by uuid NOT NULL REFERENCES core.users(id), subject text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')), assigned_account_id uuid REFERENCES platform.accounts(id),
UNIQUE (organization_id,id)
);

CREATE TABLE platform.support_access_grants (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
ticket_id uuid NOT NULL, account_id uuid NOT NULL REFERENCES platform.accounts(id), consented_by uuid REFERENCES core.users(id), approved_by uuid REFERENCES platform.accounts(id), scope jsonb NOT NULL, reason text NOT NULL CHECK (length(trim(reason))>0), valid_from timestamptz NOT NULL, valid_until timestamptz NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked','expired','rejected')), CHECK (valid_until>valid_from AND valid_until<=valid_from+interval '60 minutes'), CHECK (status<>'active' OR (consented_by IS NOT NULL AND approved_by IS NOT NULL)), FOREIGN KEY (organization_id,ticket_id) REFERENCES platform.support_tickets(organization_id,id),
UNIQUE (organization_id,id)
);

CREATE TABLE platform.data_requests (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
requested_by uuid NOT NULL REFERENCES core.users(id), request_type text NOT NULL CHECK (request_type IN ('export','closure','deletion')), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','running','succeeded','rejected','cancelled')), scope jsonb NOT NULL DEFAULT '{}', reason text, completed_at timestamptz,
UNIQUE (organization_id,id)
);

CREATE TABLE ops.audit_logs (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
actor_user_id uuid REFERENCES core.users(id), actor_platform_id uuid REFERENCES platform.accounts(id), action text NOT NULL, entity_type text NOT NULL, entity_id uuid, reason text, request_id uuid NOT NULL, details jsonb NOT NULL DEFAULT '{}', CHECK ((actor_user_id IS NOT NULL)::integer + (actor_platform_id IS NOT NULL)::integer = 1),
UNIQUE (organization_id,id)
);

CREATE TABLE ops.outbox_events (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
event_key text NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL, processed_at timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0), UNIQUE (organization_id,event_key),
UNIQUE (organization_id,id)
);

CREATE TABLE ops.idempotency_keys (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL REFERENCES core.organizations(id),
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
version integer NOT NULL DEFAULT 1 CHECK (version > 0),
actor_user_id uuid NOT NULL REFERENCES core.users(id), route text NOT NULL, key text NOT NULL, payload_hash text NOT NULL CHECK (length(payload_hash)=64), response jsonb, expires_at timestamptz NOT NULL, UNIQUE (organization_id,actor_user_id,route,key),
UNIQUE (organization_id,id)
);


CREATE FUNCTION core.context_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id',true),'')::uuid $$;
CREATE FUNCTION core.context_organization_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.organization_id',true),'')::uuid $$;
ALTER TABLE core.users ENABLE ROW LEVEL SECURITY; ALTER TABLE core.users FORCE ROW LEVEL SECURITY;
CREATE POLICY own_identity ON core.users FOR SELECT TO fs_api USING (id=core.context_user_id());
ALTER TABLE core.organization_members ENABLE ROW LEVEL SECURITY; ALTER TABLE core.organization_members FORCE ROW LEVEL SECURITY;
CREATE POLICY own_membership ON core.organization_members FOR SELECT TO fs_api USING (user_id=core.context_user_id() AND organization_id=core.context_organization_id());
ALTER TABLE core.organizations ENABLE ROW LEVEL SECURITY; ALTER TABLE core.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY joined_organization ON core.organizations FOR SELECT TO fs_api USING (
 id=core.context_organization_id() AND EXISTS (SELECT 1 FROM core.organization_members m JOIN core.users u ON u.id=m.user_id WHERE m.organization_id=core.organizations.id AND m.user_id=core.context_user_id() AND m.status='active' AND u.status='active')
);
CREATE FUNCTION core.tenant_allowed(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,core AS $$
 SELECT coalesce(target=core.context_organization_id() AND EXISTS (
 SELECT 1 FROM core.organization_members m JOIN core.users u ON u.id=m.user_id JOIN core.organizations o ON o.id=m.organization_id
 WHERE m.organization_id=target AND m.user_id=core.context_user_id() AND m.status='active' AND u.status='active' AND o.status='active'),false)
$$;
CREATE FUNCTION core.owner_allowed(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,core AS $$
 SELECT core.tenant_allowed(target) AND EXISTS (SELECT 1 FROM core.organization_members WHERE organization_id=target AND user_id=core.context_user_id() AND status='active' AND role='owner')
$$;
GRANT USAGE ON SCHEMA core,billing,ops TO fs_api;
GRANT SELECT ON core.users,core.organizations,core.organization_members TO fs_api;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA core FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA core TO fs_api;


ALTER TABLE core.organization_join_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.organization_join_links FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.organization_join_links TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.organization_join_links TO fs_api;

ALTER TABLE core.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.customers FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.customers TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.customers TO fs_api;

GRANT INSERT,UPDATE ON core.customers TO fs_api;

ALTER TABLE core.customer_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.customer_locations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.customer_locations TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.customer_locations TO fs_api;

GRANT INSERT,UPDATE ON core.customer_locations TO fs_api;

ALTER TABLE core.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.equipment FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.equipment TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.equipment TO fs_api;

GRANT INSERT,UPDATE ON core.equipment TO fs_api;

ALTER TABLE core.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.jobs TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.jobs TO fs_api;

GRANT INSERT,UPDATE ON core.jobs TO fs_api;

ALTER TABLE core.job_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.job_equipment FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.job_equipment TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.job_equipment TO fs_api;

GRANT INSERT,UPDATE ON core.job_equipment TO fs_api;

ALTER TABLE core.job_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.job_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.job_assignments TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.job_assignments TO fs_api;

GRANT INSERT,UPDATE ON core.job_assignments TO fs_api;

ALTER TABLE core.service_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.service_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.service_events TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.service_events TO fs_api;

GRANT INSERT,UPDATE ON core.service_events TO fs_api;

ALTER TABLE core.service_event_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.service_event_equipment FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.service_event_equipment TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.service_event_equipment TO fs_api;

GRANT INSERT,UPDATE ON core.service_event_equipment TO fs_api;

ALTER TABLE core.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.media_assets FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.media_assets TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.media_assets TO fs_api;

GRANT INSERT,UPDATE ON core.media_assets TO fs_api;

ALTER TABLE core.equipment_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.equipment_photos FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.equipment_photos TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.equipment_photos TO fs_api;

GRANT INSERT,UPDATE ON core.equipment_photos TO fs_api;

ALTER TABLE core.service_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.service_photos FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.service_photos TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.service_photos TO fs_api;

GRANT INSERT,UPDATE ON core.service_photos TO fs_api;

ALTER TABLE core.ocr_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.ocr_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.ocr_requests TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.ocr_requests TO fs_api;

GRANT INSERT,UPDATE ON core.ocr_requests TO fs_api;

ALTER TABLE core.maintenance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.maintenance_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.maintenance_schedules TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.maintenance_schedules TO fs_api;

GRANT INSERT,UPDATE ON core.maintenance_schedules TO fs_api;

ALTER TABLE core.maintenance_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.maintenance_cycles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.maintenance_cycles TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.maintenance_cycles TO fs_api;

GRANT INSERT,UPDATE ON core.maintenance_cycles TO fs_api;

ALTER TABLE core.maintenance_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.maintenance_bookings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.maintenance_bookings TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.maintenance_bookings TO fs_api;

GRANT INSERT,UPDATE ON core.maintenance_bookings TO fs_api;

ALTER TABLE core.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON core.notifications TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON core.notifications TO fs_api;

GRANT INSERT,UPDATE ON core.notifications TO fs_api;

ALTER TABLE billing.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON billing.subscriptions TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON billing.subscriptions TO fs_api;

ALTER TABLE billing.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON billing.invoices TO fs_api USING (core.owner_allowed(organization_id)) WITH CHECK (core.owner_allowed(organization_id));

GRANT SELECT ON billing.invoices TO fs_api;

ALTER TABLE billing.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.payments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON billing.payments TO fs_api USING (core.owner_allowed(organization_id)) WITH CHECK (core.owner_allowed(organization_id));

GRANT SELECT ON billing.payments TO fs_api;

ALTER TABLE billing.subscription_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.subscription_periods FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON billing.subscription_periods TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON billing.subscription_periods TO fs_api;

ALTER TABLE billing.payment_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.payment_proofs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON billing.payment_proofs TO fs_api USING (core.owner_allowed(organization_id)) WITH CHECK (core.owner_allowed(organization_id));

GRANT SELECT ON billing.payment_proofs TO fs_api;

ALTER TABLE billing.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.refunds FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON billing.refunds TO fs_api USING (core.owner_allowed(organization_id)) WITH CHECK (core.owner_allowed(organization_id));

GRANT SELECT ON billing.refunds TO fs_api;

ALTER TABLE billing.usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.usage_counters FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON billing.usage_counters TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON billing.usage_counters TO fs_api;

ALTER TABLE billing.usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.usage_reservations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON billing.usage_reservations TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON billing.usage_reservations TO fs_api;

ALTER TABLE billing.entitlement_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.entitlement_grants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON billing.entitlement_grants TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON billing.entitlement_grants TO fs_api;

ALTER TABLE platform.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.support_tickets FORCE ROW LEVEL SECURITY;

ALTER TABLE platform.support_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.support_access_grants FORCE ROW LEVEL SECURITY;

ALTER TABLE platform.data_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.data_requests FORCE ROW LEVEL SECURITY;

ALTER TABLE ops.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.audit_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON ops.audit_logs TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON ops.audit_logs TO fs_api;

GRANT INSERT ON ops.audit_logs TO fs_api;

ALTER TABLE ops.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.outbox_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON ops.outbox_events TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON ops.outbox_events TO fs_api;

GRANT INSERT ON ops.outbox_events TO fs_api;

ALTER TABLE ops.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.idempotency_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON ops.idempotency_keys TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));

GRANT SELECT ON ops.idempotency_keys TO fs_api;

GRANT INSERT ON ops.idempotency_keys TO fs_api;

GRANT SELECT ON billing.plans TO fs_api;

GRANT SELECT ON billing.plan_versions TO fs_api;

GRANT SELECT ON billing.price_versions TO fs_api;


CREATE FUNCTION billing.reject_version_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'PUBLISHED_VERSION_IMMUTABLE' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_plan_version BEFORE UPDATE OR DELETE ON billing.plan_versions FOR EACH ROW EXECUTE FUNCTION billing.reject_version_change();
CREATE TRIGGER immutable_price_version BEFORE UPDATE OR DELETE ON billing.price_versions FOR EACH ROW EXECUTE FUNCTION billing.reject_version_change();
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA billing FROM PUBLIC;
CREATE FUNCTION core.touch_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN NEW.updated_at=now(); NEW.version=OLD.version+1; RETURN NEW; END $$;
REVOKE EXECUTE ON FUNCTION core.touch_version() FROM PUBLIC;


CREATE TRIGGER touch_version BEFORE UPDATE ON core.users FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.organizations FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.organization_members FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.organization_join_links FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.customers FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.customer_locations FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.equipment FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.jobs FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.job_equipment FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.job_assignments FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.service_events FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.service_event_equipment FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.media_assets FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.equipment_photos FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.service_photos FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.ocr_requests FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.maintenance_schedules FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.maintenance_cycles FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.maintenance_bookings FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON core.notifications FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON billing.plans FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON billing.subscriptions FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON billing.invoices FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON billing.payments FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON billing.subscription_periods FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON billing.payment_proofs FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON billing.refunds FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON billing.usage_counters FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON billing.usage_reservations FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON billing.entitlement_grants FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON platform.accounts FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON platform.roles FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON platform.account_roles FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON platform.support_tickets FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON platform.support_access_grants FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON platform.data_requests FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON ops.outbox_events FOR EACH ROW EXECUTE FUNCTION core.touch_version();

CREATE TRIGGER touch_version BEFORE UPDATE ON ops.idempotency_keys FOR EACH ROW EXECUTE FUNCTION core.touch_version();


CREATE INDEX customers_name_search ON core.customers(organization_id,lower(name));
CREATE INDEX customers_phone_search ON core.customers(organization_id,phone);
CREATE INDEX jobs_assignee_calendar ON core.jobs(organization_id,current_assignee_id,status,scheduled_start);
CREATE INDEX equipment_at_location ON core.equipment(organization_id,location_id);
CREATE INDEX service_location_history ON core.service_events(organization_id,location_id,occurred_at DESC);
CREATE INDEX service_equipment_history ON core.service_event_equipment(organization_id,equipment_id);
CREATE INDEX maintenance_due ON core.maintenance_cycles(organization_id,due_date) WHERE status='open';
CREATE INDEX pending_outbox ON ops.outbox_events(organization_id,created_at) WHERE processed_at IS NULL;
REVOKE ALL ON ALL TABLES IN SCHEMA platform FROM PUBLIC;

