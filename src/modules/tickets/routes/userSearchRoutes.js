const express = require('express');
const { query: queryValidator } = require('express-validator');
const { validationResult } = require('express-validator');
const { asyncHandler } = require('../../../utils/asyncHandler');
const HttpError = require('../../../errors/HttpError');
const { query } = require('../repositories/mysql');
const { normalizeTicketRoleKey } = require('../helpers/ticketUtils');

const router = express.Router();

router.get(
  '/',
  [
    queryValidator('search').optional().isString().trim(),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new HttpError(400, 'Validation failed', 'VALIDATION_ERROR', errors.array());
    }

    const roleKey = normalizeTicketRoleKey(req.user?.role);
    if (!roleKey) {
      return next();
    }

    const search = String(req.query.search || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);
    const params = [req.user.tenant_id];
    let searchClause = '';

    if (search) {
      searchClause = `
        AND (
          u.name LIKE ?
          OR u.email LIKE ?
          OR COALESCE(u.title, '') LIKE ?
          OR COALESCE(u.public_id, '') LIKE ?
        )
      `;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    params.push(limit);

    const rows = await query(
      `
        SELECT
          u._id,
          u.public_id,
          u.name,
          u.email,
          u.role,
          u.title,
          u.department_public_id
        FROM users u
        WHERE u.tenant_id = ?
          AND COALESCE(u.isActive, 1) = 1
          ${searchClause}
        ORDER BY u.name ASC
        LIMIT ?
      `,
      params
    );

    res.json({
      success: true,
      message: 'Users fetched',
      data: rows.map((row) => ({
        id: row.public_id || row._id,
        internalId: row._id,
        publicId: row.public_id || null,
        name: row.name,
        email: row.email,
        role: row.role,
        title: row.title || null,
        departmentPublicId: row.department_public_id || null,
      })),
    });
  })
);

module.exports = router;
