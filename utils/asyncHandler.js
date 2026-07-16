// Reason: Using an async handler eliminates the need to wrap every single async controller function in a try/catch block.
// How: It takes an async function as an argument, executes it, and passes any caught errors directly to the Express `next` function (which forwards to our errorHandler).
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
