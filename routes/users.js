const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Message = require('../models/Message');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, req.user.id + '-' + Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Middleware to protect routes
const protect = (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Not authorized, no token' });
  }
};

// Get Chat List (following + users who have sent a message to current user)
router.get('/', protect, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    
    // Find users who have sent a message to current user OR current user has sent a message to
    const messages = await Message.find({
      $or: [
        { receiverId: req.user.id },
        { senderId: req.user.id }
      ]
    });
    
    const messageUserIds = new Set();
    messages.forEach(msg => {
      if (msg.senderId.toString() !== req.user.id) messageUserIds.add(msg.senderId.toString());
      if (msg.receiverId.toString() !== req.user.id) messageUserIds.add(msg.receiverId.toString());
    });

    const chatUserIds = [...new Set([...(currentUser.following || []).map(id => id.toString()), ...messageUserIds])];

    const users = await User.find({ 
      _id: { $in: chatUserIds, $ne: req.user.id },
      role: { $ne: 'admin' } 
    }).select('-password');
    
    res.status(200).json(users);
  } catch (error) {
    console.error('Error fetching chat list:', error);
    res.status(500).json({ error: 'Error fetching users' });
  }
});

// Discover users (all users except current, with follow status)
router.get('/discover', protect, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    const followingIds = currentUser.following || [];
    
    const users = await User.find({ 
      _id: { $ne: req.user.id }, 
      role: { $ne: 'admin' } 
    }).select('-password').lean();
    
    const usersWithFollowStatus = users.map(user => ({
      ...user,
      isFollowing: followingIds.some(id => id.toString() === user._id.toString())
    }));

    res.status(200).json(usersWithFollowStatus);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching discover users' });
  }
});

// Toggle follow user
router.post('/follow/:id', protect, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const currentUserId = req.user.id;

    if (targetUserId === currentUserId) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }

    const currentUser = await User.findById(currentUserId);
    const targetUser = await User.findById(targetUserId);

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isFollowing = currentUser.following.includes(targetUserId);

    if (isFollowing) {
      // Unfollow
      currentUser.following.pull(targetUserId);
      targetUser.followers.pull(currentUserId);
    } else {
      // Follow
      currentUser.following.push(targetUserId);
      targetUser.followers.push(currentUserId);
    }

    await currentUser.save();
    await targetUser.save();

    res.status(200).json({ success: true, isFollowing: !isFollowing });
  } catch (error) {
    console.error('Error following user:', error);
    res.status(500).json({ error: 'Error toggling follow status' });
  }
});

// Update profile (Avatar and/or PIN)
router.put('/profile', protect, upload.single('avatar'), async (req, res) => {
  try {
    const { chatPin } = req.body;
    let updateFields = {};

    if (req.file) {
      updateFields.avatar = `http://localhost:5000/uploads/${req.file.filename}`;
    }

    if (chatPin) {
      const salt = await bcrypt.genSalt(10);
      updateFields.chatPin = await bcrypt.hash(chatPin, salt);
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateFields },
      { new: true }
    ).select('-password');

    res.status(200).json(updatedUser);
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Error updating profile' });
  }
});

module.exports = router;
