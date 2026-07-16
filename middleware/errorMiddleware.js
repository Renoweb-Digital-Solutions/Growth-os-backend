// Reason: Centralized error handling prevents redundant error logic in every route and ensures a standard response format.
// How: This middleware catches any errors passed to `next()` and formats them based on the current environment (hiding stack traces in production).
const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  
  res.status(statusCode).json({
    message: err.message,
    // Only show stack trace if we are not in production
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
};

module.exports = { errorHandler };
