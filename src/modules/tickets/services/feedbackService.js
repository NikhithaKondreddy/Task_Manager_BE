const HttpError = require('../../../errors/HttpError');
const auditLogger = require('../../../services/auditLogger');
const { query } = require('../repositories/mysql');
const ticketService = require('./ticketService');
const { normalizeTicketRoleKey } = require('../helpers/ticketUtils');
const { TICKET_ROLE_KEYS } = require('../constants');

function normalizeRating(value) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpError(400, 'rating must be an integer from 1 to 5', 'FEEDBACK_RATING_INVALID');
  }
  return rating;
}

function mapFeedback(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id || null,
    ticketId: row.ticket_public_id || row.ticket_id,
    ticketInternalId: row.ticket_id,
    userId: row.user_public_id || row.user_id,
    userInternalId: row.user_id || null,
    userName: row.user_name || null,
    rating: Number(row.rating),
    feedback: row.comment || null,
    comment: row.comment || null,
    status: row.status || 'ACTIVE',
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
  };
}

function canListAllFeedback(user) {
  const role = normalizeTicketRoleKey(user?.role);
  return [
    TICKET_ROLE_KEYS.SUPER_ADMIN,
    TICKET_ROLE_KEYS.CENTRAL_IT_ADMIN,
    TICKET_ROLE_KEYS.REGIONAL_IT_MANAGER,
    TICKET_ROLE_KEYS.L2_ENGINEER,
  ].includes(role);
}

async function listFeedback(user, filters = {}) {
  const where = ["COALESCE(f.status, 'ACTIVE') <> 'INACTIVE'"];
  const params = [];

  if (user?.tenant_id) {
    where.push('(f.tenant_id = ? OR f.tenant_id IS NULL)');
    params.push(user.tenant_id);
  }

  if (!canListAllFeedback(user)) {
    where.push('f.user_id = ?');
    params.push(user._id);
  }

  if (filters.ticketId || filters.ticket_id) {
    where.push('(t.ticket_id = ? OR CAST(f.ticket_id AS CHAR) = ?)');
    params.push(String(filters.ticketId || filters.ticket_id), String(filters.ticketId || filters.ticket_id));
  }

  if (filters.rating) {
    where.push('f.rating = ?');
    params.push(normalizeRating(filters.rating));
  }

  const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
  const offset = Math.max(Number(filters.offset || 0), 0);

  const rows = await query(
    `
      SELECT
        f.*,
        t.ticket_id AS ticket_public_id,
        u.public_id AS user_public_id,
        u.name AS user_name
      FROM feedback f
      LEFT JOIN tickets t ON t.id = f.ticket_id
      LEFT JOIN users u ON u._id = f.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT ? OFFSET ?
    `,
    params.concat([limit, offset])
  );

  const totalRows = await query(
    `
      SELECT COUNT(*) AS total
      FROM feedback f
      LEFT JOIN tickets t ON t.id = f.ticket_id
      WHERE ${where.join(' AND ')}
    `,
    params
  );

  return {
    items: rows.map(mapFeedback),
    total: Number(totalRows[0]?.total || 0),
    limit,
    offset,
  };
}

async function getFeedbackById(user, feedbackId) {
  const rows = await query(
    `
      SELECT
        f.*,
        t.ticket_id AS ticket_public_id,
        u.public_id AS user_public_id,
        u.name AS user_name
      FROM feedback f
      LEFT JOIN tickets t ON t.id = f.ticket_id
      LEFT JOIN users u ON u._id = f.user_id
      WHERE f.id = ?
        AND (f.tenant_id = ? OR f.tenant_id IS NULL)
        AND COALESCE(f.status, 'ACTIVE') <> 'INACTIVE'
      LIMIT 1
    `,
    [feedbackId, user.tenant_id]
  );

  const row = rows[0];
  if (!row) throw new HttpError(404, 'Feedback not found', 'FEEDBACK_NOT_FOUND');
  if (!canListAllFeedback(user) && Number(row.user_id) !== Number(user._id)) {
    throw new HttpError(403, 'Not allowed to view this feedback', 'FEEDBACK_FORBIDDEN');
  }
  return mapFeedback(row);
}

async function getFeedbackForTicket(ticketId, user) {
  const ticket = await ticketService.getTicket(ticketId, user);
  const rows = await query(
    `
      SELECT
        f.*,
        ? AS ticket_public_id,
        u.public_id AS user_public_id,
        u.name AS user_name
      FROM feedback f
      LEFT JOIN users u ON u._id = f.user_id
      WHERE f.ticket_id = ?
        AND (f.tenant_id = ? OR f.tenant_id IS NULL)
        AND COALESCE(f.status, 'ACTIVE') <> 'INACTIVE'
      ORDER BY f.created_at DESC, f.id DESC
    `,
    [ticket.ticketId, ticket.id, user.tenant_id]
  );

  if (canListAllFeedback(user)) return rows.map(mapFeedback);
  return rows.filter((row) => Number(row.user_id) === Number(user._id)).map(mapFeedback);
}

