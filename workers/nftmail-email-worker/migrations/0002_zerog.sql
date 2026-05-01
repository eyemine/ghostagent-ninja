-- 0G Storage archive state per agent
-- zerog_root_hash: 0G merkle root hash of the latest ECIES-encrypted archive bundle
-- zerog_archived_at: unix ms timestamp of last successful archive
ALTER TABLE agents ADD COLUMN zerog_root_hash TEXT;
ALTER TABLE agents ADD COLUMN zerog_archived_at INTEGER;
