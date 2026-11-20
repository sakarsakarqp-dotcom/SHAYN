-- SHAYN migration 007: multi-role personal accounts and organization membership foundation.
-- Additive only: existing users/listings/orders are preserved. No role is inferred for existing users.
BEGIN;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL
    CHECK (role IN ('job_seeker','employer','freelancer','service_provider','seller','buyer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role)
);
CREATE INDEX IF NOT EXISTS user_roles_role_created_idx
  ON user_roles(role, created_at DESC);

CREATE TABLE IF NOT EXISTS organizations (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(160) NOT NULL UNIQUE
    CHECK (slug = LOWER(slug) AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind VARCHAR(32) NOT NULL DEFAULT 'company'
    CHECK (kind IN ('company','ngo','public_entity','store','team','other')),
  description TEXT,
  country_code CHAR(2) NOT NULL DEFAULT 'SY'
    CHECK (country_code = UPPER(country_code)),
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','suspended','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS organizations_owner_created_idx
  ON organizations(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS organizations_status_created_idx
  ON organizations(status, created_at DESC);

CREATE TABLE IF NOT EXISTS organization_memberships (
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL
    CHECK (role IN ('owner','admin','recruiter','project_manager','commerce_manager','member')),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited','active','suspended','removed')),
  invited_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS organization_memberships_user_status_idx
  ON organization_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS organization_memberships_org_role_idx
  ON organization_memberships(organization_id, role, status);

CREATE TABLE IF NOT EXISTS organization_invitations (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL CHECK (email = LOWER(email)),
  role VARCHAR(32) NOT NULL
    CHECK (role IN ('admin','recruiter','project_manager','commerce_manager','member')),
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','revoked','expired')),
  invited_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accepted_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS organization_invitations_org_status_idx
  ON organization_invitations(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS organization_invitations_email_status_idx
  ON organization_invitations(email, status);

CREATE TABLE IF NOT EXISTS organization_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  target_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS organization_audit_logs_org_created_idx
  ON organization_audit_logs(organization_id, created_at DESC);

COMMIT;
