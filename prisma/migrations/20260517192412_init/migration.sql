-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_token" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "tax_id" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "fiscal_year_start_month" INTEGER NOT NULL DEFAULT 1,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "enable_departments" BOOLEAN NOT NULL DEFAULT false,
    "is_vat_registered" BOOLEAN NOT NULL DEFAULT false,
    "vat_registration_no" TEXT,
    "default_vat_rate_percent" DECIMAL(5,2) NOT NULL DEFAULT 7.00,
    "settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "phone" TEXT,
    "auth_provider" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_membership" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_access" (
    "id" UUID NOT NULL,
    "tenant_membership_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "user_branch_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "parent_dept_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_department_assignment" (
    "id" UUID NOT NULL,
    "tenant_membership_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "can_request_for" BOOLEAN NOT NULL DEFAULT false,
    "can_approve_for" BOOLEAN NOT NULL DEFAULT false,
    "can_receive_for" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_department_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_provider_providerAccountId_key" ON "account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "session_sessionToken_key" ON "session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_token_key" ON "verification_token"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_identifier_token_key" ON "verification_token"("identifier", "token");

-- CreateIndex
CREATE INDEX "branch_tenant_id_idx" ON "branch"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_membership_tenant_id_user_id_key" ON "tenant_membership"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_branch_access_tenant_membership_id_branch_id_key" ON "user_branch_access"("tenant_membership_id", "branch_id");

-- CreateIndex
CREATE INDEX "department_tenant_id_idx" ON "department"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_tenant_id_code_key" ON "department"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "user_department_assignment_tenant_membership_id_department__key" ON "user_department_assignment"("tenant_membership_id", "department_id");

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch" ADD CONSTRAINT "branch_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_tenant_membership_id_fkey" FOREIGN KEY ("tenant_membership_id") REFERENCES "tenant_membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_parent_dept_id_fkey" FOREIGN KEY ("parent_dept_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_department_assignment" ADD CONSTRAINT "user_department_assignment_tenant_membership_id_fkey" FOREIGN KEY ("tenant_membership_id") REFERENCES "tenant_membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_department_assignment" ADD CONSTRAINT "user_department_assignment_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
