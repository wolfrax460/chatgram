/**
 * Help centre: collections, articles, search, widget conversations and the
 * admin editor API.
 *
 * Public endpoints are hardened: HTML is stripped, lengths capped, rate limits
 * per IP/guest, and guest access requires the random guestId that created the
 * conversation (same trust model as a signed-out support session).
 */
const mongoose = require('mongoose');
const storage = require('../utils/storage');
const realtime = require('../utils/realtime');
const notifier = require('../utils/notifier');
const supportNotifier = require('../support/notifier');
const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');
const { HelpCollection, HelpArticle, HelpConversation, HelpMessage } = require('./models');
const { answerQuestion, kbAnswer } = require('./answer');
const { stripHtml, rateLimit } = require('../controllers/supportTicketController');

const MAX_TEXT = 2000;
const MAX_ATTACHMENTS = 4;

/**
 * Test/staging escape hatch for the widget rate limits. Only honoured outside
 * production and must be enabled explicitly.
 */
function helpLimitsDisabled() {
  return process.env.HELP_RATE_LIMIT_DISABLED === 'true' && process.env.NODE_ENV !== 'production';
}

function allow(key, max, windowMs) {
  if (helpLimitsDisabled()) return { ok: true };
  return rateLimit(key, max, windowMs);
}

/* ------------------------------------------------------------------ status */

// @desc    Public health details for the widget Status card
// @route   GET /api/status
// @access  Public
const getServiceStatus = async (req, res) => {
  const database = mongoose.connection.readyState === 1 ? 'connected' : 'unavailable';
  let socket = 'unavailable';
  try {
    const io = realtime.getIo();
    socket = io ? 'connected' : 'unavailable';
  } catch {
    socket = 'unavailable';
  }
  let storageState = 'unavailable';
  try {
    if (storage.isEnabled()) storageState = 'cloudinary';
    else {
      const fs = require('fs');
      const path = require('path');
      const root = process.env.UPLOAD_DIR
        ? path.resolve(process.env.UPLOAD_DIR)
        : path.join(__dirname, '..', '..', 'uploads');
      fs.accessSync(root, fs.constants.W_OK);
      storageState = 'local';
    }
  } catch {
    storageState = 'unavailable';
  }
  const ok = database === 'connected' && storageState !== 'unavailable';
  return res.status(ok ? 200 : 503).json({
    ok,
    database,
    socket,
    storage: storageState,
    time: new Date().toISOString(),
  });
};

/* ------------------------------------------------------- collections/articles */

function articleShape(article) {
  return {
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    collectionSlug: article.collectionSlug,
    order: article.order,
    updatedAt: article.updatedAt,
  };
}

// @desc    Help collections with article counts
// @route   GET /api/help/collections
// @access  Public
const getCollections = async (req, res) => {
  try {
    const [collections, counts] = await Promise.all([
      HelpCollection.find().sort({ order: 1, title: 1 }).lean(),
      HelpArticle.aggregate([
        { $match: { published: true } },
        { $group: { _id: '$collectionSlug', count: { $sum: 1 } } },
      ]),
    ]);
    const countBySlug = new Map(counts.map((row) => [row._id, row.count]));
    return res.json(
      collections.map((collection) => ({
        ...collection,
        articleCount: countBySlug.get(collection.slug) || 0,
      })),
    );
  } catch (error) {
    console.error('Help collections error:', error);
    return res.status(500).json({ message: 'Could not load the help centre' });
  }
};

// @desc    One collection with its articles
// @route   GET /api/help/collections/:slug
// @access  Public
const getCollection = async (req, res) => {
  try {
    const collection = await HelpCollection.findOne({ slug: req.params.slug }).lean();
    if (!collection) return res.status(404).json({ message: 'Collection not found' });
    const articles = await HelpArticle.find({ collectionSlug: collection.slug, published: true })
      .sort({ order: 1, title: 1 })
      .lean();
    return res.json({ ...collection, articles: articles.map(articleShape), articleCount: articles.length });
  } catch (error) {
    console.error('Help collection error:', error);
    return res.status(500).json({ message: 'Could not load the collection' });
  }
};

