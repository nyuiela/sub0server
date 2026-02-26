/*
  Warnings:

  - A unique constraint covering the columns `[questionId]` on the table `Market` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "questionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Market_questionId_key" ON "Market"("questionId");

-- CreateIndex
CREATE INDEX "Market_questionId_idx" ON "Market"("questionId");
