// Status routes
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getStatuses,
  getStatusLimits,
  uploadStatusMedia,
  createStatus,
  deleteStatus,
  viewStatus,
  reportStatus
} = require('../controllers/statusController');
const { statusUpload } = require('../utils/upload');

// All routes require authentication
router.use(protect);

// Media rules (image 10 MB, video 50 MB / 60 s, audio 20 MB)
router.get('/limits', getStatusLimits);

// Upload a photo / video / voice note for a status. The hard cap here is 50 MB;
// the per-type limits are enforced (and the stored copy removed) inside the
// controller.
router.post('/media', statusUpload.single('file'), uploadStatusMedia);

// Get contacts' statuses
router.get('/', getStatuses);

// Create new status
router.post('/', createStatus);

// Delete status
router.delete('/:id', deleteStatus);

// Mark status as viewed
router.post('/:id/view', viewStatus);
router.post('/:id/report', reportStatus);

module.exports = router;
