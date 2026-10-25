// App version tracking + update policy
const express = require('express');
const router = express.Router();
const { heartbeat, versionInfo, versionUsage } = require('../controllers/appController');
const { publicReleases } = require('../controllers/appReleasesController');

// Public: clients must be able to check for updates before signing in.
router.post('/heartbeat', heartbeat);
router.get('/version', versionInfo);
router.get('/versions', versionUsage);
// Published Windows/Android/Web releases for the apps and the landing downloads page.
router.get('/releases', publicReleases);

module.exports = router;
