// Protected account deletion (14-day grace). Every route requires a signed-in user.
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { verifyLimiter } = require('../middleware/authLimiter');
const controller = require('../controllers/accountDeletionController');

router.use(protect);

router.post('/delete/request-code', verifyLimiter, controller.requestCode);
router.post('/delete/confirm', controller.confirm);
router.post('/delete/cancel', controller.cancel);

module.exports = router;
