class HttpError extends Error {
  constructor(status = 500, message = 'Internal Server Error', code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      message: this.message,
      code: this.code,
      details: this.details
    };
  }
}

module.exports = HttpError;
