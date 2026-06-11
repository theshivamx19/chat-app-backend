const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Message = require('../models/Message');
const jwt = require('jsonwebtoken');

// Middleware to protect routes and verify admin
const protectAdmin = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
      
      const user = await User.findById(decoded.id).select('-password');
      if (user && user.role === 'admin') {
        req.user = user;
        next();
      } else {
        return res.status(403).json({ error: 'Not authorized as an admin' });
      }
    } catch (error) {
      return res.status(401).json({ error: 'Not authorized, token failed' });
    }
  } else {
    return res.status(401).json({ error: 'Not authorized, no token' });
  }
};

// Get all users for admin dashboard
router.get('/users', protectAdmin, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } }).select('-password');
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching users' });
  }
});

// Get messages between two specific users
router.get('/messages/:userA/:userB', protectAdmin, async (req, res) => {
  try {
    const { userA, userB } = req.params;

    const messages = await Message.find({
      $or: [
        { senderId: userA, receiverId: userB },
        { senderId: userB, receiverId: userA }
      ]
    }).sort({ createdAt: 1 }); // Oldest to newest

    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching messages' });
  }
});

module.exports = router;
