const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const Lead = require('../models/Lead');
const { normalizeUkPhone } = require('../services/ukPhoneValidator');
const { processLeadBatch } = require('../queues/queueManager');

// Multer storage
const upload = multer({
  dest: path.join(__dirname, '../../uploads/'),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
});

/**
 * 1. Upload Excel or CSV file & parse columns
 * Screen: Upload Leads -> Step 1: Upload Excel -> Step 2: Map Columns
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const workbook = xlsx.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rawData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

    // Clean up temporary uploaded file
    try {
      fs.unlinkSync(filePath);
    } catch (e) {}

    if (!rawData || rawData.length === 0) {
      return res.status(400).json({ message: 'The uploaded sheet is empty' });
    }

    const headers = rawData[0].map((h) => String(h || '').trim()).filter(Boolean);
    const dataRows = rawData.slice(1);

    // Auto-detect common field mappings
    const suggestedMapping = {
      phone: headers.find((h) => /phone|mobile|tel|contact/i.test(h)) || '',
      name: headers.find((h) => /name|full.*name|first.*name/i.test(h)) || '',
      email: headers.find((h) => /email|mail/i.test(h)) || '',
      debtAmount: headers.find((h) => /debt|amount|balance/i.test(h)) || '',
      creditorCount: headers.find((h) => /creditor|lender/i.test(h)) || '',
      postcode: headers.find((h) => /postcode|postal|zip/i.test(h)) || ''
    };

    const rows = dataRows.map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] !== undefined ? row[i] : '';
      });
      return obj;
    });

    res.json({
      fileName: req.file.originalname,
      totalRows: rawData.length - 1,
      headers,
      suggestedMapping,
      previewRows: rows.slice(0, 10),
      rows
    });
  } catch (err) {
    res.status(500).json({ message: `Failed to process spreadsheet: ${err.message}` });
  }
});

/**
 * 2. Validate, Duplicate Check & Import
 */
router.post('/import', async (req, res) => {
  try {
    const { rows, mapping, campaignId } = req.body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'No lead rows provided for import' });
    }

    const mappedLeads = rows.map((row) => ({
      phone: row[mapping.phone] || '',
      name: row[mapping.name] || 'Prospect',
      email: row[mapping.email] || '',
      debtAmount: row[mapping.debtAmount] || 0,
      creditorCount: row[mapping.creditorCount] || 0,
      postcode: row[mapping.postcode] || ''
    }));

    const result = await processLeadBatch(mappedLeads, campaignId);
    res.json({
      message: 'Lead import completed',
      ...result
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 3. GET /api/leads - Lead Management list with filters
 */
router.get('/', async (req, res) => {
  try {
    const { campaignId, status, disposition, search, page = 1, limit = 50 } = req.query;
    const query = {};

    if (campaignId) query.campaignId = campaignId;
    if (status) query.status = status;
    if (disposition) query.disposition = disposition;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [leads, total] = await Promise.all([
      Lead.find(query)
        .populate('campaignId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10)),
      Lead.countDocuments(query)
    ]);

    res.json({
      leads,
      total,
      page: parseInt(page, 10),
      pages: Math.ceil(total / parseInt(limit, 10))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 4. GET /api/leads/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).populate('campaignId');
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 5. PUT /api/leads/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 6. DELETE /api/leads/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    res.json({ message: 'Lead deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
