CREATE TYPE "WorkloadReservationStatus" AS ENUM ('RESERVED', 'RELEASED', 'RECONCILED', 'ABANDONED');
CREATE TYPE "WorkloadMeasurementStatus" AS ENUM ('ESTIMATED', 'MEASURED', 'UNKNOWN');

CREATE TABLE "workload_reservations" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "reservationKey" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "reservedUnits" INTEGER NOT NULL,
  "actualUnits" INTEGER,
  "measurementStatus" "WorkloadMeasurementStatus" NOT NULL DEFAULT 'ESTIMATED',
  "status" "WorkloadReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "workload_reservations_reservedUnits_positive" CHECK ("reservedUnits" > 0),
  CONSTRAINT "workload_reservations_actualUnits_nonnegative" CHECK ("actualUnits" IS NULL OR "actualUnits" >= 0)
);

CREATE UNIQUE INDEX "workload_reservations_organizationId_reservationKey_key"
  ON "workload_reservations"("organizationId", "reservationKey");
CREATE INDEX "workload_reservations_organizationId_status_expiresAt_idx"
  ON "workload_reservations"("organizationId", "status", "expiresAt");
CREATE INDEX "workload_reservations_organizationId_createdAt_idx"
  ON "workload_reservations"("organizationId", "createdAt");
