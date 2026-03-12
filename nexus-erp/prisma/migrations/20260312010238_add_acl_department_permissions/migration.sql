-- CreateEnum
CREATE TYPE "PermissionType" AS ENUM ('crud', 'workflow');

-- AlterTable
ALTER TABLE "permissions" ADD COLUMN     "type" "PermissionType" NOT NULL DEFAULT 'workflow';

-- CreateTable
CREATE TABLE "department_permissions" (
    "department_id" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "department_permissions_pkey" PRIMARY KEY ("department_id","permission_key")
);

-- AddForeignKey
ALTER TABLE "department_permissions" ADD CONSTRAINT "department_permissions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_permissions" ADD CONSTRAINT "department_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE CASCADE ON UPDATE CASCADE;
