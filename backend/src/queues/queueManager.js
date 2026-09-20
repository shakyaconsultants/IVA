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
async function processLeadBatch(rawLeads, campaignId, batch = {}) {
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
      if (invalidPhones <= 3) {
        console.warn(`[Lead Import] Invalid phone value received: ${JSON.stringify(raw.phone)}`);
      }
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
        importBatchId: batch.batchId,
        importFileName: batch.fileName || '',
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
 * UK Local Time (Europe/London) helper
 */
function getUkCurrentTime(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

/**
 * Checks if a given time is within configured calling hours (Europe/London)
 */
function isWithinCallingHours(callingHoursStart = '09:00', callingHoursEnd = '19:00', date = new Date()) {
  if (!callingHoursStart || !callingHoursEnd || callingHoursStart === callingHoursEnd) {
    return true;
  }
  const current = getUkCurrentTime(date);
  if (callingHoursStart < callingHoursEnd) {
    return current >= callingHoursStart && current < callingHoursEnd;
  }
  // Crosses midnight (e.g. 21:00 to 07:00)
  return current >= callingHoursStart || current < callingHoursEnd;
}

/**
 * Continuously replenishes the campaign dialing queue and evaluates completion
 */
async function replenishCampaignQueue(campaignId) {
  if (!campaignId) return;
  const campaign = await Campaign.findById(campaignId);
  if (!campaign || campaign.status !== 'running') return;

  // Count active or queued leads to avoid over-filling
  const activeOrQueuedCount = await Lead.countDocuments({
    campaignId,
    status: { $in: ['queued', 'dialing', 'ringing', 'in-call', 'transferring'] }
  });

  const targetBuffer = 50;
  const needed = targetBuffer - activeOrQueuedCount;

  if (needed > 0) {
    const pendingLeads = await Lead.find({ campaignId, status: 'new' })
      .sort({ createdAt: 1 })
      .limit(needed);

    for (const rawLead of pendingLeads) {
      // Atomic claim: only transition 'new' -> 'queued'
      const claimedLead = await Lead.findOneAndUpdate(
        { _id: rawLead._id, status: 'new' },
        { $set: { status: 'queued' } },
        { new: true }
      );
      if (!claimedLead) continue;

      if (dialQueue && getIsRedisAvailable()) {
        await dialQueue.add('dialLead', { leadId: claimedLead._id, campaignId });
      } else {
        memoryDialQueue.push({ leadId: claimedLead._id, campaignId });
      }
    }

    if (!getIsRedisAvailable() && !isMemoryDialerRunning && memoryDialQueue.length > 0) {
      startMemoryDialerLoop();
    }
  }

  // Check if campaign is completed:
  // No leads left in new, queued, dialing, ringing, in-call, transferring, AND no active calls
  const remainingWork = await Lead.countDocuments({
    campaignId,
    status: { $in: ['new', 'queued', 'dialing', 'ringing', 'in-call', 'transferring'] }
  });

  const activeCalls = await Call.countDocuments({
    campaignId,
    status: { $in: ['initiated', 'ringing', 'in-call', 'transferring'] }
  });

  if (remainingWork === 0 && activeCalls === 0) {
    await Campaign.findByIdAndUpdate(campaignId, {
      status: 'completed',
      updatedAt: new Date()
    });
    console.log(`[Campaign] Campaign ${campaign.name} (${campaignId}) marked as COMPLETED.`);
  }
}

/**
 * Start Campaign Dialing Loop (Initial fill & continuous trigger)
 */
async function triggerCampaignDial(campaignId) {
  return replenishCampaignQueue(campaignId);
}

/**
 * Dispatches a single lead call respecting concurrency, calling hours, and CPS
 */
async function dispatchDialJob(leadId, campaignId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign || campaign.status !== 'running') {
    // Campaign is not running (paused or stopped).
    // Revert lead from 'queued' to 'new' so it can be dialed when campaign resumes.
    await Lead.findOneAndUpdate(
      { _id: leadId, status: 'queued' },
      { $set: { status: 'new' } }
    );
    return;
  }

  // 1. Check Calling Hours (Europe/London)
  if (!isWithinCallingHours(campaign.callingHoursStart, campaign.callingHoursEnd)) {
    console.log(`[Campaign Dial] Outside calling hours (${campaign.callingHoursStart} - ${campaign.callingHoursEnd} UK). Deferring lead ${leadId}.`);
    if (dialQueue && getIsRedisAvailable()) {
      await dialQueue.add('dialLead', { leadId, campaignId }, { delay: 60000 });
    } else {
      memoryDialQueue.push({ leadId, campaignId, deferUntil: Date.now() + 60000 });
    }
    return;
  }

  // 2. Check Active Calls Limit (Concurrency)
  const activeCallsCount = await Call.countDocuments({
    campaignId,
    status: { $in: ['initiated', 'ringing', 'in-call', 'transferring'] }
  });

  if (activeCallsCount >= (campaign.concurrentCalls || 5)) {
    // Concurrency full, re-queue for later
    if (dialQueue && getIsRedisAvailable()) {
      await dialQueue.add('dialLead', { leadId, campaignId }, { delay: 2000 });
    } else {
      memoryDialQueue.push({ leadId, campaignId, deferUntil: Date.now() + 2000 });
    }
    return;
  }

  // 3. Atomically transition lead from 'queued' to 'dialing'
  const lead = await Lead.findOneAndUpdate(
    { _id: leadId, status: 'queued' },
    { $set: { status: 'dialing' } },
    { new: true }
  );
  if (!lead) {
    // Lead was not in 'queued' status (already dialed, claimed, or cancelled)
    return;
  }

  // 4. Execute Twilio outbound call
  try {
    await twilioService.originateCall({
      lead,
      campaign
    });
  } catch (err) {
    console.error(`[Campaign Dial] Twilio call failed for lead ${leadId}: ${err.message}`);
    // Replenish campaign since this failed call released a slot
    await replenishCampaignQueue(campaignId);
    throw err;
  }
}

function startMemoryDialerLoop() {
  if (isMemoryDialerRunning) return;
  isMemoryDialerRunning = true;

  const interval = setInterval(async () => {
    if (memoryDialQueue.length === 0) {
      isMemoryDialerRunning = false;
      clearInterval(interval);
      return;
    }

    const item = memoryDialQueue.shift();
    if (!item) return;

    if (item.deferUntil && item.deferUntil > Date.now()) {
      // Re-queue deferred item
      memoryDialQueue.push(item);
      return;
    }

    try {
      await dispatchDialJob(item.leadId, item.campaignId);
    } catch (err) {
      // Handled and logged inside dispatchDialJob
    }
  }, 1000); // 1 call per second pacing
}

module.exports = {
  initQueues,
  enqueueLeadBatch,
  processLeadBatch,
  triggerCampaignDial,
  dispatchDialJob,
  replenishCampaignQueue,
  isWithinCallingHours,
  getUkCurrentTime
};
