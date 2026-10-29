// Reason: Resilient Redis caching and distributed locking service for X Analytics cost control.
// How: Implements account-isolated keys (growth_os:x:snapshot:<connectionId>:<YYYY-MM-DD>), distributed single-flight
// locking (growth_os:x:lock:<connectionId>), and automatic fallback to in-memory cache and locks if Redis is offline or unconfigured.

const Redis = require('ioredis');

const KEY_PREFIX = 'growth_os:x';
const DEFAULT_SNAPSHOT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const DEFAULT_LOCK_TTL_MS = 60 * 1000; // 60 seconds

// In-memory fallbacks when Redis is unconfigured or temporarily offline
const memoryCache = new Map();
const memoryLocks = new Map();
const inFlightOperations = new Map();

let redisClient = null;
let isRedisConnected = false;

// Initialize Redis only if REDIS_URL or REDIS_HOST is explicitly configured
if (process.env.REDIS_URL || process.env.REDIS_HOST) {
  try {
    const redisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      retryStrategy: (times) => {
        // Linear backoff capped at 10 seconds
        return Math.min(times * 1000, 10000);
      },
    };

    redisClient = process.env.REDIS_URL
      ? new Redis(process.env.REDIS_URL, redisOptions)
      : new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || 6379, 10),
          password: process.env.REDIS_PASSWORD || undefined,
          ...redisOptions,
        });

    redisClient.on('connect', () => {
      isRedisConnected = true;
      console.log('[REDIS] Connected to Redis server successfully');
    });

    redisClient.on('ready', () => {
      isRedisConnected = true;
    });

    redisClient.on('error', (err) => {
      isRedisConnected = false;
      // Do not throw unhandled exception on connection refusal; fallback to in-memory
      console.log(`[REDIS] Connection error (${err.message}) - operating in fallback mode`);
    });

    redisClient.on('close', () => {
      isRedisConnected = false;
    });

    // Attempt initial connection asynchronously without blocking server startup
    redisClient.connect().catch((err) => {
      console.log(`[REDIS] Initial connection failed (${err.message}) - in-memory fallback active`);
    });
  } catch (err) {
    console.log(`[REDIS] Initialization error (${err.message}) - in-memory fallback active`);
    redisClient = null;
    isRedisConnected = false;
  }
}

/**
 * Builds account-isolated snapshot cache key
 */
const getSnapshotKey = (connectionId, dateStr) => {
  return `${KEY_PREFIX}:snapshot:${String(connectionId)}:${dateStr}`;
};

/**
 * Builds account-isolated distributed lock key
 */
const getLockKey = (connectionId) => {
  if (String(connectionId).startsWith(KEY_PREFIX) || String(connectionId).startsWith('lock:')) {
    return String(connectionId);
  }
  return `${KEY_PREFIX}:lock:${String(connectionId)}`;
};

/**
 * Generic key getter supporting Redis and in-memory fallback
 */
const get = async (key) => {
  if (isRedisConnected && redisClient) {
    try {
      const raw = await redisClient.get(key);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      // Fall through to memoryCache
    }
  }

  if (memoryCache.has(key)) {
    const entry = memoryCache.get(key);
    if (Date.now() < entry.expiresAt) {
      return entry.data;
    }
    memoryCache.delete(key);
  }
  return null;
};

/**
 * Generic key setter supporting Redis and in-memory fallback
 */
const set = async (key, data, ttlSeconds = DEFAULT_SNAPSHOT_TTL_SECONDS) => {
  memoryCache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  if (isRedisConnected && redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(data), 'EX', ttlSeconds);
    } catch (err) {
      console.log(`[REDIS] Set error for key ${key}: ${err.message}`);
    }
  }
};

/**
 * Generic key deleter
 */
const del = async (key) => {
  memoryCache.delete(key);
  if (isRedisConnected && redisClient) {
    try {
      await redisClient.del(key);
    } catch (err) {}
  }
};

/**
 * Pattern-based deleter
 */
const delPattern = async (pattern) => {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  for (const k of memoryCache.keys()) {
    if (regex.test(k)) {
      memoryCache.delete(k);
    }
  }
  if (isRedisConnected && redisClient) {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch (err) {}
  }
};

/**
 * Retrieves cached snapshot for an account on a specific date
 */
