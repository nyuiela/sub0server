/*
  Warnings:

  - Added the required column `tradeReason` to the `AgentReasoning` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AgentReasoning" ADD COLUMN     "tradeReason" TEXT NOT NULL;
