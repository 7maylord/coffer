-- A policy digest identifies immutable content, not a one-time action. Reusing
-- a prior policy creates a new version so proposals still bind exact history.
DROP INDEX "PolicyDefinition_organizationId_digest_key";
