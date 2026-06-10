const express = require('express');
const router = express.Router();
const ChatService = require('../services/chatService');
const { requireRole } = require('../middleware/roles');
let logger;
try { logger = require(global.__root + 'logger'); } catch (e) { logger = require('../logger'); }
const ruleEngine = require('../middleware/ruleEngine');
const RULES = require('../rules/ruleCodes');
 
const q = (sql, params = []) => new Promise((resolve, reject) => {
  const db = require('../db');
  db.query(sql, params, (err, results) => {
    if (err) reject(err);
    else resolve(results);
  });
});
 
router.get('/:projectId/chat/messages', ruleEngine(RULES.PROJECT_VIEW), requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const hasAccess = await ChatService.validateProjectAccess(req.user._id, projectId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'You do not have access to this project chat'
      });
    }

    const messages = await ChatService.getProjectMessages(projectId, parseInt(limit), parseInt(offset));
 
    res.json({
      success: true,
      data: messages,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
 
  } catch (error) {
    logger.error('Error getting chat messages:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve chat messages'
    });
  }
});

router.get('/:projectId/chat/participants', ruleEngine(RULES.PROJECT_VIEW), requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    const { projectId } = req.params;

    const hasAccess = await ChatService.validateProjectAccess(req.user._id, projectId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'You do not have access to this project chat'
      });
    }

    const participants = await ChatService.getAllProjectMembers(projectId);
 
    res.json({
      success: true,
      data: participants
    });
 
  } catch (error) {
    logger.error('Error getting chat participants:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve chat participants'
    });
  }
});

router.post('/:projectId/chat/messages', ruleEngine(RULES.PROJECT_UPDATE), requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { message } = req.body;
 
    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message cannot be empty'
      });
    }

    const hasAccess = await ChatService.validateProjectAccess(req.user._id, projectId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'You do not have access to send messages in this project'
      });
    }
 
    let messageType = 'text';
    let responseMessage = message;
 
    if (message.startsWith('/')) {

      const userId = req.user._id || req.user.id; // Fallback to public_id if _id is not available
      const botResponse = await ChatService.handleChatbotCommand(projectId, message, req.user.name, userId);

      const botMessage = await ChatService.saveMessage(
        projectId,
        0, // System user ID for bot
        'ChatBot',
        botResponse,
        'bot'
      );
 
      const userMessage = await ChatService.saveMessage(
        projectId,
        req.user._id,
        req.user.name,
        message,
        'text'
      );

      const roomName = `project_${projectId}`;
      if (global.io) {
        global.io.to(roomName).emit('chat_message', userMessage);
        global.io.to(roomName).emit('chat_message', botMessage);
      }
 
      res.json({
        success: true,
        data: {
          userMessage,
          botMessage
        }
      });
      return;
    }

    const savedMessage = await ChatService.saveMessage(
      projectId,
      req.user._id,
      req.user.name,
      responseMessage,
      messageType
    );

    const roomName = `project_${projectId}`;
    if (global.io) {
      global.io.to(roomName).emit('chat_message', savedMessage);
    }
 
    res.json({
      success: true,
      data: savedMessage
    });
 
  } catch (error) {
    logger.error('Error sending chat message:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message'
    });
  }
});

router.get('/:projectId/chat/stats', ruleEngine(RULES.PROJECT_VIEW), requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    const { projectId } = req.params;

    const hasAccess = await ChatService.validateProjectAccess(req.user._id, projectId);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'You do not have access to this project chat'
      });
    }

    const stats = await ChatService.getChatStats(projectId);
 
    res.json({
      success: true,
      data: stats
    });
 
  } catch (error) {
    logger.error('Error getting chat stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve chat statistics'
    });
  }
});

router.delete('/:projectId/chat/messages/:messageId', ruleEngine(RULES.PROJECT_UPDATE), requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    const { projectId, messageId } = req.params;

    // Resolve public project id to internal id for DB checks
    let internalProjectId;
    try {
      internalProjectId = await ChatService.resolveProjectId(projectId);
    } catch (err) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    const [message] = await q(`
      SELECT * FROM chat_messages
      WHERE id = ? AND project_id = ?
    `, [messageId, internalProjectId]);
 
    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    if (message.sender_id !== req.user._id && req.user.role !== 'Admin') {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own messages'
      });
    }

    await q('DELETE FROM chat_messages WHERE id = ?', [messageId]);

    const roomName = `project_${projectId}`;
    if (global.io) {
      global.io.to(roomName).emit('message_deleted', {
        messageId,
        deleted_by: req.user.name
      });
    }
 
    res.json({
      success: true,
      message: 'Message deleted successfully'
    });
 
  } catch (error) {
    logger.error('Error deleting chat message:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete message'
    });
  }
});
 
module.exports = router;
 