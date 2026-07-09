-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DEN');

-- CreateEnum
CREATE TYPE "Rank" AS ENUM ('LION', 'TIGER', 'WOLF', 'BEAR', 'WEBELOS', 'AOL');

-- CreateEnum
CREATE TYPE "AdventureType" AS ENUM ('REQUIRED', 'ELECTIVE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "denId" TEXT,
    "displayName" TEXT NOT NULL,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Den" (
    "id" TEXT NOT NULL,
    "rank" "Rank" NOT NULL,
    "scoutingYear" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Den_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scout" (
    "id" TEXT NOT NULL,
    "denId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adventure" (
    "id" TEXT NOT NULL,
    "rank" "Rank" NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AdventureType" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "Adventure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvancementRecord" (
    "id" TEXT NOT NULL,
    "scoutId" TEXT NOT NULL,
    "adventureId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvancementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Den_rank_scoutingYear_label_key" ON "Den"("rank", "scoutingYear", "label");

-- CreateIndex
CREATE UNIQUE INDEX "Adventure_rank_name_key" ON "Adventure"("rank", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AdvancementRecord_scoutId_adventureId_key" ON "AdvancementRecord"("scoutId", "adventureId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_denId_fkey" FOREIGN KEY ("denId") REFERENCES "Den"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scout" ADD CONSTRAINT "Scout_denId_fkey" FOREIGN KEY ("denId") REFERENCES "Den"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancementRecord" ADD CONSTRAINT "AdvancementRecord_scoutId_fkey" FOREIGN KEY ("scoutId") REFERENCES "Scout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancementRecord" ADD CONSTRAINT "AdvancementRecord_adventureId_fkey" FOREIGN KEY ("adventureId") REFERENCES "Adventure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