const getSnapshot = async (connectionId, dateStr) => {
  const key = getSnapshotKey(connectionId, dateStr);

  if (isRedisConnected && redisClient) {
    try {
      const data = await redisClient.get(key);
      if (data) {
        return JSON.parse(data);
      }
    } catch (err) {
      console.log(`[REDIS] Get error for key ${key}: ${err.message} - checking memory fallback`);
    }
  }

  // Fallback to in-memory cache
  if (memoryCache.has(key)) {
    const entry = memoryCache.get(key);
    if (Date.now() < entry.expiresAt) {
      return entry.data;
    }
    memoryCache.delete(key);
  }

  return null;
};

/**
 * Stores snapshot in cache with explicit TTL
 */
const setSnapshot = async (connectionId, dateStr, snapshotData, ttlSeconds = DEFAULT_SNAPSHOT_TTL_SECONDS) => {
  const key = getSnapshotKey(connectionId, dateStr);

  // Always populate in-memory fallback
  memoryCache.set(key, {
    data: snapshotData,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  if (isRedisConnected && redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(snapshotData), 'EX', ttlSeconds);
    } catch (err) {
      console.log(`[REDIS] Set error for key ${key}: ${err.message}`);
    }
  }
};

/**
 * Invalidates cached snapshots for a connection (e.g. upon disconnect)
 */
const invalidateConnectionCache = async (connectionId) => {
  const idStr = String(connectionId);

  // Clear in-memory keys matching connection
  for (const key of memoryCache.keys()) {
    if (key.includes(`:${idStr}:`)) {
      memoryCache.delete(key);
    }
  }

  if (isRedisConnected && redisClient) {
    try {
      const pattern = `${KEY_PREFIX}:snapshot:${idStr}:*`;
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch (err) {
      console.log(`[REDIS] Invalidation error for connection ${idStr}: ${err.message}`);
    }
  }
};

/**
 * Acquires a distributed single-flight lock for an account refresh
 * Prevents concurrent cache misses from triggering duplicate API calls
 */
const acquireLock = async (connectionId, ttlMs = DEFAULT_LOCK_TTL_MS) => {
  const key = getLockKey(connectionId);
  const token = Math.random().toString(36).substring(2, 15);

  if (isRedisConnected && redisClient) {
    try {
      // SET key token PX ttlMs NX (atomic check-and-set)
      const result = await redisClient.set(key, token, 'PX', ttlMs, 'NX');
      if (result === 'OK') {
        return token;
      }
      return null;
    } catch (err) {
      console.log(`[REDIS] Lock acquisition error: ${err.message} - using memory lock`);
    }
  }

  // In-memory lock fallback
  const now = Date.now();
  if (memoryLocks.has(key)) {
    const existing = memoryLocks.get(key);
    if (now < existing.expiresAt) {
      return null; // Lock held
    }
  }

  memoryLocks.set(key, {
    token,
    expiresAt: now + ttlMs,
  });

  return token;
};

/**
 * Releases a distributed lock using its acquisition token
 */
const releaseLock = async (connectionId, token = null) => {
  const key = getLockKey(connectionId);

  // Release memory lock
  if (memoryLocks.has(key)) {
    const lock = memoryLocks.get(key);
    if (!token || lock.token === token) {
      memoryLocks.delete(key);
    }
  }

  if (isRedisConnected && redisClient) {
    try {
      if (token) {
        // Atomic Lua script: delete only if current value matches token
        const luaScript = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        await redisClient.eval(luaScript, 1, key, token);
      } else {
        await redisClient.del(key);
      }
    } catch (err) {
      console.log(`[REDIS] Lock release error: ${err.message}`);
    }
  }
  return true;
};

/**
 * Single-flight wrapper: deduplicates concurrent in-process calls for the same connection
 */
const executeSingleFlight = (connectionId, operationFn) => {
  const key = String(connectionId);
  if (inFlightOperations.has(key)) {
    return inFlightOperations.get(key);
  }

  const promise = (async () => {
    try {
      return await operationFn();
    } finally {
      inFlightOperations.delete(key);
    }
  })();

  inFlightOperations.set(key, promise);
  return promise;
};

/**
 * Health check helper returning active cache engine state
 */
const getCacheStatus = () => {
  return {
    redisConfigured: Boolean(process.env.REDIS_URL || process.env.REDIS_HOST),
    redisConnected: isRedisConnected,
    engine: isRedisConnected ? 'redis' : 'in_memory_fallback',
    memoryKeysCount: memoryCache.size,
  };
};

module.exports = {
  getSnapshotKey,
  getLockKey,
  getSnapshot,
  setSnapshot,
  invalidateConnectionCache,
  acquireLock,
  releaseLock,
  executeSingleFlight,
  getCacheStatus,
  get,
  set,
  del,
  delPattern,
};
