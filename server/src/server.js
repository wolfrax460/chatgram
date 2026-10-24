// Server entry point
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dgram = require('dgram');

dotenv.config();

const connectDB = require('./utils/db');
const realtime = require('./utils/realtime');
const { registerSocketHandlers } = require('./sockets/socketHandler');
const { registerSupportGuestNamespace } = require('./sockets/supportGuestSocket');
const mongoose = require('mongoose');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const contactRoutes = require('./routes/contactRoutes');
const chatRoutes = require('./routes/chatRoutes');
const messageRoutes = require('./routes/messageRoutes');
const statusRoutes = require('./routes/statusRoutes');
const appRoutes = require('./routes/appRoutes');
const supportRoutes = require('./routes/supportRoutes');
const supportAccount = require('./utils/supportAccount');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);

// ------------------------------------------------------------------- origin
//
// CLIENT_URL may be a comma-separated list, e.g. a production Vercel URL plus a
// preview URL. Trailing slashes are stripped so `https://x.app/` and
// `https://x.app` behave identically — a trailing slash in CLIENT_URL is one of
// the most common causes of "blocked by CORS policy".
const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);

if (isProd && allowedOrigins.length === 0) {
  console.error(
    '\nFATAL: CLIENT_URL is not set.\n' +
      'In production it must be the exact frontend origin, for example:\n' +
      '  CLIENT_URL=https://your-project.vercel.app\n' +
      '(https, no trailing slash, not a preview URL)\n'
  );
  process.exit(1);
}

/**
 * Origin check shared by REST and Socket.IO.
 *
 *  - **No `Origin` header** → native Android / Windows clients and curl. These
 *    are not browsers, CORS does not apply, and blocking them breaks the apps,
 *    so they are always allowed.
 *  - **Present `Origin`** → in production it must match CLIENT_URL exactly.
 *  - **Development** → everything allowed, because Flutter web picks a random
 *    port on each run.
 */
/**
 * Origins that are safe to allow in every environment.
 *
 * `localhost`/`127.0.0.1` can only be reached from the developer's own machine,
 * and `capacitor://localhost` / `https://localhost` are the fixed origins that
 * Capacitor's Android and iOS shells serve from. Electron loads the hosted URL,
 * so it needs no extra entry.
 */
function isAlwaysAllowedOrigin(origin) {
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  if (origin === 'capacitor://localhost') return true;
  if (origin === 'https://localhost') return true;
  return false;
}

function originAllowed(origin) {
  if (allowedOrigins.includes(origin)) return true;
  return isAlwaysAllowedOrigin(origin);
}

function corsOrigin(origin, callback) {
  if (!isProd) return callback(null, true);
  if (!origin) return callback(null, true); // native clients / same-origin
  if (originAllowed(origin)) return callback(null, true);

  // Passing `false` omits the CORS headers (the browser reports it) without
  // turning a normal request into a 500.
  console.warn(`CORS: blocked origin ${origin}`);
  return callback(null, false);
}

