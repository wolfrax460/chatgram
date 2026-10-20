// Contacts routes — each user has their own address book
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getContacts,
  addContact,
  removeContact,
  searchDirectory,
  getSuggestions,
} = require('../controllers/contactController');

// All routes require authentication
router.use(protect);

// My address book
router.get('/', getContacts);
router.post('/', addContact);

// Declared before the `/:userId` route so they are not treated as ids.
router.get('/search', searchDirectory);
router.get('/suggestions', getSuggestions);

router.delete('/:userId', removeContact);

module.exports = router;
