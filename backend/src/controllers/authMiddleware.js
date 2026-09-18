const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'iva_cc_super_secret_jwt_key_2026');
      req.user = await User.findById(decoded.id).select('-password');
      return next();
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  // Allow open dev access if no token header provided
  req.user = { _id: 'dev_user_id', name: 'Admin', email: 'admin@ivacc.co.uk', role: 'admin' };
  next();
};

module.exports = { protect };
