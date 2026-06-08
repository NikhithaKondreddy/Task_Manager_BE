const { query } = require('../repositories/mysql');

async function searchTickets(tenantId, term) {
  const like = `%${String(term || '').trim()}%`;
  const rows = await query(
    `
      SELECT ticket_id, title, status, priority, requester_email
      FROM tickets
      WHERE tenant_id = ?
        AND (ticket_id LIKE ? OR title LIKE ? OR description LIKE ?)
      ORDER BY updated_at DESC
      LIMIT 50
    `,
    [tenantId, like, like, like]
  );
  return rows;
}

async function searchUsers(tenantId, term) {
  const like = `%${String(term || '').trim()}%`;
  return query(
    `
      SELECT _id, public_id, name, email, role
      FROM users
      WHERE tenant_id = ?
        AND (name LIKE ? OR email LIKE ? OR role LIKE ?)
      ORDER BY name ASC
      LIMIT 50
    `,
    [tenantId, like, like, like]
  );
}

async function searchCategories(tenantId, term) {
  const like = `%${String(term || '').trim()}%`;
  return query(
    `
      SELECT c.id, c.category_name, s.id AS subcategory_id, s.subcategory_name
      FROM categories c
      LEFT JOIN subcategories s ON s.category_id = c.id AND s.tenant_id = c.tenant_id
      WHERE c.tenant_id = ?
        AND (c.category_name LIKE ? OR c.category_code LIKE ? OR s.subcategory_name LIKE ?)
      ORDER BY c.category_name ASC, s.subcategory_name ASC
      LIMIT 50
    `,
    [tenantId, like, like, like]
  );
}

async function searchEngineers(tenantId, term) {
  const like = `%${String(term || '').trim()}%`;
  return query(
    `
      SELECT u._id, u.public_id, u.name, u.email, u.role
      FROM users u
      WHERE u.tenant_id = ?
        AND (u.name LIKE ? OR u.email LIKE ? OR u.role LIKE ?)
      ORDER BY u.name ASC
      LIMIT 50
    `,
    [tenantId, like, like, like]
  );
}

module.exports = {
  searchTickets,
  searchUsers,
  searchCategories,
  searchEngineers,
};
