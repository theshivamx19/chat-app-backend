require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const Message = require('./models/Message');
const User = require('./models/User');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);

// Enable CORS
app.use(cors({
  origin: '*', // For development. In production, specify your frontend URL
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

app.use(express.json());

// Serve uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/admin', adminRoutes);

// Database Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chat-app')
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Socket.io Setup
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Map to keep track of user socket ids
const userSockets = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  const broadcastOnlineUsers = () => {
    io.emit('online_users', Array.from(userSockets.keys()));
  };

  // When a user logs in, they join with their userId
  socket.on('register_user', (userId) => {
    userSockets.set(userId, socket.id);
    console.log(`User ${userId} registered with socket ${socket.id}`);
    broadcastOnlineUsers();
  });

  socket.on('send_message', async (data) => {
    try {
      const { senderId, receiverId, text } = data;

      // Save message to database
      const newMessage = new Message({ senderId, receiverId, text });
      await newMessage.save();

      // Find recipient's socket
      const receiverSocketId = userSockets.get(receiverId);

      // If receiver is online, emit to them
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('receive_message', newMessage);
      }

      // Emit back to sender so they can update their UI instantly
      socket.emit('receive_message', newMessage);

    } catch (err) {
      console.error('Error sending message:', err);
    }
  });

  socket.on('typing', ({ senderId, receiverId }) => {
    const receiverSocketId = userSockets.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('typing', { senderId });
    }
  });

  socket.on('stop_typing', ({ senderId, receiverId }) => {
    const receiverSocketId = userSockets.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('stop_typing', { senderId });
    }
  });

  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.id}`);
    // Remove user from map
    for (const [userId, socketId] of userSockets.entries()) {
      if (socketId === socket.id) {
        userSockets.delete(userId);
        broadcastOnlineUsers();

        // Update last seen
        const now = new Date();
        User.findByIdAndUpdate(userId, { lastSeen: now }).catch(err => console.error('Error updating lastSeen:', err));
        io.emit('user_offline', { userId, lastSeen: now });
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
