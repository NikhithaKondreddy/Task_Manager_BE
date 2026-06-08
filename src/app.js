const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const env = require('./config/env');
const app = express();
const server = http.createServer(app);

// ✅ Setup global production safety guards EARLY
const productionSafetyGuard = require('./utils/productionSafetyGuard');
productionSafetyGuard.setupGlobalErrorHandlers();

const io = socketIo(server, {
  cors: {
    origin: (env && env.NODE_ENV === 'production')
      ? [(env.FRONTEND_URL || env.BASE_URL).replace(/\/$/, '')]
      : '*',
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },
  pingInterval: 10000,
  pingTimeout: 5000,
  transports: ['websocket', 'polling'], // Allow both, but prioritize WebSocket
  allowEIO3: true // Support older clients if any
});
const db = require('./config/db');
const ChatService = require('./services/chatService');
const bootstrapService = require('./services/bootstrapService');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const xss = require('xss-clean');
const hpp = require('hpp');
const morgan = require('morgan');
const logger = require('./logger');
const path = require('path');
const fs = require('fs');
const tenantMiddleware = require('./middleware/tenant');

global.__root = __dirname + '/';

const bootstrapPromise = bootstrapService.ensureBootstrap()
  .then((result) => {
    if (result.success) {
      logger.info('Application bootstrap complete');
    } else {
      logger.error('Application bootstrap failed: ' + (result.error && result.error.message ? result.error.message : String(result.error)));
    }
  })
  .catch((error) => {
    logger.error('Application bootstrap unexpected error: ' + (error && error.message ? error.message : String(error)));
  });

server.bootstrapReady = bootstrapPromise;

app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
}));
app.use(xss());
app.use(hpp());

const isDevelopment = process.env.NODE_ENV !== 'production';

// Trust proxy to resolve X-Forwarded-For correctly behind Nginx
app.set('trust proxy', 1);

// Define global rate limit config
const globalRateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 5000 : 2000,
  message: {
    success: false,
    error: 'Our servers are experiencing high traffic right now, please try again in a minute.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
};

// Define auth-specific rate limit config
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 100 : 20,
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again later.',
    code: 'AUTH_RATE_LIMIT_EXCEEDED',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authRateLimit);
app.use(rateLimit(globalRateLimitConfig));

app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// Our custom structured JSON request logger
const requestLogger = require('./middleware/requestLogger');
app.use(requestLogger);

const auditExpress = require('./middleware/auditExpress');
app.use(auditExpress);



