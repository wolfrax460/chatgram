// Model-provider switching API (item 9c), gated by the admin session.
const express = require('express');
const router = express.Router();
const { requireAdminSession, requireAdminCsrf } = require('../middleware/adminAuth');
const admin = require('../admin/auth');
const providers = require('../ai/providers');

function wrap(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req);
      return res.json(result);
    } catch (error) {
      const status = error?.name === 'AiError' ? 400 : 500;
      if (status === 500) console.error('Providers API error:', error.message);
      return res.status(status).json({ message: error.message || 'Request failed.' });
    }
  };
}

router.use(requireAdminSession);
router.get('/', wrap(() => providers.listProviders()));
router.put('/features', requireAdminCsrf, wrap(async (req) => {
  const result = await providers.setFeatures({ ...req.body, by: req.adminSession ? `admin:${req.adminSession.ip}` : 'admin' });
  await admin.audit('provider_features_change', req, JSON.stringify(req.body?.features || {}).slice(0, 300));
  return result;
}));
router.post('/undo', requireAdminCsrf, wrap(async (req) => {
  const result = await providers.undoLastChange();
  await admin.audit('provider_features_undo', req);
  return result;
}));
router.put('/:key', requireAdminCsrf, wrap(async (req) => {
  const result = await providers.upsertProvider({ ...req.body, key: req.params.key });
  await admin.audit('provider_save', req, `${req.params.key}`);
  return { message: 'Provider saved.', provider: result, ...(await providers.listProviders()) };
}));
router.delete('/:key', requireAdminCsrf, wrap(async (req) => {
  const result = await providers.deleteProvider(req.params.key);
  await admin.audit('provider_delete', req, req.params.key);
  return result;
}));
router.post('/:key/test', requireAdminCsrf, wrap(async (req) => {
  const result = await providers.testProvider(req.params.key);
  await admin.audit('provider_test', req, `${req.params.key} -> ${result.ok ? 'ok' : result.code}`);
  return result;
}));

module.exports = router;
