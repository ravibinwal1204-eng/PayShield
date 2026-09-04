// Centralized error handler. No auth/roles involved — just consistent JSON errors.
function errorHandler(err, req, res, next) {
  console.error('[Error]', err.message);

  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Duplicate key error',
      details: err.keyValue
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      details: err.message
    });
  }

  return res.status(500).json({
    success: false,
    message: 'Internal server error',
    details: process.env.NODE_ENV === 'production' ? undefined : err.message
  });
}

module.exports = errorHandler;