const io = socketIo(server, {
  cors: {
    origin: isProd ? (origin, cb) => cb(null, !origin || originAllowed(origin)) : true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Long-polling fallback first for proxies that are slow to upgrade; the
  // client negotiates up to WebSocket automatically.
  transports: ['websocket', 'polling'],
  // Nginx keeps the connection open for 24h (see deploy/nginx config), so keep
  // the heartbeat well inside any idle timeout.
  pingInterval: 25000,
  pingTimeout: 20000,
});

realtime.setIo(io);
registerSupportGuestNamespace(io);

// Connect to MongoDB (non-fatal: the API stays up and reports 503 instead of
// the whole process exiting, which is what previously black-holed the client).
//
// Once the database is up, make sure the built-in support account exists so
// users always have somewhere to report bugs and request changes.
connectDB().then(() => {
  if (mongoose.connection.readyState !== 1) return;
  supportAccount
    .ensureSupportUser()
    .catch((error) => console.error('Support account setup failed:', error.message));

  // Statuses expire after 24h; this removes the stored files too, which a Mongo
  // TTL index alone cannot do.
  try {
    require('./utils/statusCleanup').startStatusCleanup();
  } catch (error) {
    console.warn('Status cleanup could not start:', error.message);
  }

  // Help-centre articles (idempotent upsert from articles.seed.json).
  require('./help/seed')
    .seedHelpCentre()
    .catch((error) => console.warn('Help centre seeding failed:', error.message));
});

// ---------------------------------------------------------------- middleware
// Behind nginx: trust exactly one proxy hop so req.ip / req.protocol and
// rate-limiting see the real client address from X-Forwarded-For.
app.set('trust proxy', 1);

// `cors` answers OPTIONS preflight automatically for every route.
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    maxAge: 86400,
  })
);
app.use(
  helmet({
    // Flutter web runs on a different origin than the API; without this the
    // browser refuses to load avatars/media served from /uploads.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files statically. The root comes from the upload helper so it
// honours UPLOAD_DIR (persistent volume) — otherwise this would serve a
// different directory than multer writes to.
app.use(
  '/uploads',
  express.static(require('./utils/upload').UPLOAD_ROOT, {
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  })
);

// ------------------------------------------------------------------- routes
//
// If the Flutter web app has been built, this server also hosts it. That makes
// `http://<your-ip>:5001/` a complete, shareable app: one origin for the UI,
// the REST API, the media files and Socket.IO — so there is no CORS to fight
// and no need to rebuild the client for each machine.
const WEB_BUILD_DIR = path.join(__dirname, '..', '..', 'client', 'build', 'web');
const WEB_INDEX = path.join(WEB_BUILD_DIR, 'index.html');
const hasWebBuild = fs.existsSync(WEB_INDEX);

if (hasWebBuild) {
  app.use(express.static(WEB_BUILD_DIR, { index: 'index.html' }));
  console.log(`Serving Flutter web app from ${WEB_BUILD_DIR}`);
}

app.get('/api', (req, res) => {
  res.json({ message: 'Chatgram API is running', version: '1.0.0' });
});

// Kept for backwards compatibility when the web build is absent.
app.get('/', (req, res, next) => {
  if (hasWebBuild) return next();
  res.json({ message: 'Chatgram API is running', version: '1.0.0' });
});

// Plain liveness probe for nginx / uptime monitors / certbot hooks.
// Deliberately needs no database so a monitoring system can tell "the process
// is up" apart from "the database is down" (that is /api/health).
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/health', (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({
    status: dbUp ? 'ok' : 'degraded',
    database: dbUp ? 'connected' : 'disconnected',
    onlineUsers: realtime.onlineUserIds().length,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Public client configuration. The app uses this to adapt its UI — e.g. to
// require verification before sign-up, or to hide delivery options when no
// mail/SMS provider is configured. Deliberately needs no database.
app.get('/api/config', (req, res) => {
  const { activeProviders } = require('./utils/notifier');
  const google = require('./utils/googleOAuth');
  res.json({
    verificationRequired: String(process.env.REQUIRE_VERIFICATION || 'false') === 'true',
    providers: {
      email: activeProviders.email,
      sms: activeProviders.sms,
    },
    // "Sign in with Google" — the app hides the button when this is false.
    google: {
      enabled: google.isConfigured(),
      redirectUri: google.isConfigured() ? google.redirectUri() : null,
    },
    // Help & feedback: the app shows a "Contact support" entry when enabled.
    support: supportAccount.supportProfile(),
    // True when codes are handed back to the client instead of being delivered.
    showCodesInResponse:
      process.env.DEV_SHOW_CODES !== undefined
        ? process.env.DEV_SHOW_CODES === 'true'
        : process.env.NODE_ENV !== 'production',
  });
});

// Every DB-backed route returns a clear 503 while Mongo is unreachable.
app.use('/api', (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      message:
        'Database unavailable. Start MongoDB (Start-Service MongoDB, or run mongod directly) and retry.',
      code: 'DB_UNAVAILABLE',
    });
  }
  return next();
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/calls', require('./routes/callRoutes'));
app.use('/api/messages', messageRoutes);

// Health details for the help widget's Status card. NOTE: `/api/status` is the
// existing statuses (stories) feed, so the health endpoint lives under it.
app.get('/api/status/health', require('./help/controller').getServiceStatus);

app.use('/api/status', statusRoutes);
app.use('/api/app', appRoutes);
app.use('/api/help', require('./help'));
app.use('/api/support', supportRoutes);
app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/admin/providers', require('./routes/adminProviderRoutes'));
app.use('/api/admin/ai', require('./routes/adminAiRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

// SPA fallback: any non-API GET that did not match a file returns index.html so
// client-side routes (e.g. /chat/<id>) survive a refresh or a shared link.
if (hasWebBuild) {
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    return res.sendFile(WEB_INDEX);
  });
}

app.use(notFound);
app.use(errorHandler);

// ------------------------------------------------------------------ sockets
registerSocketHandlers(io);

module.exports = { app, server, io };

const PORT = Number(process.env.PORT) || 5000;

server.listen(PORT, () => {
  // The verbose LAN banner is a local-development convenience; in production
  // nginx is the only public entry and the output just fills journald.
  if (isProd) {
    console.log(`Chatgram API listening on port ${PORT} (production)`);
    console.log(`Health: http://127.0.0.1:${PORT}/health`);
    console.log(`Allowed origins: ${allowedOrigins.join(', ') || '(none)'}`);
  } else {
    logStartup();
  }
});

/** Close sockets, then the HTTP server, then Mongo. PM2 sends SIGTERM. */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — shutting down gracefully…`);

  // Hard deadline so a stuck connection cannot hold the process forever.
  const force = setTimeout(() => {
    console.error('Forced exit after 10s.');
    process.exit(1);
  }, 10000);
  force.unref();

  io.close();
  server.close(async () => {
    try {
      await mongoose.connection.close();
    } catch (error) {
      console.error('Error closing MongoDB connection:', error.message);
    }
    clearTimeout(force);
    console.log('Shutdown complete.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * Work out which local address a friend should actually use to reach us.
 *
 * A `udp4` socket "connect" does not send any packets — it just asks the OS
 * which local interface it would route through, which is exactly the address
 * that is reachable from the LAN. This avoids listing VMware/VirtualBox/WSL
 * adapters (whose names and IP ranges vary) as if they were usable.
 */
function primaryLanAddress() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve(value);
    };

    let socket;
    try {
      socket = dgram.createSocket('udp4');
      socket.once('error', () => done(null));
      socket.connect(53, '8.8.8.8', () => {
        const addr = socket.address();
        done(addr && addr.address ? addr.address : null);
      });
      setTimeout(() => done(null), 1500);
    } catch {
      done(null);
    }
  });
}

async function logStartup() {
  console.log(`\nChatgram API listening on port ${PORT}`);

  const VIRTUAL_ADAPTER =
    /vmware|virtualbox|vethernet|hyper-v|wsl|loopback|docker|tailscale|zerotier|npcap|bluetooth/i;

  const others = Object.entries(os.networkInterfaces())
    .filter(([name]) => !VIRTUAL_ADAPTER.test(name))
    .flatMap(([, addrs]) => addrs || [])
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

  const primary = await primaryLanAddress();

  console.log('');
  console.log(`  This computer : http://localhost:${PORT}`);

  if (primary) {
    console.log(`  Share this    : http://${primary}:${PORT}`);
  } else {
    console.log('  Share this    : (could not detect a LAN address — check your Wi-Fi)');
  }

  const extra = others.filter((ip) => ip !== primary);
  if (extra.length) {
    console.log(`  Other adapters: ${extra.map((ip) => `http://${ip}:${PORT}`).join(', ')}`);
  }

  console.log('');
  console.log(`  Health check  : http://localhost:${PORT}/api/health`);
  console.log(
    hasWebBuild
      ? '\n  Anyone on the same Wi-Fi can open the shared address above — it\n' +
        '  serves the app, the API and realtime messaging from one origin.'
      : '\n  No Flutter web build found; run `flutter build web` in client/ to\n' +
        '  serve the app from here too.'
  );
  console.log('');
}

// Never die silently.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
