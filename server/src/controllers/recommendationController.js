// Empty-screen recommendations (item 4): the signed-in list and per-user dismiss.
const recommendations = require('../ai/recommendations');

async function list(req, res) {
  try {
    const rows = await recommendations.listForUser(req.user);
    return res.json({ recommendations: rows });
  } catch (error) {
    console.error('Recommendations list error:', error.message);
    return res.status(500).json({ message: 'Could not load recommendations.' });
  }
}

async function dismiss(req, res) {
  try {
    const key = String(req.params.key || '').trim();
    if (!key) return res.status(400).json({ message: 'A recommendation key is required.' });
    const dismissed = await recommendations.dismissForUser(req.user._id, key);
    if (!dismissed) return res.status(404).json({ message: 'Recommendation not found.' });
    return res.json({ message: 'Dismissed.', key });
  } catch (error) {
    console.error('Recommendation dismiss error:', error.message);
    return res.status(500).json({ message: 'Could not dismiss the recommendation.' });
  }
}

module.exports = { list, dismiss };
