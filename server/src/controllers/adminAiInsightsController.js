/**
 * Chatgram AI admin pages: usage analytics + knowledge base editor.
 * Admin session only (see routes/adminAiRoutes.js); no prompts/keys/secrets are
 * returned beyond the stored knowledge answers the admin already owns.
 */
const mongoose = require('mongoose');
const { AiMessage, AiKnowledge, AdminInbox, AiConversation } = require('../ai/chatgram');
const GroupAiEvent = require('../models/GroupAiEvent');
const groupMentions = require('../ai/groupMentions');
const admin = require('../admin/auth');

function rangeStart(days) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

async function usage(req, res) {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
    const start = rangeStart(days);
    const [answersByDay, questionsByProvider, topQuestions, totals, inboxByType] = await Promise.all([
      AiMessage.aggregate([
        { $match: { role: 'assistant', createdAt: { $gte: start } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
      AiMessage.aggregate([
        { $match: { role: 'assistant', createdAt: { $gte: start } } },
        { $group: { _id: '$providerKey', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      AiMessage.aggregate([
        { $match: { role: 'user', createdAt: { $gte: start } } },
        { $group: { _id: { $toLower: '$content' }, count: { $sum: 1 }, lastAt: { $max: '$createdAt' } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      Promise.all([
        AiMessage.countDocuments({ role: 'assistant', createdAt: { $gte: start } }),
        AiMessage.countDocuments({ role: 'user', createdAt: { $gte: start } }),
        AiMessage.countDocuments({ role: 'assistant', unknown: true, createdAt: { $gte: start } }),
        AiConversation.countDocuments({ createdAt: { $gte: start } }),
        AiKnowledge.countDocuments({}),
        AiKnowledge.aggregate([{ $group: { _id: null, uses: { $sum: '$uses' } } }]),
      ]),
      AdminInbox.aggregate([{ $match: { status: 'new' } }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
    ]);

    const byDay = new Map(answersByDay.map((row) => [row._id, row.count]));
    const series = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const day = new Date();
      day.setUTCHours(0, 0, 0, 0);
      day.setUTCDate(day.getUTCDate() - offset);
      const key = day.toISOString().slice(0, 10);
      series.push({ day: key, count: byDay.get(key) || 0 });
    }

    // Group "@Chatgram AI" metrics: answered / queued / rejected by reason /
    // failed in the last 24 h. Server API only — the dashboard page still has to
    // render the block (see docs/reports/ai-mentions.md).
    const groupSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let groupTotals = [];
    let groupRejections = [];
    try {
      [groupTotals, groupRejections] = await Promise.all([
        GroupAiEvent.aggregate([
          { $match: { createdAt: { $gte: groupSince } } },
          { $group: { _id: '$type', count: { $sum: 1 } } },
        ]),
        GroupAiEvent.aggregate([
          { $match: { createdAt: { $gte: groupSince }, type: 'rejected' } },
          { $group: { _id: '$reason', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
      ]);
    } catch {
      groupTotals = [];
      groupRejections = [];
    }
    const groupLast24h = { answered: 0, queued: 0, rejected: 0, failed: 0 };
    for (const row of groupTotals) {
      if (row._id in groupLast24h) groupLast24h[row._id] = row.count;
    }
    const rejectedByReason = {};
    for (const row of groupRejections) rejectedByReason[row._id || 'unknown'] = row.count;

    return res.json({
      days,
      totals: {
        answers: totals[0],
        questions: totals[1],
        unknown: totals[2],
        conversations: totals[3],
        knowledgeEntries: totals[4],
        knowledgeUses: totals[5][0]?.uses || 0,
      },
      series,
      byProvider: questionsByProvider.map((row) => ({ provider: row._id || 'unknown', count: row.count })),
      topQuestions: topQuestions.map((row) => ({ question: row._id, count: row.count, lastAt: row.lastAt })),
      inboxByType: inboxByType.map((row) => ({ type: row._id || 'unknown', count: row.count })),
      // Group "@Chatgram AI" (Oct-26 fix): last 24 h from GroupAiEvent + live queue.
      groupMentions: {
        last24h: { ...groupLast24h, rejectedByReason },
        queue: groupMentions.queueSnapshot(),
        sinceBoot: groupMentions.stats(),
      },
    });
  } catch (error) {
    console.error('Admin AI usage error:', error.message);
    return res.status(500).json({ message: 'Could not build the AI usage report.' });
  }
}

async function knowledgeList(req, res) {
  try {
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const filter = {};
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ question: { $regex: regex } }, { answer: { $regex: regex } }, { keywords: { $regex: regex } }];
    }
    const [rows, total] = await Promise.all([
      AiKnowledge.find(filter).sort({ uses: -1, approvedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AiKnowledge.countDocuments(filter),
    ]);
    return res.json({
      entries: rows.map((row) => ({
        id: String(row._id),
        question: row.question,
        answer: row.answer,
        keywords: row.keywords || [],
        uses: row.uses || 0,
        source: row.source || 'admin_inbox',
        approvedAt: row.approvedAt,
      })),
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('Admin knowledge list error:', error.message);
    return res.status(500).json({ message: 'Could not load the knowledge base.' });
  }
}

async function knowledgeSave(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    const question = String(req.body?.question || '').trim().slice(0, 500);
    const answer = String(req.body?.answer || '').trim().slice(0, 4000);
    const keywords = Array.isArray(req.body?.keywords)
      ? req.body.keywords.map((word) => String(word).trim().toLowerCase()).filter(Boolean).slice(0, 20)
      : String(req.body?.keywords || '')
          .split(',')
          .map((word) => word.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 20);
    if (!question || !answer) return res.status(400).json({ message: 'A question and an answer are required.' });
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const created = await AiKnowledge.create({ question, answer, keywords, source: 'admin', approvedAt: new Date() });
      await admin.audit('ai_knowledge_create', req, String(created._id));
      return res.json({ message: 'Knowledge entry added.', entry: { id: String(created._id), question, answer, keywords } });
    }
    const updated = await AiKnowledge.findByIdAndUpdate(id, { question, answer, keywords }, { new: true }).lean();
    if (!updated) return res.status(404).json({ message: 'Knowledge entry not found.' });
    await admin.audit('ai_knowledge_update', req, String(updated._id));
    return res.json({ message: 'Knowledge entry saved.', entry: { id: String(updated._id), question, answer, keywords } });
  } catch (error) {
    console.error('Admin knowledge save error:', error.message);
    return res.status(500).json({ message: 'Could not save the knowledge entry.' });
  }
}

async function knowledgeDelete(req, res) {
  try {
    const id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid knowledge entry id.' });
    const removed = await AiKnowledge.findByIdAndDelete(id);
    if (!removed) return res.status(404).json({ message: 'Knowledge entry not found.' });
    await admin.audit('ai_knowledge_delete', req, id);
    return res.json({ message: 'Knowledge entry removed.', id });
  } catch (error) {
    console.error('Admin knowledge delete error:', error.message);
    return res.status(500).json({ message: 'Could not delete the knowledge entry.' });
  }
}

module.exports = { usage, knowledgeList, knowledgeSave, knowledgeDelete };
