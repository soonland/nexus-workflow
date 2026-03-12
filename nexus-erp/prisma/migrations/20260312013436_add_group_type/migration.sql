-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('security', 'default');

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "type" "GroupType" NOT NULL DEFAULT 'security';
