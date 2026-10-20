// Database connection with retry/backoff.
//
// The old implementation called process.exit(1) on the first failed attempt,
// which meant a stopped MongoDB service took the whole API down and the
// Flutter client only ever saw connection timeouts. In development we now
// retry in the background and keep the API up (every DB route returns 503).
//
// In PRODUCTION the opposite is correct: a server that cannot reach its
// database is broken, and PM2 should restart it rather than serve 503s
// forever. So production logs a clear error and exits non-zero.
const mongoose = require('mongoose');

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/chatgram';

const isProd = process.env.NODE_ENV === 'production';
const MAX_RETRIES = Number(process.env.MONGODB_MAX_RETRIES || 5);
const RETRY_DELAY_MS = Number(process.env.MONGODB_RETRY_DELAY_MS || 3000);

// Fail fast instead of buffering commands forever when the DB is unreachable.
mongoose.set('bufferCommands', false);
mongoose.set('strictQuery', true);

// Atlas connection string must never be logged with its password.
const safeUri = MONGODB_URI.replace(/\/\/([^:/@]+):([^@]*)@/, '//$1:****@');

let isConnected = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const HINT = `
Could not reach MongoDB.

  URI: ${safeUri}

Things to check, in order:

  1. MongoDB Atlas → Network Access: is this server's public IP allowed?
     (an Oracle VM needs its own IP added — "0.0.0.0/0" only if you accept
     the risk).

  2. Atlas → Database Access: does the user exist and is the password right?
     If the password contains @ : / ? # [ ] % it MUST be percent-encoded in
     the URI. Example: "p@ss" becomes "p%40ss".

  3. Is the cluster hostname correct and is the cluster not paused?
     Free M0 clusters pause when idle for a long time — open the Atlas UI and
     resume it.

  4. Does the URI include the database name? e.g.
     mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/chatgram

In production this process exits non-zero so PM2 restarts it.
`;

async function connectDB({ exitOnFailure = false } = {}) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const conn = await mongoose.connect(MONGODB_URI, {
        // Give Atlas (TLS handshake + SRV lookup) room to answer.
        serverSelectionTimeoutMS: 10000,
        // A single small VM does not need a big pool; 10 is plenty for one
        // Node process and keeps Atlas M0 comfortably within its limits.
        maxPoolSize: 10,
        minPoolSize: 0,
        // Recycle idle sockets so a paused/resumed cluster reconnects cleanly.
        maxIdleTimeMS: 60000,
        socketTimeoutMS: 0,
      });
      isConnected = true;
      console.log(
        `MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`
      );
      return conn;
    } catch (error) {
      console.error(
        `MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`
      );

      if (attempt === MAX_RETRIES) {
        console.error(HINT);
        // Production: let PM2 restart us rather than serve permanent 503s.
        if (exitOnFailure || isProd) process.exit(1);
        return null;
      }

      await sleep(RETRY_DELAY_MS);
    }
  }
  return null;
}

// Attach connection listeners once.
mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.warn('MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  isConnected = true;
  console.log('MongoDB reconnected');
});

module.exports = connectDB;
module.exports.isDbConnected = () =>
  isConnected && mongoose.connection.readyState === 1;
