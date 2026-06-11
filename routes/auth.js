const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role, chatPin } = req.body;

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const pinToHash = chatPin || '0000';
    const hashedPin = await bcrypt.hash(pinToHash, salt);

    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      plainPassword: password,
      role: role === 'admin' ? 'admin' : 'user',
      chatPin: hashedPin
    });

    const savedUser = await newUser.save();
    
    // Generate JWT
    const token = jwt.sign({ id: savedUser._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    
    res.status(201).json({ 
      token, 
      user: { 
        _id: savedUser._id, 
        username: savedUser.username, 
        email: savedUser.email,
        avatar: savedUser.avatar,
        role: savedUser.role
      } 
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });

    res.status(200).json({ 
      token, 
      user: { 
        _id: user._id, 
        username: user.username, 
        email: user.email,
        avatar: user.avatar,
        role: user.role
      } 
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Verify Chat PIN
router.post('/verify-pin', async (req, res) => {
  try {
    const { userId, pin } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // Fallback if the default hash is a dummy value: if '0000' is provided and user has dummy default
    if (pin === '0000' && user.chatPin === '$2b$10$bI/s1z2xH2z4dO.J7rR.f.6eT7e7U7U7U7U7U7U7U7U7U7U7U7U7U') {
      return res.status(200).json({ success: true });
    }

    const isMatch = await bcrypt.compare(pin, user.chatPin);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid PIN' });
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error verifying PIN' });
  }
});

module.exports = router;
