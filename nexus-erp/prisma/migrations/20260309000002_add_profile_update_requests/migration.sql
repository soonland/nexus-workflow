-- CreateEnum
CREATE TYPE "employee_profile_update_request_status" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED');

-- CreateTable
CREATE TABLE "employee_profile_update_requests" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "phone" TEXT,
    "street" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country" TEXT,
    "status" "employee_profile_update_request_status" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "resolved_by_id" TEXT,
    "workflow_instance_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_profile_update_requests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "employee_profile_update_requests"
    ADD CONSTRAINT "employee_profile_update_requests_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
