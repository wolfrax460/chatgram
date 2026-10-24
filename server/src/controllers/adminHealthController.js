/**
 * Read-only dashboard pages: System health and the append-only Audit log.
 * Nothing here returns secrets (no env values, URIs, hashes or tokens).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const realtime = require('../utils/realtime');
const chatgramAi = require('../ai/chatgram');
const providers = require('../ai/providers');
const AdminAudit = require('../models/AdminAudit');

const MONGO_STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

async function newestBackup() {
  try {
    const dir = path.join(process.env.HOME || process.env.USERPROFILE || '.', 'chatgram-backups');
    const entries = await fs.promises.readdir(dir);
    const files = entries.filter((name) => /^\d{8}-\d{6}\.tgz$/.test(name));
    if (files.length === 0) return null;
    const withStats = await Promise.all(
      files.map(async (name) => {
        const full = path.join(dir, name);
        const stat = await fs.promises.stat(full);
        return { name, bytes: stat.size, at: stat.mtime.toISOString() };
      }),
    );
    withStats.sort((a, b) => (a.at < b.at ? 1 : -1));
    return withStats[0];
  } catch {
    return null;
  }
}

async function diskSpace() {
  try {
    const stats = await fs.promises.statfs('/');
    return {
      freeBytes: Number(stats.bavail) * Number(stats.bsize),
      totalBytes: Number(stats.blocks) * Number(stats.bsize),
    };
  } catch {
    return null;
  }
}

async function systemHealth(req, res) {
  try {
    const memory = process.memoryUsage();
    const providerList = await providers.listProviders().catch(() => ({ providers: [] }));
    const providerRows = providerList.providers || [];
    const healthRows = providerRows.map((row) => ({
      key: row.key,
      label: row.label,
      enabled: row.enabled !== false,
      hasKey: row.hasKey === true,
      requests: row.health?.requests ?? 0,
      errorRate: row.health?.errorRate ?? 0,
      averageLatencyMs: row.health?.averageLatencyMs ?? null,
      lastErrorCode: row.health?.lastErrorCode ?? null,
    }));
    const [backup, disk] = await Promise.all([newestBackup(), diskSpace()]);
    return res.json({
      api: {
        ok: true,
        environment: process.env.NODE_ENV || 'development',
        version: process.env.APP_VERSION || '1.0.0',
        uptimeSeconds: Math.round(process.uptime()),
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        pid: process.pid,
        node: process.version,
        memory: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
        },
        host: {
          platform: os.platform(),
          cpus: os.cpus().length,
          loadAverage: os.loadavg().map((value) => Number(value.toFixed(2))),
          totalMemoryBytes: os.totalmem(),
          freeMemoryBytes: os.freemem(),
        },
      },
      database: {
        state: MONGO_STATES[mongoose.connection.readyState] || 'unknown',
        name: mongoose.connection.name || '',
      },
      sockets: {
        connections: realtime.socketCount(),
        online: realtime.onlineCount(),
        staleAfterMs: realtime.staleAfterMs(),
      },
      ai: {
        degraded: chatgramAi.aiHealth().degraded,
        failuresLast10Min: chatgramAi.aiHealth().failuresLast10Min,
        providers: healthRows,
      },
      backup,
      disk,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin health error:', error.message);
    return res.status(500).json({ message: 'Could not read the system health.' });
  }
}

async function auditList(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const search = String(req.query.search || '').trim();
    const days = Math.min(3650, Math.max(1, Number(req.query.days) || 30));
    const filter = { at: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } };
    if (search) {
      filter.$or = [
        { action: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { detail: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      ];
    }
    const [rows, total] = await Promise.all([
      AdminAudit.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AdminAudit.countDocuments(filter),
    ]);
    return res.json({
      entries: rows.map((row) => ({
        action: row.action,
        detail: row.detail,
        ip: row.ip,
        at: row.at,
      })),
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      days,
    });
  } catch (error) {
    console.error('Admin audit error:', error.message);
    return res.status(500).json({ message: 'Could not read the audit log.' });
  }
}

module.exports = { systemHealth, auditList };
