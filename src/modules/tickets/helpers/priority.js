const VALID_PRIORITIES = ['Low', 'Medium', 'High'];

function normalizePriority(priority) {
  if (!priority) return null;
  const value = String(priority).trim().toLowerCase();
  if (value === 'low') return 'Low';
  if (value === 'medium') return 'Medium';
  if (value === 'high') return 'High';
  return null;
}

function detectPriority(title = '', body = '') {
  const text = `${title} ${body}`.toLowerCase();

  if (/\b(urgent|critical|crit|sev1|sev 1|p1|production down|outage|immediately|asap)\b/.test(text)) {
    return 'High';
  }

  if (/\b(low priority|minor|whenever possible|no rush)\b/.test(text)) {
    return 'Low';
  }

  return 'Medium';
}

module.exports = {
  VALID_PRIORITIES,
  normalizePriority,
  detectPriority,
};
