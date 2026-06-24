function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(operation, options = {}) {
  const attempts = Number(options.attempts || 3);
  const delayMs = Number(options.delayMs || 1000);
  const factor = Number(options.factor || 2);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      if (typeof options.onRetry === 'function') {
        options.onRetry(error, attempt);
      }
      await sleep(delayMs * Math.pow(factor, attempt - 1));
    }
  }

  throw lastError;
}

module.exports = retry;
