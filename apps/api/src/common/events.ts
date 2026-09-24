import { Prisma } from '@prisma/client';

export const EventType = {
  TENANT_CREATED: 'TENANT_CREATED',
  MEMBER_INVITED: 'MEMBER_INVITED',
  MEMBER_JOINED: 'MEMBER_JOINED',
  MEMBER_REMOVED: 'MEMBER_REMOVED',
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
    },
  });
}
