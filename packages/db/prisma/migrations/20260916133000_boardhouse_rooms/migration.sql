-- Drop chat prototype tables
DROP TABLE IF EXISTS "Chat";
DROP TABLE IF EXISTS "Room";
DROP TABLE IF EXISTS "User";

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "hostKey" TEXT NOT NULL,
    "hostParticipantId" TEXT NOT NULL,
    "accessMode" TEXT NOT NULL,
    "name" TEXT,
    "formerSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_slug_key" ON "Room"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Room_hostKey_key" ON "Room"("hostKey");

-- CreateIndex
CREATE INDEX "Room_expiresAt_idx" ON "Room"("expiresAt");
