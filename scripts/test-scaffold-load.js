// Simple smoke-load script to check new scaffolds do not throw at require-time
try {
  require('../src/modules/comments/controllers/commentController');
  require('../src/modules/comments/services/commentService');
  require('../src/modules/comments/repositories/commentRepository');
  require('../src/modules/comments/routes/commentRoutes');

  require('../src/modules/attachments/controllers/attachmentController');
  require('../src/modules/attachments/services/attachmentService');
  require('../src/modules/attachments/repositories/attachmentRepository');
  require('../src/modules/attachments/routes/attachmentRoutes');

  console.log('Scaffold modules loaded successfully');
  process.exit(0);
} catch (err) {
  console.error('Error loading scaffold modules:', err);
  process.exit(2);
}
