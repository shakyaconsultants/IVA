require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Company = require('./models/Company');
const Lead = require('./models/Lead');
const Campaign = require('./models/Campaign');
const AgentPrompt = require('./models/AgentPrompt');
const Disposition = require('./models/Disposition');
const Settings = require('./models/Settings');

async function seedData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/iva_cc_db');
    console.log('[Seed] Connected to MongoDB');

    // Clean existing
    await Promise.all([
      User.deleteMany({}),
      Company.deleteMany({}),
      Lead.deleteMany({}),
      Campaign.deleteMany({}),
      AgentPrompt.deleteMany({}),
      Disposition.deleteMany({}),
      Settings.deleteMany({})
    ]);

    // 1. Create Company
    const company = await Company.create({
      name: 'Beacon Debt Advisory Ltd',
      ukCompanyNumber: '12894562',
      contactEmail: 'contact@beaconadvisory.co.uk',
      transferPhone: '+442080009999'
    });

    // 2. Create Admin User
    const admin = await User.create({
      name: 'Operations Manager',
      email: 'admin@ivacc.co.uk',
      password: 'password123',
      role: 'admin',
      companyId: company._id
    });

    // 3. Create Default Agent Prompt
    const agent = await AgentPrompt.create({
      name: 'Sarah - Senior UK IVA Qualifier',
      companyName: 'Beacon Debt Advisory',
      agentName: 'Sarah Collins',
      voice: 'alloy',
      isDefault: true
    });

    // 4. Create Default Campaign
    const campaign = await Campaign.create({
      name: 'UK Debt Recovery Q4 - England & Wales',
      description: 'High-intent unsecured personal debt leads (>£5k, 2+ creditors)',
      callingHoursStart: '09:00',
      callingHoursEnd: '19:00',
      maxCPS: 2,
      concurrentCalls: 5,
      agentId: agent._id,
      status: 'running',
      totalLeads: 8,
      dialedLeads: 0
    });

    // 5. Seed UK Leads
    const sampleLeads = [
      { name: 'David Smith', phone: '+447700900123', email: 'd.smith@outlook.com', debtAmount: 9500, creditorCount: 3, postcode: 'M1 4BT' },
      { name: 'Emma Watson', phone: '+447700900456', email: 'emma.w@gmail.com', debtAmount: 14200, creditorCount: 4, postcode: 'B1 1AA' },
      { name: 'James Taylor', phone: '+447700900789', email: 'j.taylor@yahoo.co.uk', debtAmount: 6800, creditorCount: 2, postcode: 'LS1 2UR' },
      { name: 'Sarah Jenkins', phone: '+447700900321', email: 'sarah.j@hotmail.com', debtAmount: 18500, creditorCount: 5, postcode: 'SW1A 1AA' },
      { name: 'Michael Brown', phone: '+447700900654', email: 'mbrown99@outlook.com', debtAmount: 5200, creditorCount: 2, postcode: 'NE1 1AD' },
      { name: 'Oliver Clarke', phone: '+447700900987', email: 'o.clarke@btinternet.com', debtAmount: 12000, creditorCount: 3, postcode: 'CF10 1EP' },
      { name: 'Sophie Evans', phone: '+447700900111', email: 'sophie.evans@live.co.uk', debtAmount: 8400, creditorCount: 3, postcode: 'BS1 5TR' },
      { name: 'Harry Wilson', phone: '+447700900222', email: 'harry.w@gmail.com', debtAmount: 4300, creditorCount: 1, postcode: 'L1 8JQ' }
    ];

    for (const leadData of sampleLeads) {
      await Lead.create({
        ...leadData,
        campaignId: campaign._id,
        status: 'new'
      });
    }

    // 6. Create Dispositions
    const dispositions = [
      { code: 'QUALIFIED', label: 'Qualified - Transferred', category: 'positive', isInterested: true, isTransfer: true },
      { code: 'INTERESTED_CALLBACK', label: 'Interested - Callback Scheduled', category: 'positive', isInterested: true },
      { code: 'NOT_INTERESTED', label: 'Not Interested', category: 'negative' },
      { code: 'VOICEMAIL', label: 'Voicemail Drop Delivered', category: 'neutral' },
      { code: 'DNC', label: 'Do Not Call (TPS/DNC)', category: 'negative', isDnc: true },
      { code: 'NO_ANSWER', label: 'No Answer / Ringing Out', category: 'neutral' },
      { code: 'BUSY', label: 'Line Busy', category: 'neutral' }
    ];

    for (const disp of dispositions) {
      await Disposition.create(disp);
    }

    // 7. Seed Settings
    await Settings.create({ key: 'global_config' });

    console.log('[Seed] Database seeded successfully with UK IVA campaign and leads.');
    process.exit(0);
  } catch (err) {
    console.error(`[Seed] Error: ${err.message}`);
    process.exit(1);
  }
}

seedData();
