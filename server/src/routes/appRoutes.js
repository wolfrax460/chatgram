// App version tracking + update policy
const express = require('express');
const router = express.Router();
const { heartbeat, updateCheck, versionUsage } = require('../controllers/appController');
const { publicReleases } = require('../controllers/appReleasesController');
const { changelog } = require('../controllers/changelogController');
const { createVersionLimiter } = require('../utils/appUpdate');

const versionLimiter = createVersionLimiter();

// Public: clients must be able to check for updates before signing in.
router.post('/heartbeat', heartbeat);
// Public changelog: published releases + curated web-only entries (5 min cache).
router.get('/changelog', changelog);
// Chunk 7A public update check (rate limited, ETag + 60 s cache).
router.get('/version', versionLimiter, updateCheck);
router.get('/versions', versionUsage);
// Public feature flags + maintenance message for the web/desktop/mobile clients.
// Electron and the Android shell load the hosted web client, so this is the
// first call that can tell them "the app is down" before any other API request
// (the gate keeps this path reachable during maintenance).
router.get('/features', async (req, res) => {
  try {
    const platformSettings = require('../utils/platformSettings');
    const settings = await platformSettings.get();
    return res.json({
      registrationEnabled: settings.registrationEnabled,
      statusEnabled: settings.statusEnabled,
      groupsEnabled: settings.groupsEnabled,
      fileUploadsEnabled: settings.fileUploadsEnabled,
      aiEnabled: settings.aiEnabled,
      supportWidgetEnabled: settings.supportWidgetEnabled,
      // Effective state: false once an auto-expiry window (`maintenanceUntil`)
      // has passed, so clients recover without a redeploy or another toggle.
      maintenanceMode: platformSettings.isMaintenanceActive(settings),
      maintenanceMessage: settings.maintenanceMessage,
      maintenanceUntil: settings.maintenanceUntil || null,
      readOnlyMode: settings.readOnlyMode,
      maxUploadMb: settings.maxUploadMb,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Could not load the feature flags.' });
  }
});
// Active in-app announcement banner (public: clients show it before signing in).
router.get('/announcements', require('../controllers/adminBroadcastsController').publicBanner);

// Published Windows/Android/Web releases for the apps and the landing downloads page.
router.get('/releases', publicReleases);

module.exports = router;