// @desc    One article
// @route   GET /api/help/articles/:slug
// @access  Public
const getArticle = async (req, res) => {
  try {
    const article = await HelpArticle.findOne({ slug: req.params.slug, published: true }).lean();
    if (!article) return res.status(404).json({ message: 'Article not found' });
    const collection = await HelpCollection.findOne({ slug: article.collectionSlug }).lean();
    const related = await HelpArticle.find({
      collectionSlug: article.collectionSlug,
      slug: { $ne: article.slug },
      published: true,
    })
      .sort({ order: 1 })
      .limit(4)
      .lean();
    return res.json({
      ...article,
      collectionTitle: collection ? collection.title : 'Help',
      related: related.map(articleShape),
    });
  } catch (error) {
    console.error('Help article error:', error);
    return res.status(500).json({ message: 'Could not load the article' });
  }
};

// @desc    Search articles
// @route   GET /api/help/search?q=
// @access  Public
const searchArticles = async (req, res) => {
  try {
    const q = stripHtml(req.query.q || '').trim().slice(0, 120);
    if (q.length < 2) return res.json({ query: q, results: [], total: 0 });
    const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    const articles = await HelpArticle.find({ published: true }).select('slug title summary body collectionSlug keywords').lean();

    const results = [];
    for (const article of articles) {
      const haystack = `${article.title} ${article.summary} ${(article.keywords || []).join(' ')} ${article.body}`.toLowerCase();
      let score = 0;
      for (const word of words) {
        if (!haystack.includes(word)) continue;
        score += 1;
        if (article.title.toLowerCase().includes(word)) score += 3;
        if ((article.keywords || []).some((keyword) => String(keyword).toLowerCase().includes(word))) score += 2;
      }
      if (score === 0) continue;
      // Short snippet around the first match.
      const index = Math.max(0, haystack.indexOf(words[0]));
      const start = Math.max(0, index - 60);
      results.push({
        slug: article.slug,
        title: article.title,
        summary: article.summary,
        collectionSlug: article.collectionSlug,
        snippet: `${start > 0 ? '…' : ''}${article.body.slice(start, start + 160).replace(/\n+/g, ' ')}…`,
        score,
      });
    }
    results.sort((a, b) => b.score - a.score);
    return res.json({ query: q, results: results.slice(0, 12), total: results.length });
  } catch (error) {
    console.error('Help search error:', error);
    return res.status(500).json({ message: 'Could not search the help centre' });
  }
};

/* ------------------------------------------------------------ conversations */

function guestIdFrom(req) {
  const raw = (req.body && req.body.guestId) || req.query.guestId || '';
  const value = String(raw).trim().slice(0, 64);
  return value.length >= 16 ? value : null;
}

async function findConversation(req) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return { error: { status: 400, message: 'Invalid conversation ID' } };
  const conversation = await HelpConversation.findById(id);
  if (!conversation) return { error: { status: 404, message: 'Conversation not found' } };

  const userId = req.user ? String(req.user._id) : null;
  if (conversation.userId && userId && String(conversation.userId) === userId) return { conversation };
  if (conversation.guestId) {
    const guestId = guestIdFrom(req);
    if (guestId && guestId === conversation.guestId) return { conversation };
  }
  return { error: { status: 403, message: 'Not your conversation' } };
}

function messageShape(message) {
  return {
    id: String(message._id),
    role: message.role,
    text: message.text,
    authorName: message.authorName || null,
    articleSlug: message.articleSlug || null,
    attachments: message.attachments || [],
    feedback: message.feedback || null,
    createdAt: message.createdAt,
  };
}

function conversationShape(conversation, messages = []) {
  return {
    id: String(conversation._id),
    status: conversation.status,
    ticketId: conversation.ticketId || null,
    displayName: conversation.displayName,
    unread: conversation.unreadForUser || 0,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
    messages: messages.map(messageShape),
  };
}

const WELCOME =
  'Hi! I am the Chatgram Assistant. Ask me anything about Chatgram — account, groups, chats, statuses, notifications or installing the app. I answer from our help articles, and if I do not know I can pass you to a person.';

async function createAssistantMessage(conversation, question) {
  const history = await HelpMessage.find({ conversationId: conversation._id })
    .sort({ createdAt: -1 })
    .limit(8)
    .lean();
  const result = await answerQuestion(question, history.reverse());
  const message = await HelpMessage.create({
    conversationId: conversation._id,
    role: 'assistant',
    text: result.answer,
    authorName: 'Chatgram Assistant',
    articleSlug: result.articleSlug,
  });
  conversation.lastMessageAt = new Date();
  await conversation.save();
  return { message, meta: result };
}

