-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'DEVELOPER', 'AUDITOR', 'READONLY');

-- CreateEnum
CREATE TYPE "SyncTargetKind" AS ENUM ('LOCAL', 'CICD', 'KUBERNETES', 'TERRAFORM', 'SERVERLESS', 'VM');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SYNCED', 'DRIFTED', 'PENDING', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'enterprise',
    "activeKeyId" TEXT NOT NULL DEFAULT 'kek-v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'DEVELOPER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sensitivity" TEXT NOT NULL DEFAULT 'internal',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environments" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "protected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secrets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "valueType" TEXT NOT NULL DEFAULT 'string',
    "lastSyncedAt" TIMESTAMP(3),
    "rotationPolicyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secret_versions" (
    "id" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "wrappedDek" TEXT NOT NULL,
    "dekIv" TEXT NOT NULL,
    "dekAuthTag" TEXT NOT NULL,
    "keyId" TEXT NOT NULL DEFAULT 'kek-v1',
    "valueHash" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdById" TEXT,
    "createdVia" TEXT NOT NULL DEFAULT 'dashboard',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,

    CONSTRAINT "secret_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_targets" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SyncTargetKind" NOT NULL,
    "endpoint" TEXT NOT NULL,
    "pullMode" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" "SyncStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_states" (
    "id" TEXT NOT NULL,
    "syncTargetId" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'UNKNOWN',
    "observedVersion" INTEGER,
    "observedHash" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "syncTargetId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "secretsPushed" INTEGER NOT NULL DEFAULT 0,
    "secretsSkipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "log" JSONB,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rotation_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 90,
    "notifyBeforeDays" INTEGER NOT NULL DEFAULT 14,
    "mode" TEXT NOT NULL DEFAULT 'manual',
    "generator" TEXT NOT NULL DEFAULT 'base64:32',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rotation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rotation_events" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCEEDED',
    "reason" TEXT,
    "fromVersion" INTEGER,
    "toVersion" INTEGER,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rotation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "principal" TEXT,
    "environmentId" TEXT,
    "secretId" TEXT,
    "permission" TEXT NOT NULL DEFAULT 'READ',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "environmentId" TEXT,
    "secretId" TEXT,
    "requesterId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "permission" TEXT NOT NULL DEFAULT 'READ',
    "justification" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rule" TEXT NOT NULL,
    "config" JSONB,
    "severity" TEXT NOT NULL DEFAULT 'high',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "resourceLabel" TEXT,
    "environmentId" TEXT,
    "secretId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "access_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "principal" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "environmentIds" JSONB,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_organizationId_key" ON "memberships"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "projects_organizationId_idx" ON "projects"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organizationId_slug_key" ON "projects"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "environments_projectId_idx" ON "environments"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "environments_projectId_slug_key" ON "environments"("projectId", "slug");

-- CreateIndex
CREATE INDEX "secrets_projectId_environmentId_idx" ON "secrets"("projectId", "environmentId");

-- CreateIndex
CREATE INDEX "secrets_deletedAt_idx" ON "secrets"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "secrets_environmentId_path_key_key" ON "secrets"("environmentId", "path", "key");

-- CreateIndex
CREATE INDEX "secret_versions_secretId_idx" ON "secret_versions"("secretId");

-- CreateIndex
CREATE UNIQUE INDEX "secret_versions_secretId_version_key" ON "secret_versions"("secretId", "version");

-- CreateIndex
CREATE INDEX "sync_targets_environmentId_idx" ON "sync_targets"("environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "sync_states_syncTargetId_secretId_key" ON "sync_states"("syncTargetId", "secretId");

-- CreateIndex
CREATE INDEX "sync_runs_syncTargetId_startedAt_idx" ON "sync_runs"("syncTargetId", "startedAt");

-- CreateIndex
CREATE INDEX "rotation_events_secretId_idx" ON "rotation_events"("secretId");

-- CreateIndex
CREATE INDEX "grants_organizationId_idx" ON "grants"("organizationId");

-- CreateIndex
CREATE INDEX "grants_environmentId_idx" ON "grants"("environmentId");

-- CreateIndex
CREATE INDEX "access_requests_organizationId_status_idx" ON "access_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "access_events_organizationId_createdAt_idx" ON "access_events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "access_events_organizationId_seq_idx" ON "access_events"("organizationId", "seq");

-- CreateIndex
CREATE INDEX "access_events_secretId_idx" ON "access_events"("secretId");

-- CreateIndex
CREATE INDEX "access_events_actorId_idx" ON "access_events"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_organizationId_idx" ON "api_tokens"("organizationId");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "environments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_rotationPolicyId_fkey" FOREIGN KEY ("rotationPolicyId") REFERENCES "rotation_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secret_versions" ADD CONSTRAINT "secret_versions_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_targets" ADD CONSTRAINT "sync_targets_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_states" ADD CONSTRAINT "sync_states_syncTargetId_fkey" FOREIGN KEY ("syncTargetId") REFERENCES "sync_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_states" ADD CONSTRAINT "sync_states_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_syncTargetId_fkey" FOREIGN KEY ("syncTargetId") REFERENCES "sync_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_events" ADD CONSTRAINT "rotation_events_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "rotation_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grants" ADD CONSTRAINT "grants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grants" ADD CONSTRAINT "grants_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grants" ADD CONSTRAINT "grants_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