async function submitFeedback(ticketId, payload, user) {
  const ticket = await ticketService.getTicket(ticketId, user);
  const ticketStatus = String(ticket.status || '').toUpperCase();
  if (!['RESOLVED', 'CLOSED'].includes(ticketStatus)) {
    throw new HttpError(400, 'Feedback can be submitted only after ticket resolution', 'FEEDBACK_TICKET_NOT_RESOLVED');
  }

  // Only the original requester (or explicitly requested-for user) may submit feedback
  const isRequester = Number(ticket.requester_user_id) === Number(user._id) || Number(ticket.requested_for_user_id) === Number(user._id) || Number(ticket.created_by_user_id) === Number(user._id);
  if (!isRequester) {
    throw new HttpError(403, 'Only the ticket requester can submit feedback', 'FEEDBACK_FORBIDDEN');
  }

  const rating = normalizeRating(payload.rating);
  const comment = payload.feedback !== undefined
    ? String(payload.feedback || '').trim()
    : String(payload.comment || payload.comments || '').trim();

  const existingRows = await query(
    `
      SELECT id, rating, comment, status
      FROM feedback
      WHERE ticket_id = ?
        AND user_id = ?
        AND (tenant_id = ? OR tenant_id IS NULL)
      ORDER BY id DESC
      LIMIT 1
    `,
    [ticket.id, user._id, user.tenant_id]
  );

  let feedbackId;
  if (existingRows.length) {
    feedbackId = existingRows[0].id;
    await query(
      `
        UPDATE feedback
        SET rating = ?, comment = ?, status = 'ACTIVE', tenant_id = ?, updated_at = NOW()
        WHERE id = ?
      `,
      [rating, comment || null, user.tenant_id, feedbackId]
    );
  } else {
    const result = await query(
      `
        INSERT INTO feedback (tenant_id, ticket_id, user_id, rating, comment, status)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE')
      `,
      [user.tenant_id, ticket.id, user._id, rating, comment || null]
    );
    feedbackId = result.insertId;
  }

  await auditLogger.logAudit({
    action: existingRows.length ? 'TICKET_FEEDBACK_UPDATED' : 'TICKET_FEEDBACK_CREATED',
    tenant_id: user.tenant_id,
    actor_id: user._id,
    entity: 'Ticket',
    entity_id: ticket.ticketId,
    module: 'Ticketing',
    details: { feedbackId, rating },
    previous_value: existingRows[0] || null,
    new_value: { rating, comment: comment || null },
  });

  return getFeedbackById(user, feedbackId);
}

async function updateFeedback(feedbackId, payload, user) {
  const existing = await getFeedbackById(user, feedbackId);
  const rating = payload.rating !== undefined ? normalizeRating(payload.rating) : existing.rating;
  const comment = payload.feedback !== undefined
    ? String(payload.feedback || '').trim()
    : (payload.comment !== undefined ? String(payload.comment || '').trim() : existing.comment);

  await query(
    'UPDATE feedback SET rating = ?, comment = ?, updated_at = NOW() WHERE id = ?',
    [rating, comment || null, feedbackId]
  );

  await auditLogger.logAudit({
    action: 'TICKET_FEEDBACK_UPDATED',
    tenant_id: user.tenant_id,
    actor_id: user._id,
    entity: 'Feedback',
    entity_id: String(feedbackId),
    module: 'Ticketing',
    previous_value: existing,
    new_value: { ...existing, rating, comment: comment || null },
  });

  return getFeedbackById(user, feedbackId);
}

async function deleteFeedback(feedbackId, user) {
  const existing = await getFeedbackById(user, feedbackId);
  await query("UPDATE feedback SET status = 'INACTIVE', updated_at = NOW() WHERE id = ?", [feedbackId]);
  await auditLogger.logAudit({
    action: 'TICKET_FEEDBACK_DELETED',
    tenant_id: user.tenant_id,
    actor_id: user._id,
    entity: 'Feedback',
    entity_id: String(feedbackId),
    module: 'Ticketing',
    details: { softDelete: true },
    previous_value: existing,
  });
  return { id: Number(feedbackId), deleted: true, softDeleted: true, status: 'INACTIVE' };
}

module.exports = {
  listFeedback,
  getFeedbackById,
  getFeedbackForTicket,
  submitFeedback,
  updateFeedback,
  deleteFeedback,
};
