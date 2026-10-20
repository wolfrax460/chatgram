// Central error handling middleware
const multer = require('multer');

const errorHandler = (err, req, res, next) => {
  // Multer (file upload) failures are client errors, not 500s.
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large (maximum 10MB)'
        : `Upload error: ${err.message}`;
    return res.status(status).json({ message, code: err.code });
  }

  if (err && err.name === 'ValidationError') {
    return res.status(400).json({
      message: 'Invalid input data',
      errors: Object.values(err.errors || {}).map((e) => e.message),
    });
  }

  if (err && err.name === 'CastError') {
    return res.status(400).json({ message: `Invalid ${err.path}` });
  }

  if (err && err.code === 11000) {
    return res.status(400).json({ message: 'Duplicate value', keys: err.keyValue });
  }

  // Errors that carry their own HTTP status (e.g. the multer `fileFilter`
  // rejects a disallowed MIME type with status 400). Without this they fell
  // through to the generic handler and surfaced as a 500.
  if (err && (err.status || err.statusCode)) {
    const status = err.status || err.statusCode;
    if (status >= 400 && status < 600) {
      return res.status(status).json({
        message: err.message || 'Request failed',
        ...(err.code ? { code: err.code } : {}),
      });
    }
  }

  console.error(err && err.stack ? err.stack : err);

  const statusCode = res.statusCode && res.statusCode >= 400 ? res.statusCode : 500;
  res.status(statusCode).json({
    message: (err && err.message) || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && err && err.stack ? { stack: err.stack } : {}),
  });
};

// 404 fallback for unknown API routes.
const notFound = (req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
};

module.exports = { errorHandler, notFound };
