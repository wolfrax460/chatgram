/**
 * Read-only host diagnostics for the admin "System health" page.
 *
 * Security model (this file is deliberately boring — that is the point):
 *  - The API process already runs on the production VM under PM2, so these
 *    commands execute locally. No SSH key, no remote shell, nothing to leak.
 *  - There is NO user-controlled command line. Each check is a fixed binary +
 *    argument vector declared below. A request can only choose a check id; any
 *    other value is rejected by isKnownCheck().
 *  - We use execFile (never exec / shell: true), so arguments are never
 *    interpreted by a shell and cannot be used for injection.
 *  - Every command has a hard timeout, a bounded output buffer and a capped
 *    response size.
 *  - Output is scrubbed for credentials before it leaves the server.
 *  - The controller audits every run (who, when, which check).
 *
 * To add a check, add a fixed entry to CHECKS. Never interpolate request data.
 */
const { execFile } = require('node:child_process');

const MAX_BUFFER = 256 * 1024; // 256 KB read from the process
const MAX_OUTPUT = 32 * 1024; // 32 KB returned to the browser
const DEFAULT_TIMEOUT_MS = 10_000;

/** Patterns that must never reach the admin UI, even by accident. */
const SECRET_LINE = /(mongodb(\+srv)?:\/\/|JWT_SECRET|TURN_SECRET|ADMIN_PANEL_PASSWORD|SMTP_|CLOUDINARY_|API_KEY|SECRET_KEY|PASSWORD=|PRIVATE KEY|authorization:)/i;
const SECRET_TOKEN = /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;

function scrub(text) {
  if (!text) return '';
  return String(text)
    .split(/\r?\n/)
    .map((line) => (SECRET_LINE.test(line) ? '[redacted: line contained a credential pattern]' : line.replace(SECRET_TOKEN, '[redacted]')))
    .join('\n');
}

function trim(text) {
  const cleaned = scrub(text).replace(/\u001b\[[0-9;]*m/g, ''); // strip ANSI colours
  if (cleaned.length <= MAX_OUTPUT) return { text: cleaned, truncated: false };
  return { text: `${cleaned.slice(0, MAX_OUTPUT)}\n… output truncated …`, truncated: true };
}

/** Run a fixed binary with a fixed argv. Never a shell. */
function run(bin, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const env = {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME || '/root',
      LANG: 'C',
      LC_ALL: 'C',
    };
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: MAX_BUFFER, env, windowsHide: true }, (error, stdout, stderr) => {
      const timedOut = Boolean(error && (error.killed || error.signal === 'SIGTERM'));
      resolve({
        ok: !error,
        code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        timedOut,
        stdout: stdout || '',
        stderr: stderr || '',
      });
    });
  });
}

const home = () => process.env.HOME || '/root';

/**
 * The allowlist. Every entry is a constant command; nothing is derived from
 * the request except the id used to look the entry up here.
 */
const CHECKS = {
  disk: {
    label: 'Disk space',
    description: 'Free and used space on the root filesystem (df -h /).',
    category: 'storage',
    command: () => run('df', ['-h', '/']),
  },
  app_space: {
    label: 'Space used by the app',
    description: 'Size of the app, backups and uploads directories.',
    category: 'storage',
    command: async () => {
      const results = [];
      for (const dir of [`${home()}/chatgram`, `${home()}/chatgram-backups`]) {
        const part = await run('du', ['-sh', dir], 15_000);
        results.push(part.stdout || part.stderr);
      }
      return { ok: true, code: 0, timedOut: false, stdout: results.join('\n'), stderr: '' };
    },
  },
  memory: {
    label: 'Memory',
    description: 'RAM and swap in megabytes (free -m).',
    category: 'host',
    command: () => run('free', ['-m']),
  },
  load: {
    label: 'Load and uptime',
    description: 'System load average and how long the VM has been up (uptime).',
    category: 'host',
    command: () => run('uptime'),
  },
  services: {
    label: 'System services',
    description: 'Whether nginx and coturn are running (systemctl is-active).',
    category: 'host',
    command: () => run('systemctl', ['is-active', 'nginx', 'coturn']),
  },
  ports: {
    label: 'Listening ports',
    description: 'TCP/UDP sockets in the LISTEN state (ss -tuln).',
    category: 'network',
    command: () => run('ss', ['-tuln']),
  },
  pm2: {
    label: 'PM2 processes',
    description: 'PM2 process list with restarts, CPU and memory (pm2 status).',
    category: 'app',
    command: () => run('pm2', ['status', '--no-color'], 15_000),
  },
  api_log: {
    label: 'API log (last 60 lines)',
    description: 'Recent output from the chatgram-api process. Credential-like lines are redacted.',
    category: 'app',
    command: () => run('pm2', ['logs', 'chatgram-api', '--lines', '60', '--nostream', '--no-color'], 15_000),
  },
  nginx_error: {
    label: 'nginx error log (last 40 lines)',
    description: 'Recent entries from /var/log/nginx/error.log.',
    category: 'app',
    command: () => run('tail', ['-n', '40', '/var/log/nginx/error.log']),
  },
  backups: {
    label: 'Backup archives',
    description: 'Database backups on the VM, newest first.',
    category: 'storage',
    command: () => run('ls', ['-lht', `${home()}/chatgram-backups`], 15_000),
  },
};

function isKnownCheck(id) {
  return Object.prototype.hasOwnProperty.call(CHECKS, id);
}

/** Public list for the UI (no command details). */
function listChecks() {
  return Object.entries(CHECKS).map(([id, check]) => ({
    id,
    label: check.label,
    description: check.description,
    category: check.category,
  }));
}

/** Run one allowlisted check. Throws only for unknown ids. */
async function runCheck(id) {
  if (!isKnownCheck(id)) {
    const error = new Error('Unknown diagnostic.');
    error.status = 404;
    throw error;
  }
  if (process.platform !== 'linux') {
    return {
      id,
      label: CHECKS[id].label,
      ranAt: new Date().toISOString(),
      durationMs: 0,
      exitCode: null,
      timedOut: false,
      output: `Host diagnostics only run on the Linux server (this process is ${process.platform}).`,
      truncated: false,
    };
  }
  const started = Date.now();
  const result = await CHECKS[id].command();
  const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const { text, truncated } = trim(combined);
  return {
    id,
    label: CHECKS[id].label,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    exitCode: result.code,
    timedOut: result.timedOut,
    output: text || '(no output)',
    truncated,
  };
}

module.exports = { listChecks, runCheck, isKnownCheck, _internal: { scrub, trim } };
