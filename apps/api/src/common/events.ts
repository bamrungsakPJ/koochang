import { Prisma } from '@prisma/client';

export const EventType = {
  TENANT_CREATED: 'TENANT_CREATED',
  MEMBER_INVITED: 'MEMBER_INVITED',
  MEMBER_JOINED: 'MEMBER_JOINED',
  MEMBER_REMOVED: 'MEMBER_REMOVED',
  CUSTOMER_CREATED: 'CUSTOMER_CREATED',
  CUSTOMER_UPDATED: 'CUSTOMER_UPDATED',
  SITE_CREATED: 'SITE_CREATED',
  ASSET_INSTALLED: 'ASSET_INSTALLED',
  ASSET_UPDATED: 'ASSET_UPDATED',
  JOB_CREATED: 'JOB_CREATED',
  TECHNICIAN_ASSIGNED: 'TECHNICIAN_ASSIGNED',
  JOB_ACCEPTED: 'JOB_ACCEPTED',
  TECHNICIAN_ON_THE_WAY: 'TECHNICIAN_ON_THE_WAY',
  TECHNICIAN_ON_SITE: 'TECHNICIAN_ON_SITE',
  JOB_STARTED: 'JOB_STARTED',
  PART_REQUIRED: 'PART_REQUIRED',
  RETURN_VISIT_REQUIRED: 'RETURN_VISIT_REQUIRED',
  JOB_COMPLETED: 'JOB_COMPLETED',
  JOB_CANCELLED: 'JOB_CANCELLED',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export type ActorType = 'ACCOUNT' | 'CUSTOMER' | 'SYSTEM';

export interface NewEvent {
  tenantId: number;
  eventType: EventType;
  actorType: ActorType;
  actorId?: string;
  subjectType?: string;
  subjectId?: string;
  metadata?: Record<string, unknown>;
  jobId?: number | null;
  assetId?: number | null;
  customerId?: number | null;
}

/** Any client that can insert events: raw, tenant-scoped, or a transaction of either. */
export interface EventDb {
  domainEvent: { create(args: { data: Prisma.DomainEventUncheckedCreateInput }): PromiseLike<unknown> };
}

/** Append-only: there is intentionally no update/delete helper for events. */
export function appendEvent(db: EventDb, e: NewEvent) {
  return db.domainEvent.create({
    data: {
      tenantId: e.tenantId,
      eventType: e.eventType,
      actorType: e.actorType,
      actorId: e.actorId,
      subjectType: e.subjectType,
      subjectId: e.subjectId,
      metadataJson: JSON.stringify(e.metadata ?? {}),
      jobId: e.jobId ?? null,
      assetId: e.assetId ?? null,
      customerId: e.customerId ?? null,
    },
  });
}
