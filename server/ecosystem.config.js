/**
 * PM2 process definition for the Chatgram API.
 *
 * Run from the repository root on the server:
 *     pm2 start server/ecosystem.config.js
 * or from inside server/:
 *     pm2 start ecosystem.config.js
 *
 * PM2 is only a process supervisor here; nginx is the public entry point.
 */
module.exports = {
  apps: [
    {
      name: 'chatgram-api',

      // __dirname is server/, so this resolves to server/src/server.js
      script: 'src/server.js',
      cwd: __dirname,

      // One process only. The VM has 1 GB of RAM and Socket.IO needs a single
      // in-memory presence/room map — never switch this to cluster mode.
      instances: 1,
      exec_mode: 'fork',

      // ---------------------------------------------------------- lifecycle
      autorestart: true,
      // Restart if the heap grows past this. Node is lazy, so a healthy idle
      // process sits far below it; hitting 500M means a real leak or overload.
      max_memory_restart: '500M',
      // Give up (and stay down) only if it crashes 10 times in quick
      // succession — usually a bad .env or an unreachable database.
      max_restarts: 10,
      min_uptime: '20s',
      restart_delay: 3000,
      // Must be >= the graceful-shutdown deadline in src/server.js (10s), so
      // PM2 sends SIGTERM and waits for sockets to drain before SIGKILL.
      kill_timeout: 10000,

      // Never watch files in production (restarts on every log write).
      watch: false,

      // ---------------------------------------------------------- environment
      env: {
        NODE_ENV: 'production',
      },

      // Logs land in ~/.pm2/logs/chatgram-api-*.log by default.
      merge_logs: true,
      time: true,
    },
  ],
};
