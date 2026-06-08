function success(res, data = null, message = 'OK', status = 200) {
  const payload = { success: true, message };
  if (data !== undefined) payload.data = data;
  return res.status(status).json(payload);
}

function fail(res, message = 'Error', status = 400, details = null) {
  const payload = { success: false, message };
  if (details) payload.details = details;
  return res.status(status).json(payload);
}

module.exports = { success, fail };
