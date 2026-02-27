-- No-op: updatedAt is added in 20260228000000_agent_enqueued_market_status.
-- This migration previously altered updatedAt here, which broke shadow DB replay (column did not exist yet).
SELECT 1;
