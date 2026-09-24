import { describe, expect, it } from 'vitest';
import { allowedCommands, commandBlocker } from './job-state';

describe('job state machine', () => {
  it('walks the technician happy path', () => {
    const tech = { role: 'TECHNICIAN', isAssignee: true };
    expect(allowedCommands({ ...tech, status: 'ASSIGNED' })).toEqual(['accept']);
    expect(allowedCommands({ ...tech, status: 'ACCEPTED' })).toEqual(['on-the-way', 'arrive']);
    expect(allowedCommands({ ...tech, status: 'ON_THE_WAY' })).toEqual(['arrive']);
    expect(allowedCommands({ ...tech, status: 'ON_SITE' })).toEqual(['start', 'need-part', 'need-return', 'complete']);
    expect(allowedCommands({ ...tech, status: 'COMPLETED' })).toEqual([]);
  });

  it('only lets the assigned technician act', () => {
    expect(commandBlocker('accept', { role: 'TECHNICIAN', isAssignee: false, status: 'ASSIGNED' })).toBe('role');
    expect(commandBlocker('assign', { role: 'TECHNICIAN', isAssignee: true, status: 'NEW' })).toBe('role');
  });

  it('lets managers close any open job but not dispatchers', () => {
    expect(commandBlocker('complete', { role: 'OWNER', isAssignee: false, status: 'NEW' })).toBeNull();
    expect(commandBlocker('complete', { role: 'DISPATCHER', isAssignee: false, status: 'NEW' })).toBe('role');
    expect(commandBlocker('complete', { role: 'OWNER', isAssignee: false, status: 'COMPLETED' })).toBe('status');
  });

  it('re-assigns jobs that wait for parts or a return visit', () => {
    for (const status of ['WAITING_PART', 'NEED_RETURN_VISIT']) {
      expect(commandBlocker('assign', { role: 'DISPATCHER', isAssignee: false, status })).toBeNull();
    }
    expect(commandBlocker('assign', { role: 'ADMIN', isAssignee: false, status: 'COMPLETED' })).toBe('status');
  });
});
