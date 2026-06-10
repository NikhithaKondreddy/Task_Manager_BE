const db = require('../db');
let logger;
try { logger = require(__root + 'logger'); } catch (e) { logger = require('../../logger'); }

class ChatService {
  constructor() { }
  get io() { return global.io; }

  query(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.query(sql, params, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  }

  async getOrCreateProjectChat(projectId) {
    try {
      let chatRoom = await this.query(
        'SELECT * FROM project_chats WHERE project_id = ?',
        [projectId]
      );

      if (chatRoom && chatRoom.length > 0) {
        return chatRoom[0];
      }

      const roomName = `project_${projectId}`;
      const result = await this.query(
        'INSERT INTO project_chats (project_id, room_name) VALUES (?, ?)',
        [projectId, roomName]
      );

      return {
        id: result.insertId,
        project_id: projectId,
        room_name: roomName,
        created_at: new Date()
      };
    } catch (error) {
      logger.error('Error creating/getting project chat:', error);
      throw error;
    }
  }

  async resolveProjectId(projectId) {
    // Return numeric id if already numeric, otherwise resolve public_id -> id
    if (typeof projectId === 'number' || (/^\d+$/.test(String(projectId)))) {
      return Number(projectId);
    }

    const projResult = await this.query('SELECT id FROM projects WHERE public_id = ?', [projectId]);
    if (!projResult || projResult.length === 0) {
      throw new Error(`Project not found for public_id: ${projectId}`);
    }
    return projResult[0].id;
  }

  async validateProjectAccess(userId, projectId) {
    try {

      const userResult = await this.query(
        'SELECT role FROM users WHERE _id = ?',
        [userId]
      );

      if (!userResult || userResult.length === 0) {
        return false;
      }

      const userRole = userResult[0].role;

      const projectResult = await this.query(
        'SELECT id FROM projects WHERE public_id = ?',
        [projectId]
      );

      if (!projectResult || projectResult.length === 0) {
        return false;
      }

      const internalProjectId = projectResult[0].id;

      if (userRole === 'Admin') {
        return true;
      }

      const userInProject = await this.query(`
        SELECT COUNT(*) as count FROM task_assignments ta
        JOIN tasks t ON ta.task_id = t.id
        WHERE ta.user_id = ? AND t.project_id = ?
      `, [userId, internalProjectId]);

      if (userInProject[0].count > 0) {
        return true;
      }

      const isManager = await this.query(`
        SELECT COUNT(*) as count FROM projects
        WHERE id = ? AND project_manager_id = ?
      `, [internalProjectId, userId]);

      if (isManager[0].count > 0) {
        return true;
      }

      const isCreator = await this.query(`
        SELECT COUNT(*) as count FROM projects
        WHERE id = ? AND created_by = ?
      `, [internalProjectId, userId]);

      if (isCreator[0].count > 0) {
        return true;
      }

      if (userRole === 'Manager') {
        const deptAccess = await this.query(`
          SELECT COUNT(*) as count FROM project_departments pd
          JOIN user_departments ud ON pd.department_id = ud.department_id
          WHERE pd.project_id = ? AND ud.user_id = ?
        `, [internalProjectId, userId]);

        if (deptAccess[0].count > 0) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Error validating project access:', error);
      return false;
    }
  }

  async saveMessage(projectId, senderId, senderName, message, messageType = 'text') {
    try {
      // Resolve projectId: may be a public_id (string) or internal id (number)
      let internalProjectId = projectId;
      if (typeof projectId === 'string' && !/^\d+$/.test(projectId)) {
        const projResult = await this.query(
          'SELECT id FROM projects WHERE public_id = ?',
          [projectId]
        );
        if (!projResult || projResult.length === 0) {
          throw new Error(`Project not found for public_id: ${projectId}`);
        }
        internalProjectId = projResult[0].id;
      }

      const result = await this.query(
        'INSERT INTO chat_messages (project_id, sender_id, sender_name, message, message_type) VALUES (?, ?, ?, ?, ?)',
        [internalProjectId, senderId, senderName, message, messageType]
      );

      let senderPublicId = senderId;
      let senderRole = null;

      if (senderId !== 0) {
        const userResult = await this.query('SELECT public_id, role FROM users WHERE _id = ?', [senderId]);
        if (userResult.length > 0) {
          senderPublicId = userResult[0].public_id;
          senderRole = userResult[0].role;
        }
      }

      return {
        id: result.insertId,
        project_id: projectId, // return the original public_id so frontend can match
        sender_id: senderPublicId,
        sender_name: senderName,
        message,
        message_type: messageType,
        sender_role: senderRole,
        created_at: new Date()
      };
    } catch (error) {
      logger.error('Error saving message:', error);
      throw error;
    }
  }

  async getProjectMessages(projectId, limit = 50, offset = 0) {
    try {
      const internalProjectId = await this.resolveProjectId(projectId);

      const messages = await this.query(`
        SELECT
          cm.id,
          cm.project_id,
          COALESCE(u.public_id, cm.sender_id) as sender_id,
          cm.sender_name,
          cm.message,
          cm.message_type,
          cm.created_at,
          COALESCE(u.role, CASE
            WHEN cm.sender_id = 0 THEN 'System'
            ELSE 'Unknown'
          END) as sender_role
        FROM chat_messages cm
        LEFT JOIN users u ON cm.sender_id = u._id AND cm.sender_id != 0
        WHERE cm.project_id = ?
        ORDER BY cm.created_at DESC
        LIMIT ? OFFSET ?
      `, [internalProjectId, limit, offset]);

      return messages.reverse(); // Return in chronological order
    } catch (error) {
      logger.error('Error getting project messages:', error);
      throw error;
    }
  }

  async addParticipant(projectId, userId, userName, userRole) {
    try {
      await this.query(`
        INSERT INTO chat_participants (project_id, user_id, user_name, user_role, is_online)
        VALUES (?, ?, ?, ?, true)
        ON DUPLICATE KEY UPDATE
        user_name = VALUES(user_name),
        user_role = VALUES(user_role),
        is_online = true,
        last_seen = CURRENT_TIMESTAMP
      `, [projectId, userId, userName, userRole]);
    } catch (error) {
      logger.error('Error adding participant:', error);
      throw error;
    }
  }

  async removeParticipant(projectId, userId) {
    try {
      await this.query(
        'UPDATE chat_participants SET is_online = false, last_seen = CURRENT_TIMESTAMP WHERE project_id = ? AND user_id = ?',
        [projectId, userId]
      );
    } catch (error) {
      logger.error('Error removing participant:', error);
      throw error;
    }
  }

  async getOnlineParticipants(projectId) {
    try {
      const internalProjectId = await this.resolveProjectId(projectId);
      const participants = await this.query(
        'SELECT user_id, user_name, user_role, last_seen FROM chat_participants WHERE project_id = ? AND is_online = true',
        [internalProjectId]
      );
      return participants;
    } catch (error) {
      logger.error('Error getting online participants:', error);
      throw error;
    }
  }

  async getAllProjectMembers(projectId) {
    try {

      const projectResult = await this.query(
        'SELECT id FROM projects WHERE public_id = ?',
        [projectId]
      );

      if (!projectResult || projectResult.length === 0) {
        return [];
      }

      const internalProjectId = projectResult[0].id;

      const taskUsers = await this.query(`
        SELECT DISTINCT
          u._id as user_id,
          u.name as user_name,
          u.role as user_role,
          u.public_id,
          u.is_online
        FROM users u
        JOIN task_assignments ta ON u._id = ta.user_id
        JOIN tasks t ON ta.task_id = t.id
        WHERE t.project_id = ?
      `, [internalProjectId]);

      const projectManager = await this.query(`
        SELECT
          u._id as user_id,
          u.name as user_name,
          u.role as user_role,
          u.public_id,
          u.is_online
        FROM users u
        JOIN projects p ON u._id = p.project_manager_id
        WHERE p.id = ?
      `, [internalProjectId]);

      const projectCreator = await this.query(`
        SELECT
          u._id as user_id,
          u.name as user_name,
          u.role as user_role,
          u.public_id,
          u.is_online
        FROM users u
        JOIN projects p ON u._id = p.created_by
        WHERE p.id = ?
      `, [internalProjectId]);

      const allUsers = [...taskUsers, ...projectManager, ...projectCreator];
      const uniqueUsers = allUsers.filter((user, index, self) =>
        index === self.findIndex(u => u.user_id === user.user_id)
      );

      return uniqueUsers;
    } catch (error) {
      logger.error('Error getting all project members:', error);
      throw error;
    }
  }

  async getChatStats(projectId) {
    try {
      const internalProjectId = await this.resolveProjectId(projectId);

      const [messageStats] = await this.query(
        `SELECT
          COUNT(*) as total_messages,
          COUNT(DISTINCT sender_id) as unique_senders,
          COUNT(CASE WHEN message_type = 'bot' THEN 1 END) as bot_messages,
          MAX(created_at) as last_message_time
         FROM chat_messages WHERE project_id = ?`,
        [internalProjectId]
      );

      const allMembers = await this.getAllProjectMembers(projectId);
      const totalMembers = allMembers.length;

      const onlineCount = await this.query(
        'SELECT COUNT(*) as count FROM chat_participants WHERE project_id = ? AND is_online = true',
        [projectId]
      );

      return {
        total_messages: messageStats.total_messages || 0,
        unique_senders: messageStats.unique_senders || 0,
        bot_messages: messageStats.bot_messages || 0,
        total_participants: totalMembers,
        online_participants: onlineCount[0].count || 0,
        last_message_time: messageStats.last_message_time
      };
    } catch (error) {
      logger.error('Error getting chat stats:', error);
      throw error;
    }
  }

  async handleChatbotCommand(projectId, command, userName, userId) {
    try {

      const projectResult = await this.query(
        'SELECT id FROM projects WHERE public_id = ?',
        [projectId]
      );

      if (!projectResult || projectResult.length === 0) {
        return 'Project not found.';
      }

      const internalProjectId = projectResult[0].id;

      let internalUserId = userId;
      let userRole = null;
      if (typeof userId === 'string' && !/^\d+$/.test(userId)) {
        const userResult = await this.query('SELECT _id, role FROM users WHERE public_id = ?', [userId]);
        if (userResult && userResult.length > 0) {
          internalUserId = userResult[0]._id;
          userRole = userResult[0].role;
        } else {
          return 'User not found.';
        }
      }

      let response = '';

      switch (command.toLowerCase()) {
        case '/help':
          response = `Available commands:
/help - Show this help message
/tasks - List your assigned tasks in this project
/status - Show project status
/members - Show all project members
/online - Show currently online members`;
          break;

        case '/tasks':
          try {
            logger.debug('userRole:', userRole);
            if (userRole && (userRole.toLowerCase() === 'admin' || userRole.toLowerCase() === 'manager')) {

              const allTasks = await this.query(`
                SELECT title, status, priority
                FROM tasks
                WHERE project_id = ?
                ORDER BY id DESC
                LIMIT 10
              `, [internalProjectId]);

              if (allTasks.length === 0) {
                response = 'No tasks in this project.';
              } else {
                response = `All tasks in this project (${allTasks.length}):\n` +
                  allTasks.map(task =>
                    `• ${task.title}\n  Status: ${task.status}, Priority: ${task.priority}`
                  ).join('\n\n');
              }
            } else {
              const userTasks = await this.query(`
                SELECT t.title, t.status, t.priority
                FROM tasks t
                JOIN task_assignments ta ON t.id = ta.task_id
                WHERE ta.user_id = ?
                AND t.project_id = ?
                ORDER BY t.id DESC
                LIMIT 10
              `, [internalUserId, internalProjectId]);

              if (userTasks.length === 0) {
                response = 'You have no assigned tasks in this project.';
              } else {
                response = `Your assigned tasks (${userTasks.length}):\n` +
                  userTasks.map(task =>
                    `• ${task.title}\n  Status: ${task.status}, Priority: ${task.priority}`
                  ).join('\n\n');
              }
            }
          } catch (queryError) {
            logger.error('Database query error in /tasks:', queryError);
            response = 'Sorry, I encountered an error processing your command.';
          }
          break;

        case '/status':

          const projectInfo = await this.query(`
            SELECT
              COUNT(CASE WHEN status = 'Completed' THEN 1 END) as completed_tasks,
              COUNT(*) as total_tasks
            FROM tasks
            WHERE project_id = ?
          `, [internalProjectId]);

          const { completed_tasks, total_tasks } = projectInfo[0];
          const completionRate = total_tasks > 0 ? Math.round((completed_tasks / total_tasks) * 100) : 0;

          response = `Project Status:\n• Total Tasks: ${total_tasks}\n• Completed: ${completed_tasks}\n• Completion Rate: ${completionRate}%`;
          break;

        case '/members':

          const allMembers = await this.getAllProjectMembers(projectId);
          if (allMembers.length === 0) {
            response = 'No members found in this project.';
          } else {
            response = `Project Members (${allMembers.length}):\n` +
              allMembers.map(member => `• ${member.user_name} (${member.user_role})`).join('\n');
          }
          break;

        case '/online':

          const onlineMembers = await this.getOnlineParticipants(projectId);
          if (onlineMembers.length === 0) {
            response = 'No members are currently online.';
          } else {
            response = 'Online Members:\n' +
              onlineMembers.map(member => `• ${member.user_name} (${member.user_role})`).join('\n');
          }
          break;

        default:
          response = `Unknown command: ${command}. Type /help for available commands.`;
      }

      return response;
    } catch (error) {
      logger.error('Error handling chatbot command:', error);
      return 'Sorry, I encountered an error processing your command.';
    }
  }

  async sendSystemMessage(projectId, message) {
    try {
      const savedMessage = await this.saveMessage(projectId, 0, 'System', message, 'system');

      if (this.io) {
        this.io.to(`project_${projectId}`).emit('chat_message', savedMessage);
      }

      return savedMessage;
    } catch (error) {
      logger.error('Error sending system message:', error);
      throw error;
    }
  }

  async sendBotMessage(projectId, message) {
    try {
      const savedMessage = await this.saveMessage(projectId, 0, 'ChatBot', message, 'bot');

      if (this.io) {
        this.io.to(`project_${projectId}`).emit('chat_message', savedMessage);
      }

      return savedMessage;
    } catch (error) {
      logger.error('Error sending bot message:', error);
      throw error;
    }
  }

  async emitUserPresence(projectId, userName, action) {
    const message = action === 'joined'
      ? `${userName} joined the project chat`
      : `${userName} left the project chat`;

    await this.sendSystemMessage(projectId, message);
  }
}

module.exports = new ChatService();
