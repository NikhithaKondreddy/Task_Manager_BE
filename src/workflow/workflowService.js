
const db = require('../db');
const NotificationService = require('../services/notificationService');
let logger;
try { logger = require(global.__root + 'logger'); } catch (e) { try { logger = require('../logger'); } catch (e2) { logger = console; } }

const q = (sql, params = [], connection = db) => new Promise((resolve, reject) => {
    connection.query(sql, params, (err, results) => {
        if (err) return reject(err);
        resolve(results);
    });
});



const beginTransaction = () => new Promise((resolve, reject) => {
    db.getConnection((err, connection) => {
        if (err) return reject(err);
        connection.beginTransaction(err => {
            if (err) {
                connection.release();
                return reject(err);
            }
            resolve(connection);
        });
    });
});

const commitTransaction = (connection) => new Promise((resolve, reject) => {
    connection.commit(err => {
        if (err) return rollbackTransaction(connection).then(() => reject(err));
        connection.release();
        resolve();
    });
});

const rollbackTransaction = (connection) => new Promise((resolve, reject) => {
    connection.rollback(() => {
        connection.release();
        resolve(); // Resolve even on rollback to not throw another error
    });
});

const _columnCache = {};
const hasColumn = async (table, column) => {
    const key = `${table}::${column}`;
    if (_columnCache[key] !== undefined) return _columnCache[key];
    try {
        const rows = await q(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
        `, [table, column]);
        _columnCache[key] = Array.isArray(rows) && rows.length > 0;
        return _columnCache[key];
    } catch (e) {
        _columnCache[key] = false;
        return false;
    }
};

const normalizeDbStatus = (value) => String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, '_')
    .toUpperCase();

const isCompletedTaskStatus = (value) => normalizeDbStatus(value) === 'COMPLETED';

const ensureWorkflowTables = async () => {
    try {
        await q('SELECT 1 FROM workflow_requests LIMIT 1');
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146 || (e.message && e.message.includes("doesn't exist"))) {
            try {
                await q(`
                    CREATE TABLE IF NOT EXISTS workflow_requests (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        tenant_id INT NOT NULL,
                        entity_type VARCHAR(50) NOT NULL,
                        entity_id VARCHAR(100) NOT NULL,
                        project_id INT NULL,
                        requested_by_id INT NOT NULL,
                        approver_role VARCHAR(50) NULL,
                        approver_id INT NULL,
                        status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
                        from_state VARCHAR(50) NULL,
                        to_state VARCHAR(50) NOT NULL,
                        reason TEXT NULL,
                        processed_by_id INT NULL,
                        processed_at DATETIME NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        INDEX idx_wr_tenant_entity (tenant_id, entity_type, entity_id),
                        INDEX idx_wr_status (status),
                        INDEX idx_wr_requested_by (requested_by_id),
                        INDEX idx_wr_approver (approver_id)
                    )
                `);
                logger.info('Created workflow_requests table');
            } catch (createErr) {
                logger.warn('Failed to create workflow_requests table: ' + createErr.message);
            }
        }
    }

    // Workflow logs table creation commented out - table was dropped during cleanup
    // try {
    //     await q('SELECT 1 FROM workflow_logs LIMIT 1');
    // } catch (e) {
    //     if (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146 || (e.message && e.message.includes("doesn't exist"))) {
    //         try {
    //             await q(`
    //                 CREATE TABLE IF NOT EXISTS workflow_logs (
    //                     id INT AUTO_INCREMENT PRIMARY KEY,
    //                     request_id INT NOT NULL,
    //                     tenant_id INT NOT NULL,
    //                     entity_type VARCHAR(50) NOT NULL,
    //                     entity_id VARCHAR(100) NOT NULL,
    //                     action VARCHAR(50) NOT NULL,
    //                     from_state VARCHAR(50) NULL,
    //                     to_state VARCHAR(50) NULL,
    //                     user_id INT NOT NULL,
    //                     details JSON NULL,
    //                     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    //                     INDEX idx_wl_request (request_id),
    //                     INDEX idx_wl_tenant_entity (tenant_id, entity_type, entity_id),
    //                     INDEX idx_wl_user (user_id)
    //                 )
    //             `);
    //             logger.info('Created workflow_logs table');
    //         } catch (createErr) {
    //             logger.warn('Failed to create workflow_logs table: ' + createErr.message);
    //         }
    //     }
    // }

    try {
        await q('SELECT 1 FROM workflow LIMIT 1');
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146 || (e.message && e.message.includes("doesn't exist"))) {
            try {
                await q(`
                    CREATE TABLE IF NOT EXISTS workflow (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        tenant_id INT NOT NULL,
                        task_id INT NOT NULL,
                        user_id INT NOT NULL,
                        action VARCHAR(100) NOT NULL,
                        stage VARCHAR(50) NOT NULL,
                        comment TEXT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        INDEX idx_workflow_task (task_id),
                        INDEX idx_workflow_user (user_id),
                        INDEX idx_workflow_stage (stage),
                        INDEX idx_workflow_tenant_task (tenant_id, task_id)
                    )
                `);
                logger.info('Created workflow table');
            } catch (createErr) {
                logger.warn('Failed to create workflow table: ' + createErr.message);
            }
        }
    }

    try {
        await q('SELECT 1 FROM workflow_definitions LIMIT 1');
    } catch (e) {
        if (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146 || (e.message && e.message.includes("doesn't exist"))) {
            try {
                await q(`
                    CREATE TABLE IF NOT EXISTS workflow_definitions (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        tenant_id INT NOT NULL,
                        entity_type VARCHAR(50) NOT NULL,
                        from_state VARCHAR(50) NOT NULL,
                        to_state VARCHAR(50) NOT NULL,
                        approver_role VARCHAR(50) NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        UNIQUE KEY uq_wd_tenant_entity_states (tenant_id, entity_type, from_state, to_state)
                    )
                `);
                logger.info('Created workflow_definitions table');
            } catch (createErr) {
                logger.warn('Failed to create workflow_definitions table: ' + createErr.message);
            }
        }
    }
};

const getApproverRole = async (tenantId, entityType, fromState, toState) => {

    try {
        const sql = `
            SELECT approver_role 
            FROM workflow_definitions 
            WHERE tenant_id = ? AND entity_type = ? AND from_state = ? AND to_state = ?
        `;
        const results = await q(sql, [tenantId, entityType, fromState, toState]);
        if (results && results.length && results[0].approver_role) {
            return results[0].approver_role;
        }
    } catch (err) {

        logger.warn('[WARN] getApproverRole: fallback due to error querying workflow_definitions:', err && err.message);
    }

    if (entityType === 'TASK' && fromState === 'IN_PROGRESS' && (toState === 'REVIEW' || toState === 'COMPLETED')) {
        return 'Manager';
    }
    if (entityType === 'PROJECT' && fromState === 'ACTIVE' && toState === 'CLOSED') {
        return 'Admin';
    }

    return 'Manager';
};

const insertWorkflowActivity = async ({ tenantId, taskId, userId, action, stage, comment, connection }) => {
    const result = await q(`
        INSERT INTO workflow (tenant_id, task_id, user_id, action, stage, comment, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
    `, [tenantId, taskId, userId, action, stage, comment || null], connection);
    return result;
};

const requestTransition = async ({ tenantId, entityType, entityId, toState, userId, role, projectId, meta, connection: externalConnection }) => {
    logger.info(`[WORKFLOW REQUEST TRANSITION] Params: tenantId=${tenantId}, entityType=${entityType}, entityId=${entityId}, toState=${toState}, userId=${userId}, role=${role}`);
    await ensureWorkflowTables();

    if (entityType === 'TASK' || entityType === 'PROJECT') {
        const fromState = entityType === 'TASK' ? 'IN_PROGRESS' : 'ACTIVE'; // Default from states
        const approverRole = await getApproverRole(tenantId, entityType, fromState, toState);

        if (!approverRole) {
            throw new Error(`No approval rule defined for ${entityType} transition from ${fromState} to ${toState}`);
        }

        const connection = externalConnection || await beginTransaction();
        try {
            let internalId = entityId;
            let taskProjectId = null;
            let assignedManagerId = null;

            if (entityType === 'TASK') {
                const rows = await q('SELECT id, project_id FROM tasks WHERE id = ? OR public_id = ? LIMIT 1', [entityId, entityId]);
                if (rows && rows.length > 0) {
                    internalId = rows[0].id;
                    taskProjectId = rows[0].project_id;
                }

                if (taskProjectId) {
                    const projectRows = await q('SELECT project_manager_id FROM projects WHERE id = ? LIMIT 1', [taskProjectId]);
                    if (projectRows && projectRows.length > 0 && projectRows[0].project_manager_id) {
                        assignedManagerId = projectRows[0].project_manager_id;
                    }
                }
            } else if (entityType === 'PROJECT') {
                const rows = await q('SELECT id FROM projects WHERE id = ? OR public_id = ? LIMIT 1', [entityId, entityId]);
                if (rows && rows.length > 0) {
                    internalId = rows[0].id;
                }
            }

            // For PROJECT closure, task status is the source of truth for completion.
            if (entityType === 'PROJECT' && (toState === 'CLOSED' || toState === 'COMPLETED')) {
                let results;
                if (await hasColumn('tasks', 'tenant_id')) {
                    results = await q(`
                        SELECT COUNT(*) as total,
                               SUM(CASE WHEN UPPER(REPLACE(TRIM(COALESCE(status, '')), ' ', '_')) = 'COMPLETED' THEN 1 ELSE 0 END) as completed
                        FROM tasks
                        WHERE project_id = ? AND tenant_id = ?
                    `, [internalId, tenantId]);
                } else {
                    results = await q(`
                        SELECT COUNT(*) as total,
                               SUM(CASE WHEN UPPER(REPLACE(TRIM(COALESCE(status, '')), ' ', '_')) = 'COMPLETED' THEN 1 ELSE 0 END) as completed
                        FROM tasks
                        WHERE project_id = ?
                    `, [internalId]);
                }
                const { total, completed } = results[0] || { total: 0, completed: 0 };
                if (total > 0 && total !== completed) {
                    throw new Error('All tasks must be COMPLETED before requesting project closure');
                }
            }

            const hasApproverId = await hasColumn('workflow_requests', 'approver_id');

            const insertRequestSql = assignedManagerId && hasApproverId ? `
                INSERT INTO workflow_requests 
                (tenant_id, entity_type, entity_id, requested_by_id, approver_role, approver_id, status, from_state, to_state) 
                VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
            ` : `
                INSERT INTO workflow_requests 
                (tenant_id, entity_type, entity_id, requested_by_id, approver_role, status, from_state, to_state) 
                VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)
            `;
            const params = assignedManagerId && hasApproverId ?
                [tenantId, entityType, internalId, userId, approverRole, assignedManagerId, fromState, toState] :
                [tenantId, entityType, internalId, userId, approverRole, fromState, toState];
            const requestResult = await q(insertRequestSql, params, connection);
            const requestId = requestResult.insertId;

            // Workflow logging commented out - table was dropped during cleanup
            // const logSql = `
            //     INSERT INTO workflow_logs (request_id, tenant_id, entity_type, entity_id, action, from_state, to_state, user_id, details) 
            //     VALUES (?, ?, ?, ?, 'REQUEST', ?, ?, ?, ?)
            // `;
            // await q(logSql, [
            //     requestId,
            //     tenantId,
            //     entityType,
            //     internalId,
            //     fromState,
            //     toState,
            //     userId,
            //     JSON.stringify({ reason: meta?.reason || `Requested transition to ${toState}` })
            // ], connection);

            let workflowActivityResult = null;
            if (entityType === 'TASK' && String(toState || '').toUpperCase() === 'REVIEW') {
                workflowActivityResult = await insertWorkflowActivity({
                    tenantId,
                    taskId: internalId,
                    userId,
                    action: 'REQUEST_REVIEW',
                    stage: 'REVIEW',
                    comment: meta?.comment || meta?.reason || null,
                    connection
                });
            }

            if (!externalConnection) {
                await commitTransaction(connection);
            }

            // Notifications
            if (!externalConnection && assignedManagerId && entityType === 'TASK') {
                try {
                    if (NotificationService && typeof NotificationService.createAndSend === 'function') {
                        await NotificationService.createAndSend(
                            [assignedManagerId],
                            `${entityType} Transition Requested`,
                            `${entityType} #${internalId} has been submitted for your review.`,
                            `${entityType}_REVIEW_REQUEST`,
                            entityType.toLowerCase(),
                            entityId
                        );
                    }
                } catch (nerr) {
                    logger.warn('[WARN] notify assigned manager failed:', nerr && nerr.message);
                }
            }

            if (!externalConnection) {
                try {
                    if (NotificationService && typeof NotificationService.createAndSendToRoles === 'function') {
                        await NotificationService.createAndSendToRoles(
                            ['Admin'],
                            `${entityType} Transition Requested`,
                            `${entityType} #${internalId} has been submitted for approval.`,
                            `${entityType}_REVIEW_REQUEST`,
                            entityType.toLowerCase(),
                            entityId,
                            tenantId
                        );
                    }
                } catch (nerr) {
                    logger.warn('[WARN] notify admins failed:', nerr && nerr.message);
                }
            }

            return {
                message: `${entityType} transition to ${toState} requested. Awaiting approval.`,
                requestId: requestId,
                workflowId: workflowActivityResult && workflowActivityResult.insertId ? workflowActivityResult.insertId : null
            };

        } catch (error) {
            if (!externalConnection) {
                await rollbackTransaction(connection);
            }
            throw error;
        }
    }
    throw new Error(`This transition is not supported. Supported: TASK and PROJECT to any state with approval rules. Received: ${entityType} to ${toState}`);
};


const requestProjectClosure = async ({ tenantId, projectId, reason, userId }) => {
    if (!projectId) throw new Error('projectId is required');

    const prow = await q('SELECT id, status FROM projects WHERE id = ? OR public_id = ? LIMIT 1', [projectId, projectId]);
    if (!prow || prow.length === 0) throw new Error('Project not found');
    const p = prow[0];
    const internalProjectId = p.id;
    if (!p.status || String(p.status).toUpperCase() !== 'ACTIVE') throw new Error('Project must be ACTIVE to request closure');

    // Fetch tasks for validation
    let tasks;
    if (await hasColumn('tasks', 'tenant_id')) {
        tasks = await q('SELECT status FROM tasks WHERE project_id = ? AND tenant_id = ?', [internalProjectId, tenantId]);
    } else {
        tasks = await q('SELECT status FROM tasks WHERE project_id = ?', [internalProjectId]);
    }

    const invalidTasks = tasks.filter((task) => !isCompletedTaskStatus(task.status));

    if (tasks.length === 0) throw new Error('Project has no tasks');
    if (invalidTasks.length > 0) throw new Error('All tasks must be COMPLETED before requesting project closure');

    const connection = await beginTransaction();
    try {

        if (await hasColumn('projects', 'tenant_id')) {
            await q('UPDATE projects SET status = ? WHERE id = ? AND tenant_id = ?', ['PENDING_FINAL_APPROVAL', internalProjectId, tenantId], connection);
        } else {
            await q('UPDATE projects SET status = ? WHERE id = ?', ['PENDING_FINAL_APPROVAL', internalProjectId], connection);
        }


        if (await hasColumn('projects', 'is_locked')) {
            if (await hasColumn('projects', 'tenant_id')) {
                await q('UPDATE projects SET is_locked = 1 WHERE id = ? AND tenant_id = ?', [internalProjectId, tenantId], connection);
            } else {
                await q('UPDATE projects SET is_locked = 1 WHERE id = ?', [internalProjectId], connection);
            }
        }
        if (await hasColumn('tasks', 'is_locked')) {
            if (await hasColumn('tasks', 'tenant_id')) {
                await q('UPDATE tasks SET is_locked = 1 WHERE project_id = ? AND tenant_id = ?', [internalProjectId, tenantId], connection);
            } else {
                await q('UPDATE tasks SET is_locked = 1 WHERE project_id = ?', [internalProjectId], connection);
            }
        }

        const approverRole = await getApproverRole(tenantId, 'PROJECT', 'ACTIVE', 'CLOSED');
        const insertRequestSql = `
            INSERT INTO workflow_requests (tenant_id, entity_type, entity_id, project_id, requested_by_id, approver_role, status, from_state, to_state, reason)
            VALUES (?, 'PROJECT', ?, ?, ?, ?, 'PENDING', 'ACTIVE', 'CLOSED', ?)
        `;
        const rr = await q(insertRequestSql, [tenantId, internalProjectId, internalProjectId, userId, approverRole, reason || null], connection);
        const requestId = rr.insertId;

        // Workflow logging commented out - table was dropped during cleanup
        // const logSql = `
        //     INSERT INTO workflow_logs (request_id, tenant_id, entity_type, entity_id, action, from_state, to_state, user_id, details)
        //     VALUES (?, ?, 'PROJECT', ?, 'REQUEST', 'ACTIVE', 'CLOSED', ?, ?)
        // `;
        // await q(logSql, [requestId, tenantId, internalProjectId, userId, JSON.stringify({ reason: reason || 'Manager requested project closure' })], connection);

        await commitTransaction(connection);

        try {
            if (NotificationService && typeof NotificationService.createAndSendToRoles === 'function') {
                await NotificationService.createAndSendToRoles(['Admin'], 'Project Closure Requested', `Project ${internalProjectId} submitted for final approval.`, 'PROJECT_CLOSE_REQUEST', 'project', internalProjectId, tenantId);
            }
        } catch (nerr) { logger.warn('[WARN] notify admins failed:', nerr && nerr.message); }

        return { projectId: internalProjectId, projectStatus: 'PENDING_FINAL_APPROVAL', requestId };
    } catch (e) {
        await rollbackTransaction(connection);
        throw e;
    }
};


const processApproval = async ({ tenantId, requestId, action, reason, userId, userRole }) => {
    await ensureWorkflowTables();

    const connection = await beginTransaction();
    try {

        const getRequestSql = 'SELECT * FROM workflow_requests WHERE id = ? AND tenant_id = ?';
        const requests = await q(getRequestSql, [requestId, tenantId], connection);
        if (requests.length === 0) throw new Error("Workflow request not found.");

        const req = requests[0];
        if (req.status !== 'PENDING') throw new Error(`Request is already ${req.status}.`);

        const hasApproverId = await hasColumn('workflow_requests', 'approver_id');
        if (hasApproverId && req.approver_id) {

            const actingRole = (userRole || '').toUpperCase();
            if (userId !== req.approver_id && actingRole !== 'ADMIN') {
                throw new Error(`Only the assigned manager can ${action.toLowerCase()} this request.`);
            }
        } else {

            const approverRole = (req.approver_role || '').toUpperCase();
            const actingRole = (userRole || '').toUpperCase();
            if (approverRole) {
                if (approverRole !== actingRole && actingRole !== 'ADMIN') {
                    throw new Error(`You do not have permission to ${action.toLowerCase()} this request. Expected role: ${approverRole}`);
                }
            } else {

                if (actingRole !== 'MANAGER' && actingRole !== 'ADMIN') {
                    throw new Error(`You do not have permission to ${action.toLowerCase()} this request.`);
                }
            }
        }

        const { entity_type, entity_id, from_state, to_state } = req;

        let project_id = null;
        if (entity_type === 'TASK') {
            const trows = await q('SELECT project_id FROM tasks WHERE id = ? LIMIT 1', [entity_id], connection);
            if (trows && trows.length) project_id = trows[0].project_id;
        } else if (entity_type === 'PROJECT') {
            project_id = entity_id;
        }
        const normalizeState = (s) => {
            if (!s) return s;
            const up = String(s).toUpperCase().replace(/\s+/g, ' ').replace(/_/g, ' ').trim();
            if (up === 'IN PROGRESS' || up === 'INPROGRESS') return 'In Progress';
            if (up === 'REVIEW') return 'Review';
            if (up === 'COMPLETED') return 'Completed';
            if (up === 'PENDING') return 'Pending';
            if (up === 'ON HOLD' || up === 'ON_HOLD') return 'On Hold';
            return s;
        };

        const newStatus = action === 'APPROVE' 
            ? (normalizeState(to_state) === 'Review' ? 'Completed' : normalizeState(to_state))
            : (normalizeState(from_state) || 'In Progress');
        const requestStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

        const table = entity_type.toLowerCase() + 's'; // tasks or projects
        if (entity_type === 'TASK') {
            const hasAssignmentReviewRequested = await hasColumn('task_assignment_status', 'review_requested');
            const assignmentSql = action === 'APPROVE'
                ? `UPDATE task_assignment_status
                   SET status = 'COMPLETED',
                       approved_at = NOW(),
                       ${hasAssignmentReviewRequested ? 'review_requested = 0,' : ''}
                       updated_at = NOW()
                   WHERE task_id = ? AND status = 'IN_REVIEW'`
                : `UPDATE task_assignment_status
                   SET status = 'IN_PROGRESS',
                       rejected_at = NOW(),
                       ${hasAssignmentReviewRequested ? 'review_requested = 0,' : ''}
                       updated_at = NOW()
                   WHERE task_id = ? AND status = 'IN_REVIEW'`;
            await q(assignmentSql, [entity_id], connection);

            const updateEntitySql = `UPDATE ${table} SET status = ? WHERE id = ?`;
            await q(updateEntitySql, [newStatus, entity_id], connection);
        } else {
            const updateEntitySql = `UPDATE ${table} SET status = ? WHERE id = ? AND tenant_id = ?`;
            await q(updateEntitySql, [newStatus, entity_id, tenantId], connection);
        }

        // Update workflow_stage in workflow table for TASK entities
        // On approval: set stage to 'COMPLETED'
        // On rejection: set stage to 'IN_PROGRESS'
        if (entity_type === 'TASK') {
            const workflowStage = action === 'APPROVE' ? 'COMPLETED' : 'IN_PROGRESS';
            const workflowAction = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
            await insertWorkflowActivity({
                tenantId,
                taskId: entity_id,
                userId,
                action: workflowAction,
                stage: workflowStage,
                comment: reason || null,
                connection
            });
        }

        let processedColumn = null;
        if (await hasColumn('workflow_requests', 'processed_by_id')) processedColumn = 'processed_by_id';
        else if (await hasColumn('workflow_requests', 'approved_by')) processedColumn = 'approved_by';
        else if (await hasColumn('workflow_requests', 'approved_by_id')) processedColumn = 'approved_by_id';

        if (processedColumn) {
            const updateRequestSql = `UPDATE workflow_requests SET status = ?, ${processedColumn} = ? WHERE id = ?`;
            await q(updateRequestSql, [requestStatus, userId, requestId], connection);
        } else {
            const updateRequestSql = `UPDATE workflow_requests SET status = ? WHERE id = ?`;
            await q(updateRequestSql, [requestStatus, requestId], connection);
        }

        // Workflow logging commented out - table was dropped during cleanup
        // const logSql = `
        //     INSERT INTO workflow_logs (request_id, tenant_id, entity_type, entity_id, action, from_state, to_state, user_id, details) 
        //     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        // `;
        // await q(logSql, [
        //     requestId,
        //     tenantId,
        //     entity_type,
        //     entity_id,
        //     action,
        //     from_state,
        //     to_state,
        //     userId,
        //     JSON.stringify({ reason: reason || `${action}D` })
        // ], connection);

        await commitTransaction(connection);

        // Send notifications after successful approval processing
        try {
            const actionVerb = action === 'APPROVE' ? 'approved' : 'rejected';
            const notificationTitle = action === 'APPROVE' ? `${entity_type} Request Approved` : `${entity_type} Request Rejected`;
            const notificationMessage = `Your ${entity_type.toLowerCase()} request #${requestId} has been ${actionVerb}. Status: ${newStatus}`;

            // Notify the user who made the request
            if (req.requested_by_id) {
                if (NotificationService && typeof NotificationService.createAndSend === 'function') {
                    await NotificationService.createAndSend(
                        [req.requested_by_id],
                        notificationTitle,
                        notificationMessage,
                        entity_type === 'TASK' ? 'TASK_APPROVAL' : 'PROJECT_APPROVAL',
                        entity_type.toLowerCase(),
                        entity_id
                    );
                }
            }

            // Notify admins about the approval action taken
            if (NotificationService && typeof NotificationService.createAndSendToRoles === 'function') {
                const adminNotificationMessage = `${entity_type} request #${requestId} has been ${actionVerb} by ${userRole}.`;
                await NotificationService.createAndSendToRoles(
                    ['Admin'],
                    `Approval Workflow: ${entity_type} ${action}ED`,
                    adminNotificationMessage,
                    entity_type === 'TASK' ? 'TASK_APPROVAL' : 'PROJECT_APPROVAL',
                    entity_type.toLowerCase(),
                    entity_id,
                    tenantId
                );
            }
        } catch (nerr) {
            logger.warn('[WARN] notification on approval processing failed:', nerr && nerr.message);
        }

        const actionVerb = action === 'APPROVE' ? 'approved' : 'rejected';
        return {
            message: `${entity_type} request #${requestId} has been ${actionVerb}.`,
            newStatus: newStatus
        };

    } catch (error) {
        await rollbackTransaction(connection);
        throw error;
    }
};


const checkAndTriggerProjectApproval = async (tenantId, projectId, systemUserId) => {
    if (!projectId) return;

    // Fetch tasks for validation
    let tasks;
    if (await hasColumn('tasks', 'tenant_id')) {
        tasks = await q('SELECT status FROM tasks WHERE project_id = ? AND tenant_id = ?', [projectId, tenantId]);
    } else {
        tasks = await q('SELECT status FROM tasks WHERE project_id = ?', [projectId]);
    }

    const invalidTasks = tasks.filter((task) => !isCompletedTaskStatus(task.status));

    if (tasks.length > 0 && invalidTasks.length === 0) {
        const connection = await beginTransaction();
        try {

            await q('UPDATE projects SET status = ? WHERE id = ?', ['PENDING_FINAL_APPROVAL', projectId], connection);

            if (await hasColumn('projects', 'is_locked')) {
                await q('UPDATE projects SET is_locked = 1 WHERE id = ?', [projectId], connection);
            }
            if (await hasColumn('tasks', 'is_locked')) {
                await q('UPDATE tasks SET is_locked = 1 WHERE project_id = ?', [projectId], connection);
            }

            const approverRole = await getApproverRole(tenantId, 'PROJECT', 'ACTIVE', 'CLOSED');
            const insertRequestSql = `
                INSERT INTO workflow_requests 
                (tenant_id, entity_type, entity_id, requested_by_id, approver_role, status, from_state, to_state) 
                VALUES (?, 'PROJECT', ?, ?, ?, 'PENDING', 'ACTIVE', 'CLOSED')
            `;
            const requestResult = await q(insertRequestSql, [tenantId, projectId, systemUserId, approverRole], connection);
            const requestId = requestResult.insertId;

            // Workflow logging commented out - table was dropped during cleanup
            // const logSql = `
            //     INSERT INTO workflow_logs (request_id, tenant_id, entity_type, entity_id, action, from_state, to_state, user_id, details) 
            //     VALUES (?, ?, 'PROJECT', ?, 'REQUEST', 'ACTIVE', 'CLOSED', ?, ?)
            // `;
            // await q(logSql, [
            //     requestId,
            //     tenantId,
            //     projectId,
            //     systemUserId,
            //     JSON.stringify({ message: 'All tasks completed. Project submitted for final closure.' })
            // ], connection);

            await commitTransaction(connection);
            logger.info(`[INFO] Project ${projectId} submitted for final admin approval.`);

        } catch (error) {
            await rollbackTransaction(connection);
            logger.error(`[ERROR] Failed to trigger project approval for project ${projectId}:`, error);
        }
    }
};


const getRequests = async ({ tenantId, role, status, userId, userPublicId, projectId }) => {
    await ensureWorkflowTables();

    let processedColumn = null;
    if (await hasColumn('workflow_requests', 'processed_by_id')) processedColumn = 'processed_by_id';
    else if (await hasColumn('workflow_requests', 'approved_by_id')) processedColumn = 'approved_by_id';
    else if (await hasColumn('workflow_requests', 'approved_by')) processedColumn = 'approved_by';

    const processedSelect = processedColumn
        ? `, u2._id as processed_by_id, u2.name as processed_by_name, u2.email as processed_by_email, u2.role as processed_by_role`
        : `, NULL as processed_by_id, NULL as processed_by_name, NULL as processed_by_email, NULL as processed_by_role`;

    const processedJoin = processedColumn ? `LEFT JOIN users u2 ON wr.${processedColumn} = u2._id` : '';

    const hasApproverId = await hasColumn('workflow_requests', 'approver_id');
    const hasReviewRequestedColumn = await hasColumn('task_assignment_status', 'review_requested');

    const approverSelect = hasApproverId ? `, u_approver._id as approver_user_id, u_approver.name as approver_name, u_approver.email as approver_email` : '';
    const approverJoin = hasApproverId ? `LEFT JOIN users u_approver ON wr.approver_id = u_approver._id` : '';

    const hasManagerIdColumn = await hasColumn('projects', 'manager_id');
    const uPubId = userPublicId || userId;
    const managerCond = hasManagerIdColumn
        ? `(p.project_manager_id = ? OR p.project_manager_id = ? OR p.manager_id = ? OR p.manager_id = ?)`
        : `(p.project_manager_id = ? OR p.project_manager_id = ?)`;
    const getManagerParams = () => hasManagerIdColumn ? [userId, uPubId, userId, uPubId] : [userId, uPubId];

    let sql = `
        SELECT wr.*, 
               u.name as requested_by_name, 
               u.email as requested_by_email,
               u.role as requested_by_role,
               p.name as project_name, 
               p.public_id as project_public_id,
               p.status as project_status,
               p.is_locked as project_is_locked,
               t.title as task_name,
               t.status as task_status,
               t.is_locked as task_is_locked,
               tas_review.assignment_status as assignment_status,
               tas_review.review_requested as assignment_review_requested,
               wf_review.stage as workflow_stage,
               wf_review.action as workflow_action,
               wf_review.comment as workflow_comment,
               wf_review.created_at as workflow_created_at,
               c.name as client_name,
               c.company as client_company,
               c.email as client_email
               ${processedSelect}
               ${approverSelect}
        FROM workflow_requests wr
        LEFT JOIN users u ON wr.requested_by_id = u._id
        ${processedJoin}
        ${approverJoin}
        LEFT JOIN tasks t ON wr.entity_type = 'TASK' AND CAST(wr.entity_id AS CHAR) = CAST(t.id AS CHAR)
        LEFT JOIN (
            SELECT tas.task_id,
                   MAX(CASE WHEN tas.status = 'IN_REVIEW' THEN tas.status ELSE NULL END) AS assignment_status,
                   MAX(CASE WHEN ${hasReviewRequestedColumn ? 'COALESCE(tas.review_requested, 0)' : '0'} = 1 THEN 1 ELSE 0 END) AS review_requested
            FROM task_assignment_status tas
            GROUP BY tas.task_id
        ) tas_review ON wr.entity_type = 'TASK' AND tas_review.task_id = t.id
        LEFT JOIN (
            SELECT w1.task_id, w1.stage, w1.action, w1.comment, w1.created_at
            FROM workflow w1
            INNER JOIN (
                SELECT task_id, MAX(created_at) AS latest_created_at
                FROM workflow
                GROUP BY task_id
            ) w2 ON w1.task_id = w2.task_id AND w1.created_at = w2.latest_created_at
        ) wf_review ON wr.entity_type = 'TASK' AND wf_review.task_id = t.id
        LEFT JOIN projects p ON (wr.entity_type = 'PROJECT' AND (CAST(wr.entity_id AS CHAR) = CAST(p.id AS CHAR) OR CAST(wr.entity_id AS CHAR) = CAST(p.public_id AS CHAR))) OR (wr.entity_type = 'TASK' AND (CAST(t.project_id AS CHAR) = CAST(p.id AS CHAR) OR CAST(t.project_id AS CHAR) = CAST(p.public_id AS CHAR)))
        LEFT JOIN clients c ON p.client_id = c.id
        WHERE wr.tenant_id = ?
    `;
    const params = [tenantId];

    if (userId && role && role.toUpperCase() === 'MANAGER') {
        if (status && status.toUpperCase() === 'PENDING') {

            if (hasApproverId) {
                sql += ` AND (wr.approver_id = ? OR ${managerCond}) AND wr.approver_role = ?`;
                params.push(userId, ...getManagerParams(), role);
            } else {
                sql += ` AND ${managerCond} AND wr.approver_role = ?`;
                params.push(...getManagerParams(), role);
            }
        } else if (status && (status.toUpperCase() === 'APPROVED' || status.toUpperCase() === 'REJECTED')) {

            if (processedColumn) {
                sql += ` AND wr.${processedColumn} = ? AND wr.approver_role = ?`;
                params.push(userId, role);
            } else {

                sql += ` AND ${managerCond} AND wr.approver_role = ?`;
                params.push(...getManagerParams(), role);
            }
        } else {

            if (processedColumn && hasApproverId) {
                sql += ` AND ((wr.approver_id = ? OR ${managerCond} OR wr.${processedColumn} = ?) AND wr.approver_role = ?)`;
                params.push(userId, ...getManagerParams(), userId, role);
            } else if (processedColumn) {
                sql += ` AND ((${managerCond} OR wr.${processedColumn} = ?) AND wr.approver_role = ?)`;
                params.push(...getManagerParams(), userId, role);
            } else if (hasApproverId) {
                sql += ` AND (wr.approver_id = ? OR ${managerCond}) AND wr.approver_role = ?`;
                params.push(userId, ...getManagerParams(), role);
            } else {
                sql += ` AND ${managerCond} AND wr.approver_role = ?`;
                params.push(...getManagerParams(), role);
            }
        }
    } else {
        sql += ' AND wr.approver_role = ?';
        params.push(role);
    }

    if (status && status.toLowerCase() !== 'all') {
        sql += ' AND wr.status = ?';
        params.push(status);
    }

    if (projectId) {
        sql += ' AND (p.id = ? OR p.public_id = ?)';
        params.push(projectId, projectId);
    }

    if (role && role.toUpperCase() === 'MANAGER') {
        sql += ` AND (
            wr.entity_type != 'TASK'
            OR COALESCE(tas_review.assignment_status, '') = 'IN_REVIEW'
            OR COALESCE(tas_review.assignment_status, '') = 'REVIEW'
            OR COALESCE(wf_review.stage, '') = 'REVIEW'
            OR UPPER(COALESCE(wr.to_state, '')) = 'REVIEW'
            OR UPPER(COALESCE(wr.to_state, '')) = 'COMPLETED'
        )`;
    }

    sql += ' ORDER BY wr.created_at DESC';

    const requests = await q(sql, params);

    return (requests || []).map((req) => {
        const actionVerb = req.status === 'APPROVED' ? 'approved' : (req.status === 'REJECTED' ? 'rejected' : 'pending approval');
        const toStateUpper = String(req.to_state || '').toUpperCase();
        const projectStatusUpper = String(req.project_status || '').toUpperCase();
        const isPendingClosure = (toStateUpper === 'CLOSED') && projectStatusUpper === 'PENDING_FINAL_APPROVAL';
        const isProjectClosed = projectStatusUpper === 'CLOSED' || req.project_is_locked === 1;

        return {
            id: req.id,
            request_id: req.id,
            entity_type: req.entity_type,
            entity_id: req.entity_id,
            status: req.status,
            from_state: req.from_state,
            to_state: req.to_state,
            assignment_status: req.assignment_status || null,
            workflow_stage: req.workflow_stage || null,
            workflow_action: req.workflow_action || null,
            workflow_comment: req.workflow_comment || null,
            message: `${req.entity_type} request #${req.id} is ${actionVerb}.`,
            newStatus: req.status !== 'PENDING' ? (req.status === 'APPROVED' && req.to_state === 'REVIEW' ? 'COMPLETED' : (req.status === 'APPROVED' ? req.to_state : req.from_state)) : undefined,
            requested_at: req.created_at || null,
            requested_by: req.requested_by_id ? {
                id: req.requested_by_id,
                name: req.requested_by_name || null,
                email: req.requested_by_email || null,
                role: req.requested_by_role || null
            } : null,
            approved_by: req.processed_by_id ? {
                id: req.processed_by_id,
                name: req.processed_by_name || null,
                email: req.processed_by_email || null,
                role: req.processed_by_role || null
            } : null,
            approver: req.approver_user_id ? {
                id: req.approver_user_id,
                name: req.approver_name || null,
                email: req.approver_email || null
            } : null,
            project: (req.project_id || req.project_public_id || req.project_name) ? {
                id: req.project_public_id || (req.project_id != null ? String(req.project_id) : null),
                internal_id: req.project_id != null ? String(req.project_id) : null,
                name: req.project_name || null,
                status: isPendingClosure ? 'PENDING_CLOSURE' : (isProjectClosed ? 'CLOSED' : req.project_status || 'ACTIVE'),
                is_locked: req.project_is_locked === 1
            } : null,
            task: req.task_name ? {
                id: req.entity_type === 'TASK' ? String(req.entity_id) : null,
                title: req.task_name || null,
                status: req.task_status || null,
                is_locked: req.task_is_locked === 1
            } : null,
            client: (req.client_name || req.client_company || req.client_email) ? {
                name: req.client_name || null,
                company: req.client_company || null,
                email: req.client_email || null
            } : null,
            can_send_request: !isProjectClosed && !isPendingClosure && (req.entity_type !== 'TASK' || req.task_is_locked !== 1)
        };
    });
};


// const getHistory = async (tenantId, entityType, entityId) => {
//     const sql = `
//         SELECT wl.*, u.name as actor_name
//         FROM workflow_logs wl
//         JOIN workflow_requests wr ON wl.request_id = wr.id
//         JOIN users u ON wl.actor_id = u._id
//         WHERE wr.tenant_id = ? AND wr.entity_type = ? AND wr.entity_id = ?
//         ORDER BY wl.created_at ASC
//     `;
//     return await q(sql, [tenantId, entityType, entityId]);
// };


module.exports = {
    requestTransition,
    requestProjectClosure,
    processApproval,
    checkAndTriggerProjectApproval,
    getRequests,
    // getHistory, // commented out - workflow_logs table was dropped
    beginTransaction,
    commitTransaction,
    rollbackTransaction
};

