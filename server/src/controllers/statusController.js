// Status controller
const Status = require('../models/Status');
const User = require('../models/User');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// @desc    Get contacts' statuses
// @route   GET /api/status
// @access  Private
const getStatuses = async (req, res) => {
  try {
    // Only my contacts (plus my own) — this previously returned every status in
    // the database, so people saw updates from accounts they had never added.
    const me = await User.findById(req.user._id).select('contacts');

    const visibleUserIds = [
      req.user._id,
      ...((me && me.contacts) || []),
    ];

    const statuses = await Status.find({ userId: { $in: visibleUserIds } })
      .sort({ createdAt: -1 }) // Newest first
      .populate('userId', '_id displayName avatarUrl')
      // Populate the viewer list so the owner can see WHO viewed their status
      // instead of a bare count.
      .populate('viewedBy', '_id displayName avatarUrl');

    res.json(statuses);
  } catch (error) {
    console.error('Get statuses error:', error);
    res.status(500).json({ message: 'Server error fetching statuses' });
  }
};

// @desc    Create new status
// @route   POST /api/status
// @access  Private
const createStatus = async (req, res) => {
  try {
    const { text, mediaUrl } = req.body;

    // Validate input
    if (!text && !mediaUrl) {
      return res.status(400).json({ message: 'Status must have either text or media' });
    }

    // Create status
    const status = await Status.create({
      userId: req.user._id,
      text: text || null,
      mediaUrl: mediaUrl || null
    });

    // Populate user info
    const populatedStatus = await Status.findById(status._id)
      .populate('userId', '_id displayName avatarUrl');

    res.status(201).json(populatedStatus);
  } catch (error) {
    console.error('Create status error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Invalid input data' });
    }
    res.status(500).json({ message: 'Server error creating status' });
  }
};

// @desc    Delete status
// @route   DELETE /api/status/:id
// @access  Private
const deleteStatus = async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);

    if (!status) {
      return res.status(404).json({ message: 'Status not found' });
    }

    // Check if user owns the status
    if (!status.userId.equals(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to delete this status' });
    }

    await Status.findByIdAndDelete(req.params.id);

    res.json({ message: 'Status deleted' });
  } catch (error) {
    console.error('Delete status error:', error);
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Invalid status ID' });
    }
    res.status(500).json({ message: 'Server error deleting status' });
  }
};

// @desc    Mark status as viewed
// @route   POST /api/status/:id/view
// @access  Private
const viewStatus = async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);

    if (!status) {
      return res.status(404).json({ message: 'Status not found' });
    }

    // Check if user has already viewed this status
    const hasViewed = status.viewedBy.some(id => id.equals(req.user._id));
    if (!hasViewed) {
      status.viewedBy.push(req.user._id);
      await status.save();
    }

    res.json({ message: 'Status marked as viewed' });
  } catch (error) {
    console.error('View status error:', error);
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Invalid status ID' });
    }
    res.status(500).json({ message: 'Server error marking status as viewed' });
  }
};

module.exports = {
  getStatuses,
  createStatus,
  deleteStatus,
  viewStatus
};