-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locale" TEXT DEFAULT 'fr',
ADD COLUMN     "theme" TEXT DEFAULT 'system';
