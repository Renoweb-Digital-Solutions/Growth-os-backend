// Reason: We need a centralized, secure server entry point for the backend.
// How: This file initializes Express, sets up core security/logging middleware, connects to MongoDB, and registers routes.
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { errorHandler } = require('./middleware/errorMiddleware');
const authRoutes = require('./routes/auth');
const onboardingRoutes = require('./routes/onboarding');
const userRoutes = require('./routes/userRoutes');
const metaRoutes = require('./routes/metaRoutes');

// Ensure critical environment variables exist
if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
  console.error("FATAL ERROR: Missing critical environment variables (MONGODB_URI or JWT_SECRET).");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;

// Security & Standard Middleware
// Reason: helmet sets various HTTP headers to secure the app, morgan logs requests for observability, and cors allows frontend communication.
app.use(helmet());
app.use(cors());
app.use(express.json());

// In production, we log compactly. In dev, we use 'dev' format.
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate Limiting
// Reason: Protects the API against brute-force attacks and DDoS by limiting requests per IP.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
});
app.use('/api', limiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/users', userRoutes);

app.use('/api/meta', (req, res, next) => {
  const reqId = Math.random().toString(36).substring(2, 9);
  req.metaReqId = reqId;
  console.log(`[API] requestId=${reqId} route=${req.method} ${req.originalUrl} timestamp=${new Date().toISOString()}`);
  next();
}, metaRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'GrowthOS API is running safely' });
});

// Global Error Handler
// Reason: Must be registered after all routes/middleware so it catches unhandled errors.
app.use(errorHandler);

// Database connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });
