const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
require('dotenv').config();

const pool = require('./db/pool');
const smsRoutes = require('./routes/sms');
const queueRoutes = require('./routes/queue');
const analyticsRoutes = require('./routes/analytics');
const { startNoShowWorker } = require('./workers/noShowWorker');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public'));

// API Key middleware for restaurant authentication
const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  req.apiKey = apiKey;
  next();
};

// Attach io to app for use in routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/sms', smsRoutes);
app.use('/api/queue', apiKeyMiddleware, queueRoutes);
app.use('/api/analytics', apiKeyMiddleware, analyticsRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('subscribe', (data) => {
    const { restaurantId } = data;
    if (restaurantId) {
      socket.join(`restaurant:${restaurantId}`);
      console.log(`Socket ${socket.id} subscribed to restaurant ${restaurantId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Broadcast helper functions
global.broadcastQueueUpdate = (restaurantId) => {
  io.to(`restaurant:${restaurantId}`).emit('queue:updated');
};

global.broadcastAnalyticsUpdate = (restaurantId) => {
  io.to(`restaurant:${restaurantId}`).emit('analytics:updated');
};

global.broadcastStatusChange = (restaurantId, data) => {
  io.to(`restaurant:${restaurantId}`).emit('status:changed', data);
};

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Database connection test
const testDatabaseConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('Database connected successfully');
    return true;
  } catch (err) {
    console.error('Database connection failed:', err.message);
    return false;
  }
};

// Start server
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const start = async () => {
  try {
    // Test database connection
    const dbConnected = await testDatabaseConnection();
    if (!dbConnected) {
      console.error('Failed to connect to database. Exiting.');
      process.exit(1);
    }

    // Start no-show worker
    startNoShowWorker();

    // Start server
    server.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════╗
║     SMS Waitlist POC Server Started    ║
╚════════════════════════════════════════╝
Environment: ${NODE_ENV}
Port: ${PORT}
Base URL: http://localhost:${PORT}
Twilio Webhook: POST /sms/inbound
Dashboard: http://localhost:${PORT}
      `);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    pool.end(() => {
      console.log('Database pool closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    pool.end(() => {
      console.log('Database pool closed');
      process.exit(0);
    });
  });
});

start();

module.exports = { app, server, io };