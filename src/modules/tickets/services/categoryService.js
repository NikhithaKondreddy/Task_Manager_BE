const HttpError = require('../../../errors/HttpError');
const auditLogger = require('../../../services/auditLogger');
const { query, withTransaction } = require('../repositories/mysql');
const { slugifyCategoryCode } = require('../helpers/ticketUtils');

function mapCategories(rows = []) {
  const categories = new Map();
  rows.forEach((row) => {
    if (!categories.has(row.id)) {
      categories.set(row.id, {
        id: row.id,
        categoryName: row.category_name,
        categoryCode: row.category_code,
        description: row.description,
        status: row.status,
        subcategories: [],
      });
    }
    if (row.subcategory_id) {
      categories.get(row.id).subcategories.push({
        id: row.subcategory_id,
        name: row.subcategory_name,
        description: row.subcategory_description,
        status: row.subcategory_status,
      });
    }
  });
  return Array.from(categories.values());
}

async function listCategories(tenantId, filters = {}) {
  const params = [tenantId];
  const where = ['c.tenant_id = ?'];

  if (filters.status) {
    where.push('UPPER(c.status) = ?');
    params.push(String(filters.status).trim().toUpperCase());
  }

  const rows = await query(
    `
      SELECT
        c.id,
        c.category_name,
        c.category_code,
        c.description,
        c.status,
        s.id AS subcategory_id,
        s.subcategory_name,
        s.description AS subcategory_description,
        s.status AS subcategory_status
      FROM categories c
      LEFT JOIN subcategories s
        ON s.category_id = c.id
       AND s.tenant_id = c.tenant_id
      WHERE ${where.join(' AND ')}
      ORDER BY c.category_name ASC, s.subcategory_name ASC
    `,
    params
  );

  return mapCategories(rows);
}

async function getCategoryById(tenantId, categoryId) {
  const categories = await listCategories(tenantId);
  return categories.find((category) => Number(category.id) === Number(categoryId)) || null;
}

function normalizeSubcategories(subcategories = []) {
  return (Array.isArray(subcategories) ? subcategories : [])
    .map((subcategory) => ({
      id: subcategory.id ? Number(subcategory.id) : null,
      name: String(subcategory.name || subcategory.subcategoryName || '').trim(),
      description: subcategory.description ? String(subcategory.description).trim() : null,
      status: String(subcategory.status || 'ACTIVE').trim().toUpperCase(),
    }))
    .filter((subcategory) => subcategory.name);
}

async function createCategory(tenantId, payload, user) {
  const categoryName = String(payload.categoryName || payload.category_name || '').trim();
  if (!categoryName) {
    throw new HttpError(400, 'categoryName is required', 'CATEGORY_NAME_REQUIRED');
  }

  const categoryCode = slugifyCategoryCode(payload.categoryCode || payload.category_code || categoryName);
  const description = payload.description ? String(payload.description).trim() : null;
  const status = String(payload.status || 'ACTIVE').trim().toUpperCase();
  const subcategories = normalizeSubcategories(payload.subcategories);

  const duplicate = await query(
    `
      SELECT id
      FROM categories
      WHERE tenant_id = ?
        AND (category_name = ? OR category_code = ?)
      LIMIT 1
    `,
    [tenantId, categoryName, categoryCode]
  );

  if (duplicate.length) {
    throw new HttpError(409, 'Category already exists', 'CATEGORY_EXISTS');
  }

  const categoryId = await withTransaction(async (tx) => {
    const result = await tx.query(
      `
        INSERT INTO categories
          (tenant_id, category_name, category_code, description, status, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [tenantId, categoryName, categoryCode, description, status, user?._id || null, user?._id || null]
    );

    for (const subcategory of subcategories) {
      await tx.query(
        `
          INSERT INTO subcategories
            (tenant_id, category_id, subcategory_name, description, status, created_by, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          tenantId,
          result.insertId,
          subcategory.name,
          subcategory.description,
          subcategory.status,
          user?._id || null,
          user?._id || null,
        ]
      );
    }

    await auditLogger.logAudit({
      action: 'TICKET_CATEGORY_CREATED',
      tenant_id: tenantId,
      actor_id: user?._id || null,
      entity: 'Category',
      entity_id: String(result.insertId),
      module: 'Ticketing',
      details: { categoryName, categoryCode, subcategories: subcategories.map((item) => item.name) },
    });

    return result.insertId;
  });

  return getCategoryById(tenantId, categoryId);
}

async function updateCategory(tenantId, categoryId, payload, user) {
  const existing = await getCategoryById(tenantId, categoryId);
  if (!existing) {
    throw new HttpError(404, 'Category not found', 'CATEGORY_NOT_FOUND');
  }

  const categoryName = payload.categoryName || payload.category_name
    ? String(payload.categoryName || payload.category_name).trim()
    : existing.categoryName;
  const categoryCode = payload.categoryCode || payload.category_code
    ? slugifyCategoryCode(payload.categoryCode || payload.category_code)
    : existing.categoryCode;
  const description = payload.description !== undefined ? (payload.description ? String(payload.description).trim() : null) : existing.description;
  const status = payload.status ? String(payload.status).trim().toUpperCase() : existing.status;
  const subcategories = Array.isArray(payload.subcategories) ? normalizeSubcategories(payload.subcategories) : null;

  const duplicate = await query(
    `
      SELECT id
      FROM categories
      WHERE tenant_id = ?
        AND id <> ?
        AND (category_name = ? OR category_code = ?)
      LIMIT 1
    `,
    [tenantId, categoryId, categoryName, categoryCode]
  );

  if (duplicate.length) {
    throw new HttpError(409, 'Another category already uses that name or code', 'CATEGORY_DUPLICATE');
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `
        UPDATE categories
        SET category_name = ?, category_code = ?, description = ?, status = ?, updated_by = ?
        WHERE id = ? AND tenant_id = ?
      `,
      [categoryName, categoryCode, description, status, user?._id || null, categoryId, tenantId]
    );

    if (subcategories) {
      const existingSubcategories = await tx.query(
        `SELECT id FROM subcategories WHERE tenant_id = ? AND category_id = ?`,
        [tenantId, categoryId]
      );
      const existingIds = existingSubcategories.map((row) => Number(row.id));
      const incomingIds = subcategories.filter((row) => row.id).map((row) => Number(row.id));
      const removedIds = existingIds.filter((id) => !incomingIds.includes(id));

      if (removedIds.length) {
        const referenced = await tx.query(
          `
            SELECT COUNT(*) AS count
            FROM tickets
            WHERE tenant_id = ?
              AND subcategory_id IN (?)
          `,
          [tenantId, removedIds]
        );

        if (Number(referenced[0]?.count || 0) > 0) {
          throw new HttpError(409, 'Cannot remove a subcategory that is already used by tickets', 'SUBCATEGORY_IN_USE');
        }

        await tx.query(
          `DELETE FROM subcategories WHERE tenant_id = ? AND category_id = ? AND id IN (?)`,
          [tenantId, categoryId, removedIds]
        );
      }

      for (const subcategory of subcategories) {
        if (subcategory.id) {
          await tx.query(
            `
              UPDATE subcategories
              SET subcategory_name = ?, description = ?, status = ?, updated_by = ?
              WHERE id = ? AND category_id = ? AND tenant_id = ?
            `,
            [
              subcategory.name,
              subcategory.description,
              subcategory.status,
              user?._id || null,
              subcategory.id,
              categoryId,
              tenantId,
            ]
          );
        } else {
          await tx.query(
            `
              INSERT INTO subcategories
                (tenant_id, category_id, subcategory_name, description, status, created_by, updated_by)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
              tenantId,
              categoryId,
              subcategory.name,
              subcategory.description,
              subcategory.status,
              user?._id || null,
              user?._id || null,
            ]
          );
        }
      }
    }

    await auditLogger.logAudit({
      action: 'TICKET_CATEGORY_UPDATED',
      tenant_id: tenantId,
      actor_id: user?._id || null,
      entity: 'Category',
      entity_id: String(categoryId),
      module: 'Ticketing',
      details: { categoryName, categoryCode, status },
      previous_value: existing,
      new_value: { categoryName, categoryCode, description, status, subcategories: subcategories || existing.subcategories },
    });
  });

  return getCategoryById(tenantId, categoryId);
}

async function deleteCategory(tenantId, categoryId, user) {
  const existing = await getCategoryById(tenantId, categoryId);
  if (!existing) {
    throw new HttpError(404, 'Category not found', 'CATEGORY_NOT_FOUND');
  }

  const referenced = await query(
    `
      SELECT COUNT(*) AS count
      FROM tickets
      WHERE tenant_id = ?
        AND (category_id = ? OR subcategory_id IN (
          SELECT id FROM subcategories WHERE tenant_id = ? AND category_id = ?
        ))
    `,
    [tenantId, categoryId, tenantId, categoryId]
  );

  if (Number(referenced[0]?.count || 0) > 0) {
    throw new HttpError(409, 'Category is already in use by tickets', 'CATEGORY_IN_USE');
  }

  await query(`DELETE FROM categories WHERE tenant_id = ? AND id = ?`, [tenantId, categoryId]);

  await auditLogger.logAudit({
    action: 'TICKET_CATEGORY_DELETED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'Category',
    entity_id: String(categoryId),
    module: 'Ticketing',
    details: { categoryName: existing.categoryName },
    previous_value: existing,
  });

  return { id: Number(categoryId), deleted: true };
}

async function listSubcategories(tenantId, categoryId) {
  const rows = await query(
    `
      SELECT id, category_id, subcategory_name, description, status
      FROM subcategories
      WHERE tenant_id = ? AND category_id = ?
      ORDER BY subcategory_name ASC
    `,
    [tenantId, categoryId]
  );

  return rows.map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    name: row.subcategory_name,
    description: row.description,
    status: row.status,
  }));
}

async function createSubcategory(tenantId, payload, user) {
  const categoryId = payload.categoryId || payload.category_id;
  const name = String(payload.name || payload.subcategoryName || '').trim();
  if (!categoryId || !name) {
    throw new HttpError(400, 'categoryId and name are required', 'SUBCATEGORY_REQUIRED');
  }

  const duplicate = await query(
    `SELECT id FROM subcategories WHERE tenant_id = ? AND category_id = ? AND subcategory_name = ? LIMIT 1`,
    [tenantId, categoryId, name]
  );
  if (duplicate.length) throw new HttpError(409, 'Subcategory already exists', 'SUBCATEGORY_EXISTS');

  const description = payload.description ? String(payload.description).trim() : null;
  const status = String(payload.status || 'ACTIVE').trim().toUpperCase();

  const result = await query(
    `
      INSERT INTO subcategories
        (tenant_id, category_id, subcategory_name, description, status, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [tenantId, categoryId, name, description, status, user?._id || null, user?._id || null]
  );

  return { id: result.insertId, categoryId, name, description, status };
}

async function updateSubcategory(tenantId, subcategoryId, payload, user) {
  const rows = await query(
    `SELECT * FROM subcategories WHERE tenant_id = ? AND id = ? LIMIT 1`,
    [tenantId, subcategoryId]
  );
  const existing = rows[0];
  if (!existing) throw new HttpError(404, 'Subcategory not found', 'SUBCATEGORY_NOT_FOUND');

  const name = payload.name !== undefined ? String(payload.name).trim() : existing.subcategory_name;
  const description = payload.description !== undefined ? String(payload.description || '').trim() : existing.description;
  const status = payload.status !== undefined ? String(payload.status).trim().toUpperCase() : existing.status;

  await query(
    `
      UPDATE subcategories
      SET subcategory_name = ?, description = ?, status = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `,
    [name, description, status, user?._id || null, tenantId, subcategoryId]
  );

  return { id: Number(subcategoryId), categoryId: existing.category_id, name, description, status };
}

async function deleteSubcategory(tenantId, subcategoryId) {
  await query('DELETE FROM subcategories WHERE tenant_id = ? AND id = ?', [tenantId, subcategoryId]);
  return { id: Number(subcategoryId), deleted: true };
}

module.exports = {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  listSubcategories,
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
};
