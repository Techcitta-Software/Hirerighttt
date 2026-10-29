import {describe,it,expect} from 'vitest';
import {inviteAccessFromStored} from './interviewInviteGate';
const start = Date.parse('2026-11-01T08:30:00Z');
const invite = {scheduledStart:new Date(start).toISOString(), scheduledEnd:new Date(start+300000).toISOString()};
describe('live invite timing',()=>{
  it('uses the server offset when the device is ten minutes fast',()=>{
    expect(inviteAccessFromStored({...invite,serverOffsetMs:-600000},start+600000)?.canStart).toBe(true);
    expect(inviteAccessFromStored({...invite,serverOffsetMs:-600000},start+599000)?.status).toBe('too_early');
  });
  it('closes exactly at the deadline and blocks invalid schedules',()=>{
    expect(inviteAccessFromStored(invite,start+300000)?.status).toBe('expired');
    expect(inviteAccessFromStored({...invite,scheduledEnd:invite.scheduledStart},start)?.canStart).toBe(false);
    expect(inviteAccessFromStored({...invite,scheduledStart:'bad'},start)?.canStart).toBe(false);
  });
});
