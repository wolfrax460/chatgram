// Status routes
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getStatuses,
  createStatus,
  deleteStatus,
  viewStatus
} = require('../controllers/statusController');

// All routes require authentication
router.use(protect);

// Get contacts' statuses
router.get('/', getStatuses);

// Create new status
router.post('/', createStatus);

// Delete status
router.delete('/:id', deleteStatus);

// Mark status as viewed
router.post('/:id/view', viewStatus);

module.exports = router;