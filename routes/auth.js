const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Mock auth endpoints for onboarding flow purposes
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }
    
    user = new User({
      name,
      email,
      password, // Note: In production, hash this with bcrypt!
      role: role || 'client'
    });
    
    await user.save();
    
    res.status(201).json({
      message: 'User registered successfully',
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    // In production, compare hashed passwords
    if (password && user.password !== password) {
       return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    res.json({
      message: 'Login successful',
      user: { id: user._id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
