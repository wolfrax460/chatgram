// Call signalling configuration routes. Call media never touches the server:
// only SDP/ICE payloads are forwarded over the authenticated socket.
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getIceServers } = require('../controllers/callController');

router.use(protect);
router.get('/ice', getIceServers);

module.exports = router;
