import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAppOrigin} from '../mail.mjs';
import {buildInterviewInviteEmail, inviteAccessState, validateInviteStart} from '../interviewInvites.mjs';
const start = '2026-11-01T08:30:00.000Z';
const end = '2026-11-01T08:35:00.000Z';
const row = {candidate_email:'candidate@example.com', scheduled_start:start, scheduled_end:end};
test('production email URLs require a usable public HTTPS app origin', () => {
  assert.equal(publicAppOrigin({NODE_ENV:'production', PUBLIC_APP_URL:'https://app.example.com/'}), 'https://app.example.com');
  assert.equal(publicAppOrigin({NODE_ENV:'production', CORS_ORIGINS:'http://localhost:5173, https://app.example.com/'}), 'https://app.example.com');
  for (const origin of ['http://localhost:5173', 'https://localhost', 'javascript:alert(1)', 'https://app.example.com/login', 'https://app.example.com/?token=test']) assert.throws(() => publicAppOrigin({NODE_ENV:'production', PUBLIC_APP_URL:origin}));
  assert.throws(() => publicAppOrigin({NODE_ENV:'production'}));
  assert.equal(publicAppOrigin({NODE_ENV:'development'}), 'http://localhost:5173');
});
test('invite email uses booked duration, actual join deadline and escapes dynamic HTML', () => {
  const mail = buildInterviewInviteEmail({candidateName:'<img src=x>', jobTitle:'R&D <Engineer>', scheduledStart:start, scheduledEnd:end, durationMinutes:45, inviteUrl:'https://app.example.com/interview/invite/test?x=1&y=2'});
  assert.match(mail.html, /45-minute/);
  assert.match(mail.text, /Duration: ~45 minutes/);
  assert.match(mail.text, /02:05 pm IST/i);
  assert.match(mail.html, /&lt;img src=x&gt;/);
  assert.match(mail.html, /R&amp;D &lt;Engineer&gt;/);
  assert.match(mail.html, /x=1&amp;y=2/);
  assert.ok(!mail.html.includes('during onboarding'));
  assert.throws(() => buildInterviewInviteEmail({scheduledStart:'bad',inviteUrl:'https://app.example.com'}));
  assert.throws(() => buildInterviewInviteEmail({scheduledStart:start,inviteUrl:'javascript:alert(1)'}));
});
test('invitation opens at the start and closes exactly at the deadline', () => {
  assert.equal(inviteAccessState(row, new Date('2026-11-01T08:29:59Z')).status, 'too_early');
  assert.equal(inviteAccessState(row, new Date(start)).canStart, true);
  assert.equal(inviteAccessState(row, new Date('2026-11-01T08:34:59Z')).canStart, true);
  assert.equal(inviteAccessState(row, new Date(end)).status, 'expired');
  for(const invalid of [{...row,scheduled_start:'bad'},{...row,scheduled_end:start},{...row,scheduled_end:'2020-01-01'}]) assert.equal(inviteAccessState(invalid).canStart, false);
});
test('server start checks the recipient and join window', () => {
  assert.equal(validateInviteStart(row, 'Candidate@Example.com', new Date(start)).ok, true);
  assert.equal(validateInviteStart(row, 'someoneelse@example.com', new Date(start)).status, 403);
  assert.equal(validateInviteStart(row, row.candidate_email, new Date('2026-11-01T08:29:00Z')).status, 409);
  assert.equal(validateInviteStart(row, row.candidate_email, new Date(end)).status, 410);
  assert.equal(validateInviteStart(null, row.candidate_email).status, 404);
});