io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error'));
  }
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', async (socket) => {
  try {

    const userResult = await new Promise((resolve, reject) => {
      db.query('SELECT _id, name, role FROM users WHERE public_id = ? LIMIT 1', [socket.user.id], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    if (!userResult || userResult.length === 0) {
      socket.emit('error', { message: 'User not found' });
      socket.disconnect();
      return;
    }

    const userId = userResult[0]._id; // Internal ID
    const userName = userResult[0].name || 'Unknown User';
    const userRole = userResult[0].role || 'Employee';

    logger.info(`User ${userName} (${userId}) connected`);

    socket.join(`user_${userId}`);

    socket.on('join_project_chat', async (projectId) => {
      try {

        const hasAccess = await ChatService.validateProjectAccess(userId, projectId);

        if (!hasAccess) {
          socket.emit('error', { message: 'You do not have access to this project chat' });
          return;
        }

        const chatRoom = await ChatService.getOrCreateProjectChat(projectId);
        const roomName = chatRoom.room_name;

        socket.join(roomName);

        await ChatService.addParticipant(projectId, userId, userName, userRole);

        socket.to(roomName).emit('user_joined', {
          userId,
          userName,
          userRole,
          timestamp: new Date()
        });

        await ChatService.emitUserPresence(projectId, userName, 'joined');

        const onlineParticipants = await ChatService.getOnlineParticipants(projectId);
        socket.emit('online_participants', onlineParticipants);

        logger.info(`User ${userName} joined project chat: ${roomName}`);

      } catch (error) {
        logger.error('Error joining project chat:', error);
        socket.emit('error', { message: 'Failed to join project chat' });
      }
    });

    socket.on('leave_project_chat', async (projectId) => {
      try {
        const roomName = `project_${projectId}`;

        socket.leave(roomName);

        await ChatService.removeParticipant(projectId, userId);

        socket.to(roomName).emit('user_left', {
          userId,
          userName,
          timestamp: new Date()
        });

        await ChatService.emitUserPresence(projectId, userName, 'left');

        logger.info(`User ${userName} left project chat: ${roomName}`);

      } catch (error) {
        logger.error('Error leaving project chat:', error);
      }
    });

    socket.on('send_message', async (data) => {
      try {
        const { projectId, message } = data;

        const hasAccess = await ChatService.validateProjectAccess(userId, projectId);
        if (!hasAccess) {
          socket.emit('error', { message: 'You do not have access to send messages in this project' });
          return;
        }

        let messageType = 'text';
        let responseMessage = message;

        if (message.startsWith('/')) {

          const botResponse = await ChatService.handleChatbotCommand(projectId, message, userName, userId);

          const botMessage = await ChatService.saveMessage(
            projectId,
            0, // System user ID for bot
            'ChatBot',
            botResponse,
            'bot'
          );

          const userMessage = await ChatService.saveMessage(
            projectId,
            userId,
            userName,
            message,
            'text'
          );

          const roomName = `project_${projectId}`;
          io.to(roomName).emit('chat_message', userMessage);
          io.to(roomName).emit('chat_message', botMessage);

          logger.info(`Bot command processed in ${roomName}: ${userName}`);
          return; // Don't send the original message
        }

        const savedMessage = await ChatService.saveMessage(
          projectId,
          userId,
          userName,
          responseMessage,
          messageType
        );

        const roomName = `project_${projectId}`;
        io.to(roomName).emit('chat_message', savedMessage);

        logger.info(`Message sent in ${roomName}: ${userName}`);

      } catch (error) {
        logger.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('typing_start', (projectId) => {
      const roomName = `project_${projectId}`;
      socket.to(roomName).emit('user_typing', {
        userId,
        userName,
        isTyping: true
      });
    });

    socket.on('typing_stop', (projectId) => {
      const roomName = `project_${projectId}`;
      socket.to(roomName).emit('user_typing', {
        userId,
        userName,
        isTyping: false
      });
    });

    socket.on('disconnect', async () => {
      logger.info(`User ${userName} disconnected`);

      const rooms = Array.from(socket.rooms).filter(room => room.startsWith('project_'));

      for (const roomName of rooms) {
        const projectId = roomName.replace('project_', '');

        try {
          await ChatService.removeParticipant(projectId, userId);

          socket.to(roomName).emit('user_left', {
            userId,
            userName,
            timestamp: new Date()
          });

        } catch (error) {
          logger.error('Error updating participant status on disconnect: ' + (error && error.stack ? error.stack : String(error)));
        }
      }
    });

    // Task updates
    socket.on('task_updated', (data) => {
      io.emit('task_updated', data);
    });

    // Notifications
    socket.on('new_notification', (data) => {
      io.emit('new_notification', data);
    });

  } catch (error) {
    logger.error('Error in socket connection: ' + (error && error.stack ? error.stack : String(error)));
    socket.emit('error', { message: 'Connection failed' });
    socket.disconnect();
  }
});

global.io = io;


// Increase body size limits for large uploads (up to 50MB)
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }))
app.use(bodyParser.json({ limit: '50mb' }))
// Multer file size error handler (413)
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, message: 'File too large. Max size is 50MB.' });
  }
  next(err);
});

app.use((req, res, next) => {
  try {
    const ct = req.headers['content-type'] || '';
    if (ct.indexOf('text/x-vite-ping') === 0) {
      return res.status(200).send('pong');
    }
  } catch (e) { }
  return next();
});
app.use(cors());
app.use(tenantMiddleware);




