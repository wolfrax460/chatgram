// Per-user address book
const mongoose = require('mongoose');
const User = require('../models/User');
const Chat = require('../models/Chat');
const presence = require('../utils/presence');

const PUBLIC_FIELDS = '_id displayName avatarUrl about isOnline lastSeen phone email showOnlineStatus onlineStatusExceptions';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Get MY contacts (not every user in the app)
// @route   GET /api/contacts
// @access  Private
const getContacts = async (req, res) => {
  try {
    const me = await User.findById(req.user._id).populate('contacts', PUBLIC_FIELDS);

    const contacts = (me?.contacts || [])
      // A contact may have deleted their account.
      .filter((c) => c && c._id)
      .sort((a, b) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()));

    res.json(presence.sortByPresence(presence.maskPresenceList(contacts, req.user._id)));
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({ message: 'Server error fetching contacts' });
  }
};

// @desc    Add someone to my contacts
// @route   POST /api/contacts
// @access  Private
const addContact = async (req, res) => {
  try {
    const userId = req.body.userId || req.body.contactId || req.body.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'A valid user id is required' });
    }
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot add yourself as a contact' });
    }

    const target = await User.findById(userId).select(PUBLIC_FIELDS);
    if (!target) return res.status(404).json({ message: 'User not found' });

    // $addToSet keeps this idempotent - adding twice is not an error.
    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $addToSet: { contacts: target._id } },
      { new: true }
    ).populate('contacts', PUBLIC_FIELDS);

    res.status(201).json({
      message: `${target.displayName} added to your contacts`,
      contact: target,
      contacts: updated.contacts,
    });
  } catch (error) {
    console.error('Add contact error:', error);
    res.status(500).json({ message: 'Server error adding the contact' });
  }
};

// @desc    Remove someone from my contacts
// @route   DELETE /api/contacts/:userId
// @access  Private
const removeContact = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    await User.findByIdAndUpdate(req.user._id, { $pull: { contacts: userId } });

    res.json({ message: 'Contact removed' });
  } catch (error) {
    console.error('Remove contact error:', error);
    res.status(500).json({ message: 'Server error removing the contact' });
  }
};

// @desc    Search the directory to find people to add.
//          Returns every match together with whether they are already a contact.
// @route   GET /api/contacts/search?query=
// @access  Private
const searchDirectory = async (req, res) => {
  try {
    const query = String(req.query.query || '').trim();
    if (!query) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const me = await User.findById(req.user._id).select('contacts');
    const myContactIds = (me?.contacts || []).map((c) => c.toString());

    const regex = new RegExp(escapeRegex(query), 'i');

    const matches = await User.find({
      _id: { $ne: req.user._id },
      // System accounts (Chatgram AI) are never people-search results.
      isAiAccount: { $ne: true },
      $or: [
        { displayName: { $regex: regex } },
        { phone: { $regex: regex } },
        { email: { $regex: regex } },
      ],
    })
      .select(PUBLIC_FIELDS)
      .sort({ displayName: 1 })
      .limit(25);

    res.json(
      presence.sortByPresence(
        matches.map((user) => ({
          // Masked so the directory never reveals presence someone hid.
          ...presence.maskPresence(user, req.user._id),
          isContact: myContactIds.includes(user._id.toString()),
        })),
      )
    );
  } catch (error) {
    console.error('Search directory error:', error);
    res.status(500).json({ message: 'Server error searching for people' });
  }
};

// @desc    People I already share a conversation with (useful suggestions)
// @route   GET /api/contacts/suggestions
// @access  Private
const getSuggestions = async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('contacts');
    const myContactIds = (me?.contacts || []).map((c) => c.toString());

    const chats = await Chat.find({ participants: req.user._id, type: 'direct' })
      .populate('participants', PUBLIC_FIELDS);

    const seen = new Set(myContactIds);
    const suggestions = [];

    for (const chat of chats) {
      for (const person of chat.participants) {
        if (!person) continue;
        const id = person._id.toString();
        if (id === req.user._id.toString() || seen.has(id)) continue;
        seen.add(id);
        suggestions.push(person);
      }
    }

    res.json(presence.sortByPresence(presence.maskPresenceList(suggestions.slice(0, 20), req.user._id)));
  } catch (error) {
    console.error('Contact suggestions error:', error);
    res.status(500).json({ message: 'Server error fetching suggestions' });
  }
};

module.exports = {
  getContacts,
  addContact,
  removeContact,
  searchDirectory,
  getSuggestions,
};
