const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const User = require('../models/User');
const { getDbStatus } = require('../config/db');

router.get('/', async (req, res) => {
  try {
    let settings = await Settings.findOne({ key: 'global_config' });
    if (!settings) {
      settings = await Settings.create({ key: 'global_config' });
    }
    const dbStatus = getDbStatus();
    res.json({ ...settings.toObject(), dbStatus });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/test-db', async (req, res) => {
  res.status(410).json({ success: false, message: 'Database configuration is managed through the backend environment.' });
});

router.put('/', async (req, res) => {
  try {
    const allowedSettings = {
      amd: req.body.amd,
      dialer: req.body.dialer,
      billing: req.body.billing,
      updatedAt: new Date()
    };
    if (allowedSettings.dialer) delete allowedSettings.dialer.defaultTransferNumber;

    const settings = await Settings.findOneAndUpdate(
      { key: 'global_config' },
      allowedSettings,
      { new: true, upsert: true }
    );

    const dbStatus = getDbStatus();
    res.json({ message: 'Settings saved successfully', settings: { ...settings.toObject(), dbStatus } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Users management under settings
router.get('/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const user = await User.create({ name, email, password, role });
    res.status(201).json({ _id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User removed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