// @desc    Create (or continue) a help conversation
// @route   POST /api/help/conversations
// @access  Public (user or guest)
const createConversation = async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress;
    const limit = allow(`help:create:${ip}`, 10, 60 * 60 * 1000);
    if (!limit.ok) return res.status(429).json({ message: `Too many chats started. Try again in ${limit.retryAfter}s.` });

    const body = req.body || {};
    const userId = req.user ? req.user._id : null;
    const guestId = userId ? null : guestIdFrom(req);
    if (!userId && !guestId) {
      return res.status(400).json({ message: 'A guest session is required', code: 'GUEST_ID_REQUIRED' });
    }

    const filter = userId ? { userId, status: 'open' } : { guestId, status: 'open' };
    let conversation = await HelpConversation.findOne(filter).sort({ lastMessageAt: -1 });
    let created = false;
    if (!conversation) {
      conversation = await HelpConversation.create({
        userId,
        guestId,
        displayName: userId ? req.user.displayName : String(body.displayName || 'Guest').slice(0, 80),
      });
      created = true;
      const welcome = await HelpMessage.create({
        conversationId: conversation._id,
        role: 'assistant',
        text: WELCOME,
        authorName: 'Chatgram Assistant',
      });
      conversation.lastMessageAt = new Date();
      await conversation.save();
      return res.status(201).json({
        conversation: conversationShape(conversation, [welcome]),
        created,
      });
    }

    const messages = await HelpMessage.find({ conversationId: conversation._id }).sort({ createdAt: 1 }).limit(100);
    return res.json({ conversation: conversationShape(conversation, messages), created });
  } catch (error) {
    console.error('Help create conversation error:', error);
    return res.status(500).json({ message: 'Could not start the chat' });
  }
};

// @desc    List my conversations
// @route   GET /api/help/conversations
// @access  Public (user or guest)
const listConversations = async (req, res) => {
  try {
    const userId = req.user ? req.user._id : null;
    const guestId = userId ? null : guestIdFrom(req);
    if (!userId && !guestId) return res.json([]);
    const filter = userId ? { userId } : { guestId };
    const conversations = await HelpConversation.find(filter).sort({ lastMessageAt: -1 }).limit(30).lean();
    const shaped = [];
    for (const conversation of conversations) {
      const last = await HelpMessage.findOne({ conversationId: conversation._id })
        .sort({ createdAt: -1 })
        .lean();
      shaped.push({
        id: String(conversation._id),
        status: conversation.status,
        ticketId: conversation.ticketId || null,
        unread: conversation.unreadForUser || 0,
        lastMessageAt: conversation.lastMessageAt,
        preview: last ? last.text.slice(0, 120) : '',
        lastRole: last ? last.role : 'assistant',
      });
    }
    return res.json(shaped);
  } catch (error) {
    console.error('Help list conversations error:', error);
    return res.status(500).json({ message: 'Could not load your messages' });
  }
};

// @desc    One conversation with its messages
// @route   GET /api/help/conversations/:id
// @access  Public (owner only)
const getConversation = async (req, res) => {
  try {
    const { conversation, error } = await findConversation(req);
    if (error) return res.status(error.status).json({ message: error.message });
    const messages = await HelpMessage.find({ conversationId: conversation._id }).sort({ createdAt: 1 }).limit(200);
    return res.json(conversationShape(conversation, messages));
  } catch (error) {
    console.error('Help get conversation error:', error);
    return res.status(500).json({ message: 'Could not load the conversation' });
  }
};

