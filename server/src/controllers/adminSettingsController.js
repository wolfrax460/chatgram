/**
 * 9b Settings page: site name and URLs, support email, SMTP/Telegram status
 * (write-only: only "configured" is ever exposed), data retention, legal links
 * and database backups (status, "back up now", restore instructions).
 *
 * No secret is ever returned: SMTP_PASS and TELEGRAM_BOT_TOKEN are only checked
 * for presence, never read out.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const PlatformSettings = require('../models/PlatformSettings');
const platformSettings = require('../utils/platformSettings');
const admin = require('../admin/auth');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');
let backupRunning = false;

const SETTINGS_KEYS = [
  'siteName',
  'siteUrl',
  'supportEmail',
  'smtpFromName',
  'smtpFromAddress',
  'privacyUrl',
  'termsUrl',
  'dataRetentionDays',
  'reviewLogRetentionDays',
];

function configured(value) {
  return Boolean(String(value || '').trim());
}

function smtpConfigured() {
  return (
    String(process.env.EMAIL_PROVIDER || '').toLowerCase() === 'smtp' &&
    configured(process.env.SMTP_HOST) &&
    configured(process.env.SMTP_USER) &&
    configured(process.env.SMTP_PASS)
  );
}

function telegramConfigured() {
  return configured(process.env.TELEGRAM_BOT_TOKEN) && configured(process.env.TELEGRAM_CHAT_ID);
}

async function listBackups() {
  try {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    const entries = await fs.promises.readdir(BACKUP_DIR, { withFileTypes: true });
    const rows = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.archive.gz')) continue;
      const full = path.join(BACKUP_DIR, entry.name);
      const stat = await fs.promises.stat(full);
      rows.push({ name: entry.name, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() });
    }
    return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);
  } catch {
    return [];
  }
}

/** GET /settings — everything the Settings page needs (no secrets). */
async function state(req, res) {
  try {
    const settings = await platformSettings.get();
    const backups = await listBackups();
    return res.json({
      settings: Object.fromEntries(SETTINGS_KEYS.map((key) => [key, settings[key]])),
      status: {
        emailProvider: String(process.env.EMAIL_PROVIDER || 'console'),
        smtpConfigured: smtpConfigured(),
        telegramConfigured: telegramConfigured(),
        backupRunning,
      },
      backups,
      lastBackupAt: settings.lastBackupAt,
      lastBackupSizeBytes: settings.lastBackupSizeBytes,
    });
  } catch (error) {
    console.error('Settings state failed:', error.message);
    return res.status(500).json({ message: 'Could not load the settings.' });
  }
}

/** PUT /settings — save the site/retention/legal settings. */
async function save(req, res) {
  try {
    const patch = {};
    for (const key of SETTINGS_KEYS) {
      if (req.body && key in req.body) patch[key] = req.body[key];
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ message: 'Nothing to save.' });
    const next = await platformSettings.update(patch, req);
    await admin.audit('site_settings_update', req, Object.keys(patch).join(',').slice(0, 300));
    return res.json({ settings: Object.fromEntries(SETTINGS_KEYS.map((key) => [key, next[key]])), message: 'Settings saved.' });
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message || 'Could not save the settings.' });
  }
}

/** POST /settings/backup — run mongodump into the backups folder. */
async function backupNow(req, res) {
  if (backupRunning) return res.status(409).json({ message: 'A backup is already running.', code: 'BACKUP_RUNNING' });
  const uri = process.env.MONGODB_URI;
  if (!configured(uri)) return res.status(500).json({ message: 'MONGODB_URI is not configured on the server.' });
  backupRunning = true;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const file = path.join(BACKUP_DIR, `chatgram-${stamp}.archive.gz`);
  try {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    await new Promise((resolve, reject) => {
      execFile('mongodump', [`--uri=${uri}`, `--archive=${file}`, '--gzip'], { timeout: 240_000 }, (error, _stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr: String(stderr || '').slice(0, 400) }));
          return;
        }
        resolve();
      });
    });
    const stat = await fs.promises.stat(file);
    await PlatformSettings.updateOne(
      { singleton: 'platform' },
      { $set: { lastBackupAt: new Date(), lastBackupSizeBytes: stat.size, lastBackupPath: file } },
      { upsert: true },
    );
    platformSettings.resetCache();
    await admin.audit('backup_run', req, `${path.basename(file)} ${stat.size} bytes`);
    return res.json({
      message: `Backup created (${(stat.size / (1024 * 1024)).toFixed(1)} MB).`,
      backup: { name: path.basename(file), sizeBytes: stat.size, createdAt: new Date().toISOString() },
      backups: await listBackups(),
    });
  } catch (error) {
    const missing = error.code === 'ENOENT';
    await admin.audit('backup_failed', req, String(error.message).slice(0, 200));
    if (missing) {
      return res.status(501).json({
        message: 'mongodump is not installed on this server, so the dashboard cannot create a backup here. Use the documented server backup command instead.',
        code: 'BACKUP_TOOL_MISSING',
      });
    }
    console.error('Backup failed:', error.message);
    return res.status(500).json({ message: 'The backup failed. Check the server logs.', code: 'BACKUP_FAILED' });
  } finally {
    backupRunning = false;
  }
}

module.exports = { state, save, backupNow };
