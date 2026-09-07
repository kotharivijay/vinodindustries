-- Attendance from uploaded Petpooja "Daily Punch Report" xlsx
CREATE TABLE "AttendanceUpload" (
    "id" SERIAL NOT NULL,
    "fileName" TEXT NOT NULL,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "employeeCount" INTEGER NOT NULL,
    "dayCount" INTEGER NOT NULL,
    "problemCount" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "newEmployees" INTEGER NOT NULL DEFAULT 0,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceUpload_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendancePunchDay" (
    "id" SERIAL NOT NULL,
    "uploadId" INTEGER,
    "date" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "designation" TEXT,
    "punches" JSONB NOT NULL,
    "problem" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "AttendancePunchDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendancePunchDay_date_code_key" ON "AttendancePunchDay"("date", "code");
CREATE INDEX "AttendancePunchDay_date_idx" ON "AttendancePunchDay"("date");
CREATE INDEX "AttendancePunchDay_uploadId_idx" ON "AttendancePunchDay"("uploadId");

ALTER TABLE "AttendancePunchDay" ADD CONSTRAINT "AttendancePunchDay_uploadId_fkey"
    FOREIGN KEY ("uploadId") REFERENCES "AttendanceUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Employees added from a punch sheet have no Petpooja internal id
ALTER TABLE "AttendanceEmployee" ALTER COLUMN "petpoojaEmpId" DROP NOT NULL;
ALTER TABLE "AttendanceUpload" ADD COLUMN IF NOT EXISTS "newEmployees" INTEGER NOT NULL DEFAULT 0;
