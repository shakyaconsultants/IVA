const express = require('express');
const router = express.Router();
const Transfer = require('../models/Transfer');

router.get('/', async (req, res) => {
  try {
    const transfers = await Transfer.find()
      .populate('leadId', 'name phone debtAmount')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(transfers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
