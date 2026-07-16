const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const asyncHandler = require('../utils/asyncHandler');
const sendEmail = require('../utils/sendEmail');

// Reason: Secure user registration that ensures unique emails and hashes passwords.
// How: Checks if the user exists, then generates a salt and hashes the password via bcrypt before saving to MongoDB. Returns a JWT for immediate login state.
const register = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
  
  let user = await User.findOne({ email });
  if (user) {
    res.status(400);
    throw new Error('User already exists'); // Handled by error middleware
  }
  
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  
  user = new User({
    name,
    email,
    password: hashedPassword,
    role: role || 'client'
  });
  
  await user.save();
  
  // Reason: We need a payload to sign into the JWT token that identifies the user on subsequent requests.
  // How: The payload contains the user's MongoDB ID and role, signed with the server's secret key.
  const payload = {
    user: {
      id: user._id,
      role: user.role
    }
  };
  
  jwt.sign(
    payload,
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '1d' },
    (err, token) => {
      if (err) throw err;
      res.status(201).json({
        message: 'User registered successfully',
        token,
        user: { 
          id: user._id, 
          name: user.name, 
          email: user.email, 
          role: user.role,
          onboardingStep: user.onboardingStep,
          onboardingComplete: user.onboardingComplete
        }
      });
    }
  );
});

// Reason: Authenticates an existing user using their email and password.
// How: Finds the user by email, uses bcrypt.compare to check the hashed password against the stored hash. If valid, generates and returns a JWT.
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  
  const user = await User.findOne({ email });
  if (!user) {
    res.status(401);
    throw new Error('Invalid credentials');
  }
  
  const isMatch = await bcrypt.compare(password, user.password);
  
  if (!isMatch) {
     res.status(401);
     throw new Error('Invalid credentials');
  }
  
  const payload = {
    user: {
      id: user._id,
      role: user.role
    }
  };
  
  jwt.sign(
    payload,
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '1d' },
    (err, token) => {
      if (err) throw err;
      res.json({
        message: 'Login successful',
        token,
        user: { 
          id: user._id, 
          name: user.name, 
          email: user.email, 
          role: user.role, 
          tenantId: user.tenantId,
          onboardingStep: user.onboardingStep,
          onboardingComplete: user.onboardingComplete
        }
      });
    }
  );
});

// Reason: Initiates the password reset flow by generating a 6-digit OTP and sending it to the user.
// How: Finds user by email, generates OTP, hashes it via bcrypt, saves to DB with a 15 min expiry, and calls sendEmail.
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  
  const user = await User.findOne({ email });
  if (!user) {
    res.status(404);
    throw new Error('There is no user with that email address');
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Hash OTP and set expiry
  const salt = await bcrypt.genSalt(10);
  user.resetPasswordOtp = await bcrypt.hash(otp, salt);
  user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
  
  await user.save();

  // Send Email
  const message = `Your password reset OTP is: ${otp}\n\nIt is valid for 15 minutes. If you did not request this, please ignore this email.`;
  
  try {
    await sendEmail({
      email: user.email,
      subject: 'Password Reset OTP',
      message
    });
    
    res.status(200).json({ message: 'OTP sent to email' });
  } catch (err) {
    user.resetPasswordOtp = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    
    res.status(500);
    throw new Error('Email could not be sent');
  }
});

// Reason: Validates the OTP provided by the user before allowing them to set a new password.
// How: Finds user, checks if OTP has expired, uses bcrypt to compare provided OTP with hashed OTP. Returns a temporary reset token.
const verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  
  const user = await User.findOne({ 
    email, 
    resetPasswordExpires: { $gt: Date.now() } 
  });
  
  if (!user) {
    res.status(400);
    throw new Error('OTP is invalid or has expired');
  }
  
  const isMatch = await bcrypt.compare(otp.toString(), user.resetPasswordOtp);
  if (!isMatch) {
    res.status(400);
    throw new Error('Invalid OTP');
  }
  
  // Create a temporary token valid for 15 minutes for the reset step
  const tempToken = jwt.sign(
    { id: user._id, email: user.email, purpose: 'reset-password' },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '15m' }
  );
  
  res.status(200).json({ 
    message: 'OTP verified successfully',
    resetToken: tempToken 
  });
});

// Reason: Finalizes the password reset flow by updating the user's password.
// How: Verifies the temporary JWT, hashes the new password, updates the DB, and clears the OTP fields.
const resetPassword = asyncHandler(async (req, res) => {
  const { resetToken, newPassword } = req.body;
  
  if (!resetToken || !newPassword) {
    res.status(400);
    throw new Error('Missing token or new password');
  }
  
  try {
    const decoded = jwt.verify(resetToken, process.env.JWT_SECRET || 'secret');
    
    if (decoded.purpose !== 'reset-password') {
      res.status(400);
      throw new Error('Invalid token purpose');
    }
    
    const user = await User.findById(decoded.id);
    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    
    // Clear OTP fields
    user.resetPasswordOtp = undefined;
    user.resetPasswordExpires = undefined;
    
    await user.save();
    
    res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
    
  } catch (err) {
    res.status(401);
    throw new Error('Invalid or expired token');
  }
});

module.exports = {
  register,
  login,
  forgotPassword,
  verifyOtp,
  resetPassword
};