// @desc    Post a message and get the assistant's reply
// @route   POST /api/help/conversations/:id/messages
// @access  Public (owner only)
const postMessage = async (req, res) => {
  try {
    const { conversation, error } = await findConversation(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const ip = req.ip || req.connection?.remoteAddress;
    const guest = conversation.guestId || String(conversation.userId);
    const perGuest = allow(`help:msg:${guest}`, 60, 60 * 60 * 1000);
    if (!perGuest.ok) return res.status(429).json({ message: `Too many messages. Try again in ${perGuest.retryAfter}s.` });
    const perIp = allow(`help:msg:ip:${ip}`, 300, 24 * 60 * 60 * 1000);
    if (!perIp.ok) return res.status(429).json({ message: 'Daily limit reached.' });

    const body = req.body || {};
    const text = stripHtml(body.text).slice(0, MAX_TEXT);
    const attachments = Array.isArray(body.attachments)
      ? body.attachments
          .slice(0, MAX_ATTACHMENTS)
          .map((attachment) => ({
            url: String(attachment?.url || '').slice(0, 500),
            type: ['image', 'file', 'audio', 'video'].includes(attachment?.type) ? attachment.type : 'file',
            name: String(attachment?.name || '').slice(0, 160),
            size: Number(attachment?.size) || 0,
          }))
          .filter((attachment) => /^https?:\/\/|^\/uploads\//.test(attachment.url))
      : [];

    if (!text && attachments.length === 0) {
      return res.status(400).json({ message: 'Type a message first.' });
    }

    const userMessage = await HelpMessage.create({
      conversationId: conversation._id,
      role: conversation.userId ? 'user' : 'user',
      text,
      authorName: conversation.displayName,
      attachments,
    });
    conversation.unreadForAgent = (conversation.unreadForAgent || 0) + 1;

    const { message: assistantMessage, meta } = await createAssistantMessage(conversation, text || '(attachment)');

    return res.status(201).json({
      message: messageShape(userMessage),
      reply: messageShape(assistantMessage),
      source: meta.source,
      matched: meta.matched || [],
      conversationId: String(conversation._id),
      ticketId: conversation.ticketId || null,
    });
  } catch (error) {
    console.error('Help post message error:', error);
    return res.status(500).json({ message: 'Could not send the message' });
  }
};

// @desc    Mark the conversation read for this person
// @route   POST /api/help/conversations/:id/read
// @access  Public (owner only)
const markRead = async (req, res) => {
  try {
    const { conversation, error } = await findConversation(req);
    if (error) return res.status(error.status).json({ message: error.message });
    conversation.unreadForUser = 0;
    await conversation.save();
    return res.json({ ok: true });
  } catch (error) {
    console.error('Help mark read error:', error);
    return res.status(500).json({ message: 'Could not update the conversation' });
  }
};

// @desc    Resolve (close) the conversation
// @route   POST /api/help/conversations/:id/resolve
// @access  Public (owner only)
const resolveConversation = async (req, res) => {
  try {
    const { conversation, error } = await findConversation(req);
    if (error) return res.status(error.status).json({ message: error.message });
    conversation.status = 'resolved';
    await conversation.save();
    await HelpMessage.create({
      conversationId: conversation._id,
      role: 'system',
      text: 'This conversation was marked as resolved.',
    });
    return res.json({ ok: true, status: 'resolved' });
  } catch (error) {
    console.error('Help resolve error:', error);
    return res.status(500).json({ message: 'Could not resolve the conversation' });
  }
};

// @desc    Delete the conversation (delete-my-data path)
// @route   DELETE /api/help/conversations/:id
// @access  Public (owner only)
const deleteConversation = async (req, res) => {
  try {
    const { conversation, error } = await findConversation(req);
    if (error) return res.status(error.status).json({ message: error.message });
    await HelpMessage.deleteMany({ conversationId: conversation._id });
    await HelpConversation.deleteOne({ _id: conversation._id });
    return res.json({ ok: true, deleted: true });
  } catch (error) {
    console.error('Help delete conversation error:', error);
    return res.status(500).json({ message: 'Could not delete the conversation' });
  }
};

// @desc    Hand the conversation to a human (creates a ticket)
// @route   POST /api/help/conversations/:id/handoff
// @access  Public (owner only)
const handoff = async (req, res) => {
  try {
    const { conversation, error } = await findConversation(req);
    if (error) return res.status(error.status).json({ message: error.message });
    if (conversation.ticketId) {
      return res.json({ ok: true, ticketId: conversation.ticketId, alreadyOpen: true });
    }

    const body = req.body || {};
    const messages = await HelpMessage.find({ conversationId: conversation._id }).sort({ createdAt: 1 }).limit(40).lean();
    const transcript = messages.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'guest',
      text: String(message.text || '').slice(0, 4000),
      at: message.createdAt,
    }));

    let contact = stripHtml(body.contact || '').slice(0, 200);
    let contactType = contact.includes('@') ? 'email' : 'phone';
    if (!contact) {
      if (conversation.userId) {
        const user = await User.findById(conversation.userId).select('email phone').lean();
        contact = (user && (user.email || user.phone)) || '';
        contactType = user && user.email ? 'email' : 'phone';
      } else {
        contact = 'in-widget help conversation';
        contactType = 'email';
      }
    }

    let ticketId = SupportTicket.newTicketId();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await SupportTicket.exists({ ticketId }))) break;
      ticketId = SupportTicket.newTicketId();
    }

    const ticket = await SupportTicket.create({
      ticketId,
      guestId: conversation.guestId || `user-${conversation.userId}`,
      userId: conversation.userId || null,
      contact,
      contactType,
      status: 'open',
      summary: `Help widget: ${String(messages[messages.length - 1]?.text || 'handoff requested').slice(0, 300)}`,
      transcript,
      meta: {
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        page: String(body.page || '').slice(0, 300),
        appVersion: String(body.appVersion || '').slice(0, 40),
      },
    });

    conversation.ticketId = ticketId;
    await conversation.save();

    const system = await HelpMessage.create({
      conversationId: conversation._id,
      role: 'system',
      text: `The Chatgram team can also help. Your ticket is ${ticketId} — a person will reply here.`,
    });

    try {
      await supportNotifier.notifyTicket(ticket);
    } catch (notifyError) {
      console.warn('Handoff notification failed:', notifyError.message);
    }

    return res.status(201).json({ ok: true, ticketId, message: messageShape(system) });
  } catch (error) {
    console.error('Help handoff error:', error);
    return res.status(500).json({ message: 'Could not reach a person right now' });
  }
};

