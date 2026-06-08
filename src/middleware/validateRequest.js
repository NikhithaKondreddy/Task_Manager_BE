const { validationResult } = require('express-validator');
const HttpError = require('../errors/HttpError');

module.exports = function (req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const extracted = errors.array().map(err => ({ param: err.param, msg: err.msg }));
  return next(new HttpError(422, 'Validation failed', 'VALIDATION_ERROR', extracted));
};
