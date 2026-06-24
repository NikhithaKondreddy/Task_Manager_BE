const db = require(__root + 'db');
const express = require('express');
const router = express.Router();
const logger = require(__root + 'logger');
const crypto = require('crypto');
const { requireAuth, requireRole } = require(__root + 'middleware/roles');
const ruleEngine = require(__root + 'middleware/ruleEngine');
const RULES = require(__root + 'rules/ruleCodes');
const errorResponse = require(__root + 'utils/errorResponse');

require('dotenv').config();

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function hasColumn(table, column) {
  try {
    const rows = await q("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", [table, column]);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    return false;
  }
}


router.post('/', ruleEngine(RULES.SUBTASK_CREATE), requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    const { taskId, title, description, priority = 'Medium', assignedTo, estimatedHours } = req.body;

    if (!taskId || !title) {
      return res.status(400).json(errorResponse.badRequest('taskId and title are required', 'MISSING_REQUIRED_FIELD', null, 'title'));
    }

    const task = await q('SELECT * FROM tasks WHERE id = ? OR public_id = ? LIMIT 1', [taskId, taskId]);
    if (!task || task.length === 0) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    const parentTask = task[0];
    const publicId = crypto.randomBytes(8).toString('hex');
    const createdBy = req.user._id;

    if (!await hasColumn('subtasks', 'estimated_hours')) {
      try {
        await q('ALTER TABLE subtasks ADD COLUMN estimated_hours DECIMAL(8,2) NULL');
      } catch (e) {
      }
    }

    const estimatedExists = await hasColumn('subtasks', 'estimated_hours');
    const statusExists = await hasColumn('subtasks', 'status');

    const cols = ['public_id','task_id','project_id','department_id','title','description','priority','assigned_to'];
    const placeholders = cols.map(() => '?');
    const params = [publicId, parentTask.id, parentTask.project_id, parentTask.department_id, title, description || null, priority, assignedTo || null];

    if (estimatedExists) { cols.push('estimated_hours'); placeholders.push('?'); params.push(estimatedHours || null); }
    if (statusExists) { cols.push('status'); placeholders.push('?'); params.push('Open'); }

    cols.push('created_by'); placeholders.push('?'); params.push(createdBy);

    const seen = new Set();
    const dcols = [];
    const dparams = [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!seen.has(c)) { seen.add(c); dcols.push(c); dparams.push(params[i]); }
    }
    const subtaskSql = `INSERT INTO subtasks (${dcols.join(',')}) VALUES (${dcols.map(() => '?').join(',')})`;
    const result = await q(subtaskSql, dparams);
    const subtaskId = result.insertId;

    // Task activity logging commented out - table was dropped during cleanup
    // await q('INSERT INTO task_activity_logs (task_id, user_id, action, details) VALUES (?, ?, ?, ?)', [parentTask.id, createdBy, 'subtask_created', `Subtask "${title}" created`]);

    const subtask = await q('SELECT * FROM subtasks WHERE id = ? LIMIT 1', [subtaskId]);
    res.status(201).json({
      success: true,
      data: {
        ...subtask[0],
        id: subtask[0].public_id
      }
    });
  } catch (e) {
    logger.error('Create subtask error:', e.message);
    res.status(500).json(errorResponse.serverError('Failed to create subtask', 'SUBTASK_CREATION_ERROR', { details: e.message }));
  }
});


router.get('/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await q('SELECT * FROM tasks WHERE id = ? OR public_id = ? LIMIT 1', [taskId, taskId]);
    if (!task || task.length === 0) {
      return res.status(404).json(errorResponse.notFound('Task not found', 'TASK_NOT_FOUND'));
    }

    const hasAssignedTo = await hasColumn('subtasks', 'assigned_to');
    
    let subtasks;
    if (hasAssignedTo) {
      subtasks = await q(`
        SELECT st.*, u.name as assigned_user_name, u.public_id as assigned_user_id
        FROM subtasks st
        LEFT JOIN users u ON st.assigned_to = u._id
        WHERE st.task_id = ?
        ORDER BY st.created_at DESC
      `, [task[0].id]);
    } else {
      subtasks = await q(`
        SELECT st.*
        FROM subtasks st
        WHERE st.task_id = ?
        ORDER BY st.created_at DESC
      `, [task[0].id]);
    }

    const enriched = subtasks.map(st => ({
      ...st,
      id: st.public_id,
      assigned_user: st.assigned_user_name ? { id: st.assigned_user_id, name: st.assigned_user_name } : null
    }));

    res.json({ success: true, data: enriched });
  } catch (e) {
    logger.error('Get subtasks error:', e.message);
    res.status(500).json(errorResponse.serverError('Failed to retrieve subtasks', 'SUBTASK_FETCH_ERROR', { details: e.message }));
  }
});