// @desc    Email the transcript
// @route   POST /api/help/conversations/:id/transcript
// @access  Public (owner only)
const emailTranscript = async (req, res) => {
  try {
    const { conversation, error } = await findConversation(req);
    if (error) return res.status(error.status).json({ message: error.message });
    const body = req.body || {};
    let to = stripHtml(body.email || '').slice(0, 200);
    if (!to && conversation.userId) {
      const user = await User.findById(conversation.userId).select('email').lean();
      to = user?.email || '';
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(to)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    const messages = await HelpMessage.find({ conversationId: conversation._id }).sort({ createdAt: 1 }).limit(200).lean();
    const lines = messages.map((message) => {
      const who = message.role === 'user' ? conversation.displayName : message.authorName || 'Chatgram Assistant';
      return `[${new Date(message.createdAt).toISOString()}] ${who}: ${message.text}`;
    });
    const result = await notifier.sendMail({
      to,
      subject: 'Your Chatgram help conversation',
      text: `Here is a copy of your Chatgram help conversation.\n\n${lines.join('\n')}`,
    });
    return res.json({ ok: true, delivered: result.delivered, provider: result.provider, to });
  } catch (error) {
    console.error('Help transcript error:', error);
    return res.status(500).json({ message: 'Could not email the transcript' });
  }
};

// @desc    Thumbs up / down on an assistant message
// @route   POST /api/help/messages/:id/feedback
// @access  Public (owner only)
const messageFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid message ID' });
    const message = await HelpMessage.findById(id);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    const conversation = await HelpConversation.findById(message.conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    const userId = req.user ? String(req.user._id) : null;
    const guestId = guestIdFrom(req);
    const owns = (conversation.userId && userId && String(conversation.userId) === userId) ||
      (conversation.guestId && guestId === conversation.guestId);
    if (!owns) return res.status(403).json({ message: 'Not your conversation' });

    const value = req.body?.value === 'up' || req.body?.value === 'down' ? req.body.value : null;
    message.feedback = value;
    await message.save();
    return res.json({ ok: true, feedback: message.feedback });
  } catch (error) {
    console.error('Help feedback error:', error);
    return res.status(500).json({ message: 'Could not save the feedback' });
  }
};

// @desc    Upload an attachment from the widget (public, rate limited)
// @route   POST /api/help/uploads
// @access  Public
const uploadAttachment = async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress;
    const limit = allow(`help:upload:${ip}`, 20, 60 * 60 * 1000);
    if (!limit.ok) return res.status(429).json({ message: `Too many uploads. Try again in ${limit.retryAfter}s.` });
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const subdir = String(req.file.mimetype || '').startsWith('image/') ? 'images' : 'files';
    const stored = await storage.persistUpload(req, subdir);
    const kind = String(req.file.mimetype || '').startsWith('image/')
      ? 'image'
      : String(req.file.mimetype || '').startsWith('audio/')
        ? 'audio'
        : String(req.file.mimetype || '').startsWith('video/')
          ? 'video'
          : 'file';
    return res.status(201).json({
      file: {
        url: stored.url,
        type: kind,
        name: req.file.originalname,
        size: stored.bytes != null ? stored.bytes : req.file.size,
      },
    });
  } catch (error) {
    console.error('Help upload error:', error);
    return res.status(500).json({ message: 'Could not upload the file' });
  }
};

