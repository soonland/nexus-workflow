-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- AlterTable: add department_id column (nullable)
ALTER TABLE "employees" ADD COLUMN "department_id" TEXT;

-- DataMigration: create departments from existing string values
INSERT INTO "departments" ("id", "name", "created_at", "updated_at")
SELECT gen_random_uuid(), department, NOW(), NOW()
FROM "employees"
WHERE department IS NOT NULL
GROUP BY department
ON CONFLICT DO NOTHING;

-- DataMigration: link employees to their new department records
UPDATE "employees" e
SET "department_id" = d.id
FROM "departments" d
WHERE e.department = d.name;

-- AlterTable: drop the old string column
ALTER TABLE "employees" DROP COLUMN "department";

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
