-- CampusBus fee/payment upgrade
ALTER TABLE "Fee" ADD COLUMN "baseAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Fee" ADD COLUMN "discountAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Fee" ADD COLUMN "adjustmentAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN "refundedAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "refundReason" TEXT;

-- SQLite requires recreating enum-backed constraints only if present.
-- Prisma stores enums as TEXT in SQLite, so REFUNDED needs no ALTER TYPE.