/* ------------------------------------------------------------------ admin */

function requireSupportAccount(req, res, next) {
  if (!req.user?.isSupportAccount) return res.status(403).json({ message: 'Support account required.' });
  return next();
}

// @desc    Admin: all collections (including empty ones)
// @route   GET /api/help/admin/collections
const adminListCollections = async (req, res) => {
  const collections = await HelpCollection.find().sort({ order: 1 }).lean();
  const counts = await HelpArticle.aggregate([{ $group: { _id: '$collectionSlug', count: { $sum: 1 } } }]);
  const countBySlug = new Map(counts.map((row) => [row._id, row.count]));
  return res.json(collections.map((collection) => ({ ...collection, articleCount: countBySlug.get(collection.slug) || 0 })));
};

// @desc    Admin: create/update a collection
const adminUpsertCollection = async (req, res) => {
  const body = req.body || {};
  const slug = String(body.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return res.status(400).json({ message: 'Invalid slug' });
  const collection = await HelpCollection.findOneAndUpdate(
    { slug },
    {
      $set: {
        title: String(body.title || slug).slice(0, 120),
        description: String(body.description || '').slice(0, 400),
        icon: String(body.icon || 'book').slice(0, 30),
        order: Number(body.order) || 0,
      },
    },
    { upsert: true, new: true },
  );
  return res.json(collection);
};

const adminDeleteCollection = async (req, res) => {
  const collection = await HelpCollection.findOneAndDelete({ slug: req.params.slug });
  if (!collection) return res.status(404).json({ message: 'Collection not found' });
  await HelpArticle.deleteMany({ collectionSlug: collection.slug });
  return res.json({ ok: true, deleted: collection.slug });
};

const adminListArticles = async (req, res) => {
  const articles = await HelpArticle.find().sort({ collectionSlug: 1, order: 1 }).lean();
  return res.json(articles);
};

const adminUpsertArticle = async (req, res) => {
  const body = req.body || {};
  const slug = String(body.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) return res.status(400).json({ message: 'Invalid slug' });
  const collectionSlug = String(body.collectionSlug || '').trim().toLowerCase();
  const collection = await HelpCollection.findOne({ slug: collectionSlug });
  if (!collection) return res.status(400).json({ message: 'Unknown collection' });
  const title = String(body.title || '').trim();
  const articleBody = String(body.body || '').trim();
  if (!title || !articleBody) return res.status(400).json({ message: 'Title and body are required' });
  const article = await HelpArticle.findOneAndUpdate(
    { slug },
    {
      $set: {
        collectionSlug,
        title: title.slice(0, 200),
        summary: String(body.summary || '').slice(0, 400),
        body: articleBody.slice(0, 12000),
        keywords: Array.isArray(body.keywords) ? body.keywords.slice(0, 20).map((k) => String(k).slice(0, 40)) : [],
        order: Number(body.order) || 0,
        published: body.published !== false,
      },
    },
    { upsert: true, new: true },
  );
  return res.json(article);
};

const adminDeleteArticle = async (req, res) => {
  const article = await HelpArticle.findOneAndDelete({ slug: req.params.slug });
  if (!article) return res.status(404).json({ message: 'Article not found' });
  return res.json({ ok: true, deleted: article.slug });
};

module.exports = {
  getServiceStatus,
  getCollections,
  getCollection,
  getArticle,
  searchArticles,
  createConversation,
  listConversations,
  getConversation,
  postMessage,
  markRead,
  resolveConversation,
  deleteConversation,
  handoff,
  emailTranscript,
  messageFeedback,
  uploadAttachment,
  requireSupportAccount,
  adminListCollections,
  adminUpsertCollection,
  adminDeleteCollection,
  adminListArticles,
  adminUpsertArticle,
  adminDeleteArticle,
  kbAnswer,
};
