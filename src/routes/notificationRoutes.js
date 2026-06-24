const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');

router.get('/', notificationController.getNotifications);
router.patch('/:id/read', notificationController.markAsRead);
router.patch('/read-all', notificationController.markAllAsRead);
router.delete('/:id', notificationController.deleteNotification);

// Admin cleanup endpoints
router.get('/cleanup-stats', notificationController.getCleanupStats);
router.get('/pending-cleanup', notificationController.getPendingCleanup);
router.post('/cleanup', notificationController.cleanup);

module.exports = router;