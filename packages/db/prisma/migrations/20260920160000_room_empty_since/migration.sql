-- AlterTable
ALTER TABLE "Room" ADD COLUMN "emptySince" TIMESTAMP(3);

-- Existing sittings get a fresh quiet clock so we do not wipe a live table on deploy.
UPDATE "Room" SET "emptySince" = CURRENT_TIMESTAMP WHERE "emptySince" IS NULL;

-- CreateIndex
CREATE INDEX "Room_emptySince_idx" ON "Room"("emptySince");
