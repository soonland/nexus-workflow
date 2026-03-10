-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TimesheetStatus" ADD VALUE 'pending_manager_review';
ALTER TYPE "TimesheetStatus" ADD VALUE 'pending_hr_review';
ALTER TYPE "TimesheetStatus" ADD VALUE 'revision_requested';

-- AlterTable
ALTER TABLE "timesheets" ADD COLUMN     "rejection_reason" TEXT;
