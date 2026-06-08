const db = require('../db');

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

const DEFAULT_PREFERENCES = {
  channels: {
    in_app: true,
    email: true,
    sms: false,
  },
  events: {
    ticket_created: true,
    ticket_assigned: true,
    ticket_updated: true,
    ticket_commented: true,
    ticket_closed: true,
    ticket_escalated: true,
  },
  enabled: true,
};

async function getPreferences(tenantId, userId) {
  const rows = await q(
    'SELECT channels_json, events_json, is_enabled FROM notification_preferences WHERE tenant_id = ? AND user_id = ? LIMIT 1',
    [tenantId, userId]
  );
  if (!rows || rows.length === 0) {
    return { ...DEFAULT_PREFERENCES };
  }
  let channels = DEFAULT_PREFERENCES.channels;
  let events = DEFAULT_PREFERENCES.events;
  try {
    channels = rows[0].channels_json ? JSON.parse(rows[0].channels_json) : DEFAULT_PREFERENCES.channels;
  } catch (e) {
    channels = DEFAULT_PREFERENCES.channels;
  }
  try {
    events = rows[0].events_json ? JSON.parse(rows[0].events_json) : DEFAULT_PREFERENCES.events;
  } catch (e) {
    events = DEFAULT_PREFERENCES.events;
  }
  return {
    channels,
    events,
    enabled: Boolean(rows[0].is_enabled),
  };
}

async function updatePreferences(tenantId, userId, payload = {}) {
  const channels = payload.channels || payload.channelPreferences || DEFAULT_PREFERENCES.channels;
  const events = payload.events || payload.eventPreferences || DEFAULT_PREFERENCES.events;
  const enabled = payload.enabled === undefined ? true : Boolean(payload.enabled);

  await q(
    `
      INSERT INTO notification_preferences (tenant_id, user_id, channels_json, events_json, is_enabled)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        channels_json = VALUES(channels_json),
        events_json = VALUES(events_json),
        is_enabled = VALUES(is_enabled)
    `,
    [tenantId, userId, JSON.stringify(channels), JSON.stringify(events), Number(enabled)]
  );

  return { channels, events, enabled };
}

module.exports = {
  getPreferences,
  updatePreferences,
};
