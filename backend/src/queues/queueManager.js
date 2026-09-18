const { Queue, Worker } = require('bullmq');
const mongoose = require('mongoose');
const { redisConfig, getIsRedisAvailable } = require('../config/redis');
const Lead = require('../models/Lead');
const Campaign = require('../models/Campaign');
const CampaignLead = require('../models/CampaignLead');
const Call = require('../models/Call');
const twilioService = require('../services/twilioService');
const { normalizeUkPhone } = require('../services/ukPhoneValidator');

let leadQueue = null;
let dialQueue = null;

// Local in-memory queue state for offline fallback
const memoryDialQueue = [];
let isMemoryDialerRunning = false;

function initQueues() {
  if (getIsRedisAvailable()) {
    try {
      leadQueue = new Queue('leadQueue', { connection: redisConfig });
      dialQueue = new Queue('dialQueue', { connection: redisConfig });

      // Worker: Lead Queue
      new Worker(
        'leadQueue',
        async (job) => {
          console.log(`[BullMQ Lead Worker] Processing job ${job.id}`);
          const { leads, campaignId } = job.data;
          await processLeadBatch(leads, campaignId);
        },
        { connection: redisConfig }
      );

      // Worker: Dial Queue
      new Worker(
        'dialQueue',
        async (job) => {
          const { leadId, campaignId } = job.data;
          await dispatchDialJob(leadId, campaignId);
        },
        { connection: redisConfig, concurrency: 5 }
      );

      console.log('[Queue] BullMQ workers initialized with Redis.');
      return;
    } catch (err) {
      console.warn(`[Queue] BullMQ init failed, using local queue: ${err.message}`);
    }
  }

  console.log('[Queue] Operating in Local In-Memory Queue Mode (Option B Windows Dev).');
}

/**
 * Push leads into queue
 */
async function enqueueLeadBatch(leads, campaignId) {
  if (leadQueue && getIsRedisAvailable()) {
    await leadQueue.add('importBatch', { leads, campaignId });
  } else {
    // Process asynchronously in memory
    setImmediate(async () => {
      await processLeadBatch(leads, campaignId);
    });
  }
}

/**
 * Process lead batch: validate, normalize UK numbers, dedupe, save
 */
async function processLeadBatch(rawLeads, campaignId) {
  let imported = 0;
  let skipped = 0;
  let invalidPhones = 0;
  let duplicates = 0;
  let databaseErrors = 0;
  const validCampaignId = campaignId && mongoose.isValidObjectId(campaignId) ? campaignId : undefined;

  for (const raw of rawLeads) {
    const normalizedPhone = normalizeUkPhone(raw.phone || raw.Phone || raw.Mobile || raw.telephone);

    if (!normalizedPhone) {
      skipped++;
      invalidPhones++;
      continue;
    }

    const name = raw.name || raw.Name || `${raw.firstName || ''} ${raw.lastName || ''}`.trim() || 'Prospect';
    const email = raw.email || raw.Email || '';
    const debtAmount = parseFloat(raw.debtAmount || raw.Debt || raw.Amount || 0);
    const creditorCount = parseInt(raw.creditors || raw.Creditors || 0, 10);
    const postcode = raw.postcode || raw.Postcode || '';

    try {
      // Check existing in campaign
      const duplicateQuery = { phone: normalizedPhone };
      if (validCampaignId) duplicateQuery.campaignId = validCampaignId;
      const existing = await Lead.findOne(duplicateQuery);
      if (existing) {
        skipped++;
        duplicates++;
        continue;
      }

      const lead = await Lead.create({
        phone: normalizedPhone,
        name,
        email,
        campaignId: validCampaignId,
        debtAmount,
        creditorCount,
        postcode,
        status: 'new'
      });

      if (validCampaignId) {
        await CampaignLead.create({
          campaignId: validCampaignId,
          leadId: lead._id,
          status: 'pending'
        });
      }

      imported++;
    } catch (err) {
      skipped++;
      databaseErrors++;
      if (databaseErrors <= 3) {
        console.warn(`[Lead Import] Row skipped: ${err.message}`);
      }
    }
  }

  if (validCampaignId) {
    await Campaign.findByIdAndUpdate(validCampaignId, {
      $inc: { totalLeads: imported }
    });
  }

  console.log(`[Lead Import] Completed: ${imported} imported, ${skipped} skipped (invalid phones: ${invalidPhones}, duplicates: ${duplicates}, database errors: ${databaseErrors}).`);
  return { imported, skipped, invalidPhones, duplicates, databaseErrors };
}

/**
 * Start Campaign Dialing Loop
 */
async function triggerCampaignDial(campaignId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign || campaign.status !== 'running') return;

  // Find pending leads for this campaign
  const pendingLeads = await Lead.find({ campaignId, status: 'new' }).limit(50);

  for (const lead of pendingLeads) {
    if (dialQueue && getIsRedisAvailable()) {
      await dialQueue.add('dialLead', { leadId: lead._id, campaignId });
    } else {
      memoryDialQueue.push({ leadId: lead._id, campaignId });
    }
  }

  if (!isMemoryDialerRunning) {
    startMemoryDialerLoop();
  }
}

/**
 * Dispatches a single lead call respecting concurrency and CPS
 */
async function dispatchDialJob(leadId, campaignId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign || campaign.status !== 'running') return;

  // Check active calls limit
  const activeCallsCount = await Call.countDocuments({
    campaignId,
    status: { $in: ['initiated', 'ringing', 'in-call', 'transferring'] }
  });

  if (activeCallsCount >= (campaign.concurrentCalls || 5)) {
    // Re-queue for later
    if (dialQueue && getIsRedisAvailable()) {
      await dialQueue.add('dialLead', { leadId, campaignId }, { delay: 2000 });
    } else {
      memoryDialQueue.push({ leadId, campaignId });
    }
    return;
  }

  const lead = await Lead.findById(leadId);
  if (!lead || lead.status !== 'new') return;

  // Execute Twilio outbound call
  await twilioService.originateCall({
    lead,
    campaign
  });
}

function startMemoryDialerLoop() {
  isMemoryDialerRunning = true;

  const interval = setInterval(async () => {
    if (memoryDialQueue.length === 0) {
      isMemoryDialerRunning = false;
      clearInterval(interval);
      return;
    }

    const item = memoryDialQueue.shift();
    if (item) {
      try {
        await dispatchDialJob(item.leadId, item.campaignId);
      } catch (err) {
        console.error(`[Campaign Dial] Twilio call failed: ${err.message}`);
      }
    }
  }, 1000); // 1 call per second pacing
}

module.exports = {
  initQueues,
  enqueueLeadBatch,
  processLeadBatch,
  triggerCampaignDial,
  dispatchDialJob
};
