// App version tracking + update policy
const express = require('express');
const router = express.Router();
const { heartbeat, versionInfo, versionUsage } = require('../controllers/appController');
const { publicReleases } = require('../controllers/appReleasesController');

// Public: clients must be able to check for updates before signing in.
router.post('/heartbeat', heartbeat);
router.get('/version', versionInfo);
router.get('/versions', versionUsage);
// Public feature flags + maintenance message for the web/desktop/mobile clients.
router.get('/features', async (req, res) => {
  try {
    const settings = await require('../utils/platformSettings').get();
    return res.json({
      registrationEnabled: settings.registrationEnabled,
      statusEnabled: settings.statusEnabled,
      groupsEnabled: settings.groupsEnabled,
      fileUploadsEnabled: settings.fileUploadsEnabled,
      aiEnabled: settings.aiEnabled,
      supportWidgetEnabled: settings.supportWidgetEnabled,
      maintenanceMode: settings.maintenanceMode,
      maintenanceMessage: settings.maintenanceMessage,
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
