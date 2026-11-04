-- NaviGuard Master2 manual fallback only.
-- Preferred command: npx prisma db push
ALTER TABLE "Route"
ADD COLUMN IF NOT EXISTS "speedLimitKmph" DOUBLE PRECISION NOT NULL DEFAULT 40;
