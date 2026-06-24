/**
 * tenantId.js — Tenant public-ID utility
 *
 * The `tenants` table stores two identifiers:
 *   - id (INT): internal FK used across all join tables (users.tenant_id, etc.)
 *   - public_id (VARCHAR 64): UUID-based string exposed to clients/frontend
 *
 * This module:
 *   1. Generates UUID v4 public IDs for new tenants.
 *   2. Resolves a tenant's public_id from its numeric INT id (with in-process cache).
 *   3. Upgrades legacy non-UUID public_ids (e.g. 'tenant_default') to real UUIDs.
 */

const crypto = require('crypto');
const db = require('../db');

// --- UUID v4 generator (no external dependency) ---

/**
 * Generate a RFC 4122 UUID v4 string.
 * Uses crypto.randomUUID() when available (Node ≥ 14.17), falls back to
 * crypto.randomBytes otherwise.
 *
 * @returns {string}  e.g. "a3bb189e-8bf9-3888-9912-ace4e6543002"
 */
function generateTenantPublicId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: construct RFC 4122 v4 UUID manually
  const buf = crypto.randomBytes(16);
  buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
  buf[8] = (buf[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = buf.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}

// --- In-process cache: intId (string) -> publicId ---
const _cache = new Map();

/**
 * Resolve the tenant public_id for a given numeric tenant_id.
 * Returns the public_id string, or falls back to String(tenantIntId) when
 * the tenant row is missing so callers always get a usable string.
 *
 * Results are cached for the lifetime of the process.
 *
 * @param {number|string|null} tenantIntId
 * @returns {Promise<string|null>}
 */
async function resolveTenantPublicId(tenantIntId) {
  if (tenantIntId === undefined || tenantIntId === null || tenantIntId === '') return null;
  const key = String(tenantIntId);
  if (_cache.has(key)) return _cache.get(key);

  return new Promise((resolve) => {
    db.query(
      'SELECT public_id FROM tenants WHERE id = ? LIMIT 1',
      [tenantIntId],
      (err, rows) => {
        if (err || !rows || !rows.length || !rows[0].public_id) {
          // Fall back gracefully — return the numeric id as string
          _cache.set(key, key);
          return resolve(key);
        }
        const publicId = rows[0].public_id;
        _cache.set(key, publicId);
        resolve(publicId);
      }
    );
  });
}

/**
 * Ensure the tenant row for `tenantIntId` has a proper UUID public_id.
 * If the current public_id is the legacy placeholder value ('tenant_default'
 * or any non-UUID string), it is upgraded to a freshly generated UUID.
 *
 * Should be called once during server bootstrap.
 *
 * @param {number} tenantIntId
 * @returns {Promise<string>}  The (possibly newly generated) public_id
 */
async function ensureTenantPublicId(tenantIntId) {
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return new Promise((resolve) => {
    db.query(
      'SELECT id, public_id FROM tenants WHERE id = ? LIMIT 1',
      [tenantIntId],
      (err, rows) => {
        if (err || !rows || !rows.length) {
          return resolve(String(tenantIntId));
        }
        const row = rows[0];
        const current = row.public_id || '';

        // Already a valid UUID — nothing to do
        if (UUID_PATTERN.test(current)) {
          _cache.set(String(tenantIntId), current);
          return resolve(current);
        }

        // Upgrade legacy placeholder to UUID
        const newUuid = generateTenantPublicId();
        db.query(
          'UPDATE tenants SET public_id = ? WHERE id = ?',
          [newUuid, tenantIntId],
          (uErr) => {
            if (uErr) {
              // Keep the old value rather than break anything
              _cache.set(String(tenantIntId), current || String(tenantIntId));
              return resolve(current || String(tenantIntId));
            }
            _cache.set(String(tenantIntId), newUuid);
            resolve(newUuid);
          }
        );
      }
    );
  });
}

/**
 * Invalidate the cached public_id for the given numeric tenant id.
 * Call after any UPDATE to `tenants.public_id`.
 *
 * @param {number|string} tenantIntId
 */
function invalidateTenantCache(tenantIntId) {
  if (tenantIntId !== null && tenantIntId !== undefined) {
    _cache.delete(String(tenantIntId));
  }
}

module.exports = {
  generateTenantPublicId,
  resolveTenantPublicId,
  ensureTenantPublicId,
  invalidateTenantCache
};
