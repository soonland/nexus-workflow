-- CreateEnum
CREATE TYPE "ExpenseReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED_MANAGER', 'APPROVED_ACCOUNTING', 'REJECTED', 'REIMBURSED');

-- CreateEnum
CREATE TYPE "ExpenseLineItemCategory" AS ENUM ('TRAVEL', 'MEALS', 'EQUIPMENT', 'OTHER');

-- CreateTable
CREATE TABLE "expense_reports" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "status" "ExpenseReportStatus" NOT NULL DEFAULT 'DRAFT',
    "workflow_instance_id" TEXT,
    "receipt_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_line_items" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "category" "ExpenseLineItemCategory" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_reports_employee_id_idx" ON "expense_reports"("employee_id");

-- CreateIndex
CREATE INDEX "expense_reports_status_idx" ON "expense_reports"("status");

-- CreateIndex
CREATE INDEX "expense_reports_workflow_instance_id_idx" ON "expense_reports"("workflow_instance_id");

-- CreateIndex
CREATE INDEX "expense_line_items_report_id_idx" ON "expense_line_items"("report_id");

-- AddForeignKey
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_line_items" ADD CONSTRAINT "expense_line_items_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "expense_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
