// Empty-screen recommendations (item 4). Signed-in users read + dismiss.
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { list, dismiss } = require('../controllers/recommendationController');

router.use(protect);
router.get('/', list);
router.post('/:key/dismiss', dismiss);

module.exports = router;
