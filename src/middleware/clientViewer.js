const db = require('../db');

module.exports = async function clientViewerMiddleware(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'Client-Viewer') return next();
    const userId = req.user._id;
    if (!userId) return res.status(401).json({ message: 'Invalid viewer user' });
    const sql = 'SELECT client_id FROM client_viewers WHERE user_id = ? LIMIT 1';
    db.query(sql, [userId], (err, rows) => {
      if (err) return res.status(500).json({ message: 'DB error resolving viewer mapping', error: err.message });
      if (!rows || rows.length === 0) return res.status(403).json({ message: 'Viewer not mapped to any client' });
      req.viewerClientId = rows[0].client_id;
      return next();
    });
  } catch (e) {
    return res.status(500).json({ message: 'Internal error resolving viewer mapping', error: e.message });
  }
};