app.use('/uploads', async (req, res, next) => {
  try {
    // normalize double-encoded percent sequences
    if (req.url && req.url.indexOf('%25') !== -1) {
      let u = req.url;
      while (u.indexOf('%25') !== -1) u = u.replace(/%25/g, '%');
      req.url = u;
    }

    // Try to serve file directly by decoded path
    const candidateUploads = path.join(__dirname, '..', 'uploads');
    const decoded = decodeURIComponent(req.path || req.url || '');
    const rel = decoded.replace(/^\/+/, '');
    const physical = path.join(candidateUploads, rel);
    if (fs.existsSync(physical)) {
      return res.sendFile(physical);
    }

    // If file not present at that path, attempt to find a document record
    // matching either the original fileName or a filePath that ends with the requested name.
    try {
      const basename = path.basename(rel);
      const q = (sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
      // search by exact fileName
      let rows = await q('SELECT filePath FROM documents WHERE fileName = ? OR filePath LIKE ? LIMIT 1', [basename, '%' + basename]);
      if (rows && rows.length) {
        let p = rows[0].filePath || '';
        if (String(p).startsWith('/uploads/')) {
          const rel2 = p.replace(/^\/+uploads\/+/, '');
          const physical2 = path.join(candidateUploads, rel2);
          if (fs.existsSync(physical2)) return res.sendFile(physical2);
        }
      }
    } catch (e) {
      // ignore DB errors and fallthrough to static
    }
  } catch (e) {
    // swallow and let static handler try
  }
  return next();
}, express.static(path.join(__dirname, '..', 'uploads')));

try {
  const uploadsDir = path.join(__dirname, '..', 'uploads');

  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const profilesDir = path.join(uploadsDir, 'profiles');
  if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
} catch (e) {
  logger.warn('Failed to ensure uploads directory exists: ' + (e && e.message ? e.message : String(e)));
}
app.use((req, res, next) => {
  const oldJson = res.json;
  const oldSend = res.send;

  res.json = function (body) {
    try {
      if (env.NODE_ENV !== 'production') {
        logger.info(`[RESPONSE] ${req.method} ${req.originalUrl} -> ${typeof body === 'object' ? JSON.stringify(body) : body}`);
      } else {
        logger.info(`[RESPONSE] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
      }
    } catch (e) {
      logger.info(`[RESPONSE] ${req.method} ${req.originalUrl} -> [unserializable body]`);
    }
    return oldJson.call(this, body);
  };

  res.send = function (body) {
    try {
      if (env.NODE_ENV !== 'production') {
        logger.info(`[RESPONSE] ${req.method} ${req.originalUrl} -> ${typeof body === 'object' ? JSON.stringify(body) : body}`);
      } else {
        logger.info(`[RESPONSE] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
      }
    } catch (e) {
      logger.info(`[RESPONSE] ${req.method} ${req.originalUrl} -> [unserializable body]`);
    }
    return oldSend.call(this, body);
  };

  next();
});

app.get('/api', function (req, res) {
  try {
    res.status(200).send('API working...');
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

const AuthController = require(__root + 'controllers/AuthController');
const auditRoutes = require(__root + 'routes/auditRoutes');
const StaffUser = require(__root + 'controllers/User');
const tasksCRUD = require(__root + 'controllers/Tasks');
const taskWorkflowAutomationRoutes = require(__root + 'routes/taskWorkflowAutomationRoutes');
const uploadCRUD = require(__root + 'controllers/Uploads');
const clientRoutes = require(__root + 'routes/clientRoutes');
const adminRoutes = require(__root + 'routes/adminRoutes');
const superAdminRoutes = require(__root + 'routes/superAdminRoutes');
const projectRoutes = require(__root + 'routes/projectRoutes');
const managerRoutes = require(__root + 'routes/managerRoutes');
const employeeRoutes = require(__root + 'routes/employeeRoutes');
const notificationRoutes = require(__root + 'routes/notificationRoutes');
const chatRoutes = require(__root + 'routes/chatRoutes');
const documentRoutes = require(__root + 'routes/documentRoutes');
const workflowRoutes = require(__root + 'workflow/workflowRoutes');
const reportRoutes = require(__root + 'routes/reportRoutes');
const roleManagementRoutes = require(__root + 'routes/roleManagementRoutes');
const masterDataRoutes = require(__root + 'routes/masterDataRoutes');
const enterpriseTicketingRoutes = require(__root + 'routes/enterpriseTicketingRoutes');
const postmanCompatRoutes = require(__root + 'routes/postmanCompatRoutes');
const commentRoutes = require(__root + 'modules/comments/routes/commentRoutes');
const attachmentRoutes = require(__root + 'modules/attachments/routes/attachmentRoutes');
const {
  ticketRoutes,
  itTeamRoutes,
  categoryRoutes,
  engineerMappingRoutes,
  slaRoutes,
  userSearchRoutes,
  escalationRoutes,
  subcategoryRoutes,
} = require(__root + 'modules/tickets');

const clientViewerAccessControl = require(__root + 'middleware/clientViewerAccess');
const auth = require('./middleware/auth');

// Consolidate mounting at both /api/path and /path
app.use(['/api/auth', '/auth'], AuthController);
app.use(['/api/super-admin', '/super-admin'], superAdminRoutes);
app.use(['/api/admin', '/admin'], auditRoutes.admin);
app.use(['/api/admin', '/admin'], adminRoutes);
app.use(['/api/manager', '/manager'], auditRoutes.manager);
app.use(['/api/manager', '/manager'], managerRoutes);
app.use(['/api/employee', '/employee'], auditRoutes.employee);
app.use(['/api/employee', '/employee'], employeeRoutes);

app.use(['/api/users', '/users'], auth, userSearchRoutes);
app.use(['/api/users', '/users'], clientViewerAccessControl, StaffUser);
app.use(['/api/tasks', '/tasks'], clientViewerAccessControl, taskWorkflowAutomationRoutes);
app.use(['/api/tasks', '/tasks'], clientViewerAccessControl, tasksCRUD);
app.use(['/api/uploads', '/uploads'], uploadCRUD);
app.use(['/api/clients', '/clients'], clientRoutes);
app.use(['/api/projects', '/projects'], projectRoutes);
app.use(['/api/projects', '/projects'], chatRoutes);
app.use(['/api/notifications', '/notifications'], notificationRoutes);
app.use(['/api/documents', '/documents'], documentRoutes);
app.use(['/api/workflow', '/workflow'], workflowRoutes);
app.use(['/api/reports', '/reports'], reportRoutes);
app.use(['/api/comments', '/comments'], commentRoutes);
app.use(['/api/attachments', '/attachments'], attachmentRoutes);
app.use('/api', roleManagementRoutes);
app.use('/api', masterDataRoutes);
app.use('/api', enterpriseTicketingRoutes);
app.use('/api', postmanCompatRoutes);
app.use(['/api/tickets', '/tickets'], auth, ticketRoutes);
app.use(['/api/it-teams', '/it-teams'], auth, itTeamRoutes);
app.use(['/api/categories', '/categories'], auth, categoryRoutes);
app.use(['/api/subcategories', '/subcategories'], auth, subcategoryRoutes);
app.use(['/api/engineer-mappings', '/engineer-mappings'], auth, engineerMappingRoutes);
app.use(['/api/sla-policies', '/sla-policies'], auth, slaRoutes);
app.use(['/api/escalations', '/escalations'], auth, escalationRoutes);
app.use(['/api/docs', '/docs'], express.static(path.join(__dirname, '..', 'docs')));

const AdminController = require(__root + 'controllers/adminController');
app.get(['/api/platform/settings', '/platform/settings'], AdminController.getSettings);

// Deprecated redirects removed (consolidated in route mounting above)

// 404 Handler - must come before error handlers
app.use((req, res, next) => {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.status = 404;
  err.code = 'NOT_FOUND';
  next(err);
});

// IMPORTANT: Error handlers must be last and have 4 parameters (err, req, res, next)
const errorLogger = require(__root + 'middleware/errorLogger');
app.use(errorLogger);

const errorHandler = require(__root + 'middleware/errorHandler');
app.use(errorHandler);

module.exports = server;

function shutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    server.close(() => {
      logger.info('HTTP server closed.');
      try {
        const db = require('./config/db');
        if (db && typeof db.end === 'function') {
          db.end(() => {
            logger.info('DB pool closed. Exiting.');
            process.exit(0);
          });
        } else {
          process.exit(0);
        }
      } catch (e) {
        logger.error('Error during shutdown: ' + (e && e.message));
        process.exit(1);
      }
    });

    setTimeout(() => {
      logger.warn('Forcing shutdown after timeout.');
      process.exit(1);
    }, 10000).unref();
  } catch (e) {
    logger.error('Shutdown failed: ' + (e && e.message));
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Log and attempt graceful shutdown on unhandled errors to avoid orphaned DB connections
process.on('unhandledRejection', (reason, promise) => {
  try {
    const details = (reason && reason.stack) ? String(reason.stack) : String(reason);
    logger.error('Unhandled Rejection: ' + details);
    try { console.error('Unhandled Rejection:', details); } catch (e) { }
    try { fs.appendFileSync(path.join(__root, 'logs', 'error_stacks.log'), `[UNHANDLED_REJECTION] ${new Date().toISOString()}\n${details}\n\n`); } catch (e) { }
  } catch (logErr) {
    logger.error('Unhandled Rejection (failed to serialize): ' + String(logErr));
  }
  try { shutdown('UNHANDLED_REJECTION'); } catch (e) { process.exit(1); }
});

process.on('uncaughtException', (err) => {
  try {
    const details = (err && err.stack) ? String(err.stack) : String(err);
    logger.error('Uncaught Exception: ' + details);
    try { console.error('Uncaught Exception:', details); } catch (e) { }
    try { fs.appendFileSync(path.join(__root, 'logs', 'error_stacks.log'), `[UNCAUGHT_EXCEPTION] ${new Date().toISOString()}\n${details}\n\n`); } catch (e) { }
  } catch (logErr) {
    logger.error('Uncaught Exception (failed to serialize): ' + String(logErr));
  }
  try { shutdown('UNCAUGHT_EXCEPTION'); } catch (e) { process.Exit(1); }
});



