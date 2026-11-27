const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const base = process.env.API_BASE_URL || 'http://127.0.0.1:3000';

async function api(path, options = {}) {
  const response = await fetch(base + path, {
    method: options.method || 'GET',
    headers: {
      ...(options.token ? { authorization: 'Bearer ' + options.token } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  return { status: response.status, data };
}

test('multi-role and organization API enforces membership and platform boundaries', async () => {
  const suffix = randomUUID().replace(/-/g, '');
  const ownerEmail = 'owner-' + suffix + '@example.test';
  const memberEmail = 'member-' + suffix + '@example.test';
  const outsiderEmail = 'outsider-' + suffix + '@example.test';
  const password = 'Test-password-2026!';

  const anonymous = await api('/api/me/roles');
  assert.equal(anonymous.status, 401);

  const ownerRegistration = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Test Owner', email: ownerEmail, password }
  });
  assert.equal(ownerRegistration.status, 201);
  const ownerToken = ownerRegistration.data.token;
  assert.ok(ownerToken);

  const memberRegistration = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Test Member', email: memberEmail, password }
  });
  assert.equal(memberRegistration.status, 201);
  const memberToken = memberRegistration.data.token;
  assert.ok(memberToken);

  const outsiderRegistration = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Test Outsider', email: outsiderEmail, password }
  });
  assert.equal(outsiderRegistration.status, 201);
  const outsiderToken = outsiderRegistration.data.token;

  const forbiddenRole = await api('/api/me/roles', {
    method: 'PUT',
    token: ownerToken,
    body: { roles: ['super_admin'] }
  });
  assert.equal(forbiddenRole.status, 400);

  const roles = await api('/api/me/roles', {
    method: 'PUT',
    token: ownerToken,
    body: { roles: ['employer', 'buyer'] }
  });
  assert.equal(roles.status, 200);
  assert.deepEqual(new Set(roles.data.roles), new Set(['employer', 'buyer']));

  const rolesRead = await api('/api/me/roles', { token: ownerToken });
  assert.equal(rolesRead.status, 200);
  assert.deepEqual(new Set(rolesRead.data.roles.map(item => item.role)), new Set(['employer', 'buyer']));

  const missingRole = await api('/api/organizations', {
    method: 'POST',
    token: memberToken,
    body: {
      name: 'Should Not Be Created',
      slug: 'should-not-be-created-' + suffix,
      kind: 'company'
    }
  });
  assert.equal(missingRole.status, 403);

  const created = await api('/api/organizations', {
    method: 'POST',
    token: ownerToken,
    body: {
      name: 'Test Organization',
      slug: 'test-organization-' + suffix,
      kind: 'company',
      description: 'Organization API integration test',
      country_code: 'SY'
    }
  });
  assert.equal(created.status, 201);
  const organizationId = created.data.organization.id;
  assert.ok(organizationId);
  assert.equal(created.data.membership_role, 'owner');

  const ownerOrganizations = await api('/api/organizations', { token: ownerToken });
  assert.equal(ownerOrganizations.status, 200);
  assert.ok(ownerOrganizations.data.organizations.some(item => String(item.id) === String(organizationId)));

  const outsiderRead = await api('/api/organizations/' + organizationId, { token: outsiderToken });
  assert.equal(outsiderRead.status, 403);

  const invitation = await api('/api/organizations/' + organizationId + '/invitations', {
    method: 'POST',
    token: ownerToken,
    body: { email: memberEmail, role: 'recruiter' }
  });
  assert.equal(invitation.status, 201);
  assert.match(invitation.data.invite_token, /^[a-f0-9]{64}$/);
  assert.equal(invitation.data.delivery, 'manual');

  const wrongEmailAccept = await api('/api/organizations/invitations/accept', {
    method: 'POST',
    token: outsiderToken,
    body: { token: invitation.data.invite_token }
  });
  assert.equal(wrongEmailAccept.status, 403);

  const accepted = await api('/api/organizations/invitations/accept', {
    method: 'POST',
    token: memberToken,
    body: { token: invitation.data.invite_token }
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.role, 'recruiter');

  const members = await api('/api/organizations/' + organizationId + '/members', { token: ownerToken });
  assert.equal(members.status, 200);
  assert.equal(members.data.members.length, 2);
  assert.ok(members.data.members.some(item => item.email === memberEmail && item.role === 'recruiter'));

  const memberInvite = await api('/api/organizations/' + organizationId + '/invitations', {
    method: 'POST',
    token: memberToken,
    body: { email: outsiderEmail, role: 'member' }
  });
  assert.equal(memberInvite.status, 403);

  const audit = await api('/api/organizations/' + organizationId + '/audit', { token: ownerToken });
  assert.equal(audit.status, 200);
  assert.ok(audit.data.audit_logs.some(item => item.action === 'organization.created'));
  assert.ok(audit.data.audit_logs.some(item => item.action === 'organization.invitation.accepted'));

  const platformAdmin = await api('/api/admin/overview', { token: memberToken });
  assert.equal(platformAdmin.status, 403);
});
