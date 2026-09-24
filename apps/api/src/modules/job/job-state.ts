import { JobStatus, OPEN_JOB_STATUSES, Role } from '@serviceflow/shared';
import { EventType } from '../../common/events';

/**
 * The job workflow (req §13), kept deliberately small. Each command is one endpoint,
 * one status change and one event.
 */
export type JobCommand =
  | 'assign'
  | 'accept'
  | 'on-the-way'
  | 'arrive'
  | 'start'
  | 'need-part'
  | 'need-return'
  | 'complete'
  | 'cancel';

type Actor = 'office' | 'assignee' | 'assigneeOrManager';

interface CommandRule {
  from: JobStatus[];
  to: JobStatus;
  actor: Actor;
  event: EventType;
  /** Timestamp column set when the command runs. */
  stamp?: 'assignedAt' | 'acceptedAt' | 'onTheWayAt' | 'arrivedAt' | 'startedAt' | 'completedAt' | 'cancelledAt';
  /** Office roles may also run it from these statuses (e.g. closing a job fixed by phone). */
  managerFrom?: JobStatus[];
}

const S = JobStatus;
const ON_SITE_WORK = [S.ON_SITE, S.IN_PROGRESS];

export const JOB_COMMANDS: Record<JobCommand, CommandRule> = {
  assign: {
    from: [S.NEW, S.ASSIGNED, S.ACCEPTED, S.ON_THE_WAY, S.WAITING_PART, S.NEED_RETURN_VISIT],
    to: S.ASSIGNED,
    actor: 'office',
    event: EventType.TECHNICIAN_ASSIGNED,
    stamp: 'assignedAt',
  },
  accept: { from: [S.ASSIGNED], to: S.ACCEPTED, actor: 'assignee', event: EventType.JOB_ACCEPTED, stamp: 'acceptedAt' },
  'on-the-way': {
    from: [S.ACCEPTED],
    to: S.ON_THE_WAY,
    actor: 'assignee',
    event: EventType.TECHNICIAN_ON_THE_WAY,
    stamp: 'onTheWayAt',
  },
  arrive: {
    from: [S.ACCEPTED, S.ON_THE_WAY],
    to: S.ON_SITE,
    actor: 'assignee',
    event: EventType.TECHNICIAN_ON_SITE,
    stamp: 'arrivedAt',
  },
  start: { from: [S.ON_SITE], to: S.IN_PROGRESS, actor: 'assignee', event: EventType.JOB_STARTED, stamp: 'startedAt' },
  'need-part': { from: ON_SITE_WORK, to: S.WAITING_PART, actor: 'assignee', event: EventType.PART_REQUIRED },
  'need-return': {
    from: ON_SITE_WORK,
    to: S.NEED_RETURN_VISIT,
    actor: 'assignee',
    event: EventType.RETURN_VISIT_REQUIRED,
  },
  complete: {
    from: ON_SITE_WORK,
    to: S.COMPLETED,
    actor: 'assigneeOrManager',
    event: EventType.JOB_COMPLETED,
    stamp: 'completedAt',
    managerFrom: OPEN_JOB_STATUSES,
  },
  cancel: {
    from: OPEN_JOB_STATUSES,
    to: S.CANCELLED,
    actor: 'office',
    event: EventType.JOB_CANCELLED,
    stamp: 'cancelledAt',
  },
};

const OFFICE: string[] = [Role.OWNER, Role.ADMIN, Role.DISPATCHER];
const MANAGER: string[] = [Role.OWNER, Role.ADMIN];

export interface CommandContext {
  status: string;
  role: string;
  isAssignee: boolean;
}

/** Why a command is not allowed, or null when it is. */
export function commandBlocker(cmd: JobCommand, ctx: CommandContext): 'role' | 'status' | null {
  const rule = JOB_COMMANDS[cmd];
  const status = ctx.status as JobStatus;
  const isOffice = OFFICE.includes(ctx.role);
  const isManager = MANAGER.includes(ctx.role);

  switch (rule.actor) {
    case 'office':
      if (!isOffice) return 'role';
      return rule.from.includes(status) ? null : 'status';
    case 'assignee':
      if (!ctx.isAssignee) return 'role';
      return rule.from.includes(status) ? null : 'status';
    case 'assigneeOrManager':
      if (isManager && (rule.managerFrom ?? rule.from).includes(status)) return null;
      if (!ctx.isAssignee && !isManager) return 'role';
      return ctx.isAssignee && rule.from.includes(status) ? null : 'status';
  }
}

export function allowedCommands(ctx: CommandContext): JobCommand[] {
  return (Object.keys(JOB_COMMANDS) as JobCommand[]).filter((c) => commandBlocker(c, ctx) === null);
}
