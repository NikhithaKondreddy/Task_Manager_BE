const db = require('../db');

const DEFAULT_GENERAL_SETTINGS = {
  site_name: 'Nivara Task Manager',
  email_id: 'support@nivarahousing.com',
  support_email: 'support@nivarahousing.com',
  timezone: 'Asia/Kolkata',
  logo_url: null,
  timestamps: null
};

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function scopedSettingKey(settingKey, tenantId) {
  const scope = tenantId === undefined || tenantId === null ? 'global' : `tenant:${tenantId}`;
  return `${scope}:${settingKey}`;
}

function legacySettingKeys(settingKey) {
  return [settingKey, `global:${settingKey}`];
}

async function loadSettings(tenantId) {
  const rows = await q(
    `
      SELECT tenant_id, setting_key, setting_value
      FROM platform_settings
      WHERE tenant_id = ?
         OR tenant_id IS NULL
         OR setting_key IN (?,?,?,?,?,?,?,?,?,?,?,?)
    `,
    [
      tenantId || null,
      ...legacySettingKeys('site_name'),
      ...legacySettingKeys('email_id'),
      ...legacySettingKeys('support_email'),
      ...legacySettingKeys('timezone'),
      ...legacySettingKeys('logo_url'),
      ...legacySettingKeys('timestamps')
    ]
  ).catch(() => []);

  const settings = {
    general: { ...DEFAULT_GENERAL_SETTINGS }
  };

  const priorityKeys = [
    scopedSettingKey('site_name', tenantId),
    scopedSettingKey('email_id', tenantId),
    scopedSettingKey('support_email', tenantId),
    scopedSettingKey('timezone', tenantId),
    scopedSettingKey('logo_url', tenantId),
    scopedSettingKey('timestamps', tenantId),
    'site_name',
    'email_id',
    'support_email',
    'timezone',
    'logo_url',
    'timestamps',
    'global:site_name',
    'global:email_id',
    'global:support_email',
    'global:timezone',
    'global:logo_url',
    'global:timestamps'
  ];

  for (const key of priorityKeys) {
    const row = (rows || []).find((item) => item.setting_key === key);
    if (!row) continue;
    const normalizedKey = key.split(':').pop();
    settings.general[normalizedKey] = row.setting_value;
  }

  return settings;
}

async function saveSettings(tenantId, updates = {}) {
  const allowedKeys = ['site_name', 'email_id', 'support_email', 'timezone', 'logo_url', 'timestamps'];
  const entries = Object.entries(updates).filter(([key, value]) => allowedKeys.includes(key) && value !== undefined);

  for (const [key, value] of entries) {
    const settingKey = scopedSettingKey(key, tenantId);
    await q(
      `
        INSERT INTO platform_settings (tenant_id, setting_key, setting_value, module_key, is_core)
        VALUES (?, ?, ?, 'general', 0)
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
      `,
      [tenantId || null, settingKey, value]
    );
  }

  return loadSettings(tenantId);
}

module.exports = {
  DEFAULT_GENERAL_SETTINGS,
  scopedSettingKey,
  loadSettings,
  saveSettings
};
