const express = require('express');
const router = express.Router();

const ReportsController = require(__root + 'controllers/Reports');
router.use('/', ReportsController);

module.exports = router;
