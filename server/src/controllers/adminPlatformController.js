/**
 * Admin platform settings (9b item 10): feature flags, maintenance / read-only
 * mode and upload limits. Every save is audited.
 */
const platformSettings = require('../utils/platformSettings');

async function getSettings(req, res) {
  try {
    return res.json({ settings: await platformSettings.get(), defaults: platformSettings.DEFAULTS });
  } catch (error) {
    console.error('Platform settings read error:', error.message);
    return res.status(500).json({ message: 'Could not load the platform settings.' });
  }
}

async function saveSettings(req, res) {
  try {
    const settings = await platformSettings.update(req.body?.settings || req.body || {}, req);
    return res.json({ message: 'Platform settings saved.', settings });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    console.error('Platform settings save error:', error.message);
    return res.status(500).json({ message: 'Could not save the platform settings.' });
  }
}

module.exports = { getSettings, saveSettings };
