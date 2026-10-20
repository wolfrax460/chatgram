// App version tracking + update policy
const express = require('express');
const router = express.Router();
const { heartbeat, versionInfo, versionUsage } = require('../controllers/appController');

// Public: clients must be able to check for updates before signing in.
router.post('/heartbeat', heartbeat);
router.get('/version', versionInfo);
router.get('/versions', versionUsage);

module.exports = router;