router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const subtask = await q('SELECT * FROM subtasks WHERE id = ? OR public_id = ? LIMIT 1', [id, id]);

    if (!subtask || subtask.length === 0) {
      return res.status(404).json(errorResponse.notFound('Subtask not found', 'SUBTASK_NOT_FOUND'));
    }

    const st = subtask[0];

    const hasAssignedTo = await hasColumn('subtasks', 'assigned_to');
    let assignedUser = [];
    
    if (hasAssignedTo && st.assigned_to) {
      assignedUser = await q('SELECT _id as id, public_id, name FROM users WHERE _id = ? LIMIT 1', [st.assigned_to]);
    }

    res.json({
      success: true,
      data: {
        ...st,
        id: st.public_id,
        assigned_user: assignedUser.length > 0 ? { id: assignedUser[0].public_id, name: assignedUser[0].name } : null
      }
    });
  } catch (e) {
    logger.error('Get subtask error:', e.message);
    res.status(500).json(errorResponse.serverError('Failed to retrieve subtask', 'SUBTASK_FETCH_ERROR', { details: e.message }));
  }
});


router.put('/:id', ruleEngine(RULES.SUBTASK_UPDATE), requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, status, priority, assignedTo, estimatedHours, actualHours } = req.body;

    const subtask = await q('SELECT * FROM subtasks WHERE id = ? OR public_id = ? LIMIT 1', [id, id]);
    if (!subtask || subtask.length === 0) {
      return res.status(404).json(errorResponse.notFound('Subtask not found', 'SUBTASK_NOT_FOUND'));
    }

    const subtaskId = subtask[0].id;
    const updateFields = [];
    const params = [];

    if (title) { updateFields.push('title = ?'); params.push(title); }
    if (description) { updateFields.push('description = ?'); params.push(description); }
    if (status) { updateFields.push('status = ?'); params.push(status); }
    if (priority) { updateFields.push('priority = ?'); params.push(priority); }
    if (assignedTo) { updateFields.push('assigned_to = ?'); params.push(assignedTo); }
    if (estimatedHours) { updateFields.push('estimated_hours = ?'); params.push(estimatedHours); }
    if (actualHours) { updateFields.push('actual_hours = ?'); params.push(actualHours); }

    if (updateFields.length === 0) {
      return res.status(400).json(errorResponse.badRequest('No fields to update', 'NO_UPDATE_FIELDS'));
    }

    params.push(subtaskId);
    const sql = `UPDATE subtasks SET ${updateFields.join(', ')} WHERE id = ?`;
    await q(sql, params);

    // Task activity logging commented out - table was dropped during cleanup
    // await q('INSERT INTO task_activity_logs (task_id, user_id, action, details) VALUES (?, ?, ?, ?)', [subtask[0].task_id, req.user._id, 'subtask_updated', `Subtask updated: ${updateFields.join(', ')}`]);

    const updated = await q('SELECT * FROM subtasks WHERE id = ? LIMIT 1', [subtaskId]);
    res.json({
      success: true,
      data: {
        ...updated[0],
        id: updated[0].public_id
      }
    });
  } catch (e) {
    logger.error('Update subtask error:', e.message);
    res.status(500).json(errorResponse.serverError('Failed to update subtask', 'SUBTASK_UPDATE_ERROR', { details: e.message }));
  }
});


router.delete('/:id', ruleEngine(RULES.SUBTASK_DELETE), requireRole(['Admin', 'Manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const subtask = await q('SELECT * FROM subtasks WHERE id = ? OR public_id = ? LIMIT 1', [id, id]);

    if (!subtask || subtask.length === 0) {
      return res.status(404).json(errorResponse.notFound('Subtask not found', 'SUBTASK_NOT_FOUND'));
    }

    const subtaskId = subtask[0].id;
    const taskId = subtask[0].task_id;

    await q('DELETE FROM subtask_assignments WHERE subtask_id = ?', [subtaskId]);
    await q('DELETE FROM subtasks WHERE id = ?', [subtaskId]);
    // Task activity logging commented out - table was dropped during cleanup
    // await q('INSERT INTO task_activity_logs (task_id, user_id, action, details) VALUES (?, ?, ?, ?)', [taskId, req.user._id, 'subtask_deleted', 'Subtask deleted']);

    res.json({ success: true, message: 'Subtask deleted' });
  } catch (e) {
    logger.error('Delete subtask error:', e.message);
    res.status(500).json(errorResponse.serverError('Failed to delete subtask', 'SUBTASK_DELETE_ERROR', { details: e.message }));
  }
});

module.exports = router;
