-- One-time cleanup, asked for by the master admin on October 12, 2026: the
-- 50/50 raffle pages had just launched, and the entries under the audit log's
-- "50/50 Raffles" tab so far came from trying them out.
--
-- Removes the raffle entries and nothing else. No other category of the audit
-- log is touched, and the raffles themselves — buyers, boxes, payments, the
-- winner — are not changed. Anything done on a raffle after this runs is
-- logged as usual.
DELETE FROM "AuditLog" WHERE "category" = 'raffle';
