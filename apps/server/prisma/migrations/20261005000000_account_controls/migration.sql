CREATE TABLE "auth_attempt_buckets" (
  "key" TEXT PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "resetAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "auth_attempt_buckets_resetAt_idx" ON "auth_attempt_buckets"("resetAt");
CREATE TABLE "password_recoveries" (
  "id" TEXT PRIMARY KEY,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3)
);
CREATE INDEX "password_recoveries_userId_idx" ON "password_recoveries"("userId");
