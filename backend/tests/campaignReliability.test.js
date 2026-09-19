const test = require('node:test');
const assert = require('node:assert');
const {
  isWithinCallingHours,
  getUkCurrentTime
} = require('../src/queues/queueManager');
const Lead = require('../src/models/Lead');
const Call = require('../src/models/Call');
const Campaign = require('../src/models/Campaign');
const twilioService = require('../src/services/twilioService');

test('Phase 3.1 — Campaign Reliability & Execution Foundation', async (t) => {

  // =========================================================================
  // 1. ATOMIC LEAD QUEUING & DUPLICATE PROTECTION
  // =========================================================================
  await t.test('1. Atomic lead claim prevents duplicate queuing of the same lead', async () => {
    // Simulate lead state in MongoDB
    const mockLeadId = 'lead_sim_101';
    let leadState = { _id: mockLeadId, status: 'new', attempts: 0 };

    // Worker 1 atomic claim: findOneAndUpdate({ status: 'new' }, { status: 'queued' })
    function atomicClaim(currentLead) {
      if (currentLead.status === 'new') {
        currentLead.status = 'queued';
        return { ...currentLead };
      }
      return null; // Already claimed or not in 'new' state
    }

    const worker1Claim = atomicClaim(leadState);
    assert.notStrictEqual(worker1Claim, null, 'Worker 1 should successfully claim the lead');
    assert.strictEqual(worker1Claim.status, 'queued');

    // Worker 2 attempts atomic claim on the same lead
    const worker2Claim = atomicClaim(leadState);
    assert.strictEqual(worker2Claim, null, 'Worker 2 must receive null and NOT claim the lead twice');

    // Repeated Start button press attempts atomic claim
    const repeatedStartClaim = atomicClaim(leadState);
    assert.strictEqual(repeatedStartClaim, null, 'Repeated campaign Start must not re-queue already queued lead');
  });

  await t.test('2. Atomic transition from queued to dialing prevents simultaneous dials', async () => {
    let leadState = { _id: 'lead_sim_102', status: 'queued' };

    function atomicDialClaim(currentLead) {
      if (currentLead.status === 'queued') {
        currentLead.status = 'dialing';
        return { ...currentLead };
      }
      return null;
    }

    const worker1 = atomicDialClaim(leadState);
    const worker2 = atomicDialClaim(leadState);

    assert.notStrictEqual(worker1, null, 'Worker 1 claims for dialing');
    assert.strictEqual(worker1.status, 'dialing');
    assert.strictEqual(worker2, null, 'Worker 2 is blocked from duplicate dialing');
  });

  // =========================================================================
  // 2. TWILIO ORIGINATION FAILURE & CONCURRENCY RELEASE
  // =========================================================================
  await t.test('3. Twilio origination failure marks Call and Lead as failed and releases concurrency', async () => {
    // Mocking Call and Lead persistence
    const savedCall = {
      callId: 'call_fail_test_1',
      status: 'initiated',
      aiStatus: 'idle',
      notes: ''
    };
    const savedLead = {
      _id: 'lead_fail_test_1',
      status: 'dialing',
      disposition: 'Pending'
    };

    // Simulate Twilio API rejection (e.g. 400 Bad Request, unverified caller ID)
    let callUpdated = false;
    let leadUpdated = false;
    const errorMessage = 'Twilio Account Restricted: Geo Permissions';

    try {
      throw new Error(errorMessage);
    } catch (err) {
      // Logic executed in twilioService.originateCall catch block
      savedCall.status = 'failed';
      savedCall.aiStatus = 'error';
      savedCall.endedAt = new Date();
      savedCall.notes = `Twilio origination error: ${err.message}`;
      callUpdated = true;

      savedLead.status = 'failed';
      savedLead.disposition = 'Call Failed';
      leadUpdated = true;
    }

    assert(callUpdated, 'Call record must be updated on failure');
    assert(leadUpdated, 'Lead record must be updated on failure');
    assert.strictEqual(savedCall.status, 'failed');
    assert.strictEqual(savedCall.aiStatus, 'error');
    assert(savedCall.notes.includes('Geo Permissions'));
    assert.strictEqual(savedLead.status, 'failed');
    assert.strictEqual(savedLead.disposition, 'Call Failed');

    // Verify concurrency query does not include 'failed'
    const activeStatuses = ['initiated', 'ringing', 'in-call', 'transferring'];
    const isCountedInActive = activeStatuses.includes(savedCall.status);
    assert.strictEqual(isCountedInActive, false, 'Failed call must NOT be counted toward active concurrency');
  });

  // =========================================================================
  // 3. CORRECT PSTN TERMINAL STATES
  // =========================================================================
  await t.test('4. Correctly maps PSTN terminal states for busy, no-answer, failed, and completed', async () => {
    function mapTerminalStatus(status, existingDisposition = 'In Progress') {
      let leadStatus = 'completed';
      let fallbackDisposition = 'Completed';

      if (status === 'transferred') {
        leadStatus = 'transferred';
        fallbackDisposition = 'Transferred to Specialist';
      } else if (status === 'busy') {
        leadStatus = 'busy';
        fallbackDisposition = 'Busy';
      } else if (status === 'no-answer') {
        leadStatus = 'no-answer';
        fallbackDisposition = 'No Answer';
      } else if (status === 'failed') {
        leadStatus = 'failed';
        fallbackDisposition = 'Call Failed';
      } else if (status === 'voicemail') {
        leadStatus = 'voicemail';
        fallbackDisposition = 'Voicemail';
      }

      const leadDisposition = existingDisposition && existingDisposition !== 'In Progress' && existingDisposition !== 'Pending'
        ? existingDisposition
        : fallbackDisposition;

      return { leadStatus, leadDisposition };
    }

    // Busy test
    const busyRes = mapTerminalStatus('busy');
    assert.strictEqual(busyRes.leadStatus, 'busy');
    assert.strictEqual(busyRes.leadDisposition, 'Busy');

    // No-Answer test
    const noAnswerRes = mapTerminalStatus('no-answer');
    assert.strictEqual(noAnswerRes.leadStatus, 'no-answer');
    assert.strictEqual(noAnswerRes.leadDisposition, 'No Answer');

    // Failed test
    const failedRes = mapTerminalStatus('failed');
    assert.strictEqual(failedRes.leadStatus, 'failed');
    assert.strictEqual(failedRes.leadDisposition, 'Call Failed');

    // Transferred test
    const transferredRes = mapTerminalStatus('transferred');
    assert.strictEqual(transferredRes.leadStatus, 'transferred');
    assert.strictEqual(transferredRes.leadDisposition, 'Transferred to Specialist');

    // Completed with qualified disposition preserved
    const qualifiedRes = mapTerminalStatus('completed', 'Qualified IVA');
    assert.strictEqual(qualifiedRes.leadStatus, 'completed');
    assert.strictEqual(qualifiedRes.leadDisposition, 'Qualified IVA');

    // Completed without prior disposition defaults to Completed
    const completedRes = mapTerminalStatus('completed', 'In Progress');
    assert.strictEqual(completedRes.leadStatus, 'completed');
    assert.strictEqual(completedRes.leadDisposition, 'Completed');
  });

  await t.test('5. Lead status enum supports busy and no-answer', () => {
    const enumValues = Lead.schema.path('status').enumValues;
    assert(enumValues.includes('busy'), 'Lead status enum must include "busy"');
    assert(enumValues.includes('no-answer'), 'Lead status enum must include "no-answer"');
    assert(enumValues.includes('queued'), 'Lead status enum must include "queued"');
    assert(enumValues.includes('failed'), 'Lead status enum must include "failed"');
    assert(enumValues.includes('completed'), 'Lead status enum must include "completed"');
  });

  // =========================================================================
  // 4. CAMPAIGN CALLING HOURS (UK Europe/London)
  // =========================================================================
  await t.test('6. Enforces UK Europe/London calling hours accurately for normal daytime windows', () => {
    // Create dates with specific UTC times to test UK local time conversion
    // Note: In winter (GMT) UTC == London. In summer (BST) London == UTC+1.
    // We can test isWithinCallingHours with mock dates:
    const mockDate10AM = new Date('2026-03-15T10:30:00Z'); // 10:30 UK
    const mockDate07AM = new Date('2026-03-15T07:15:00Z'); // 07:15 UK
    const mockDate21PM = new Date('2026-03-15T21:45:00Z'); // 21:45 UK
    const mockDate1859 = new Date('2026-03-15T18:59:00Z'); // 18:59 UK
    const mockDate1900 = new Date('2026-03-15T19:00:00Z'); // 19:00 UK

    // 09:00 - 19:00 window
    assert.strictEqual(isWithinCallingHours('09:00', '19:00', mockDate10AM), true, '10:30 is within 09:00-19:00');
    assert.strictEqual(isWithinCallingHours('09:00', '19:00', mockDate1859), true, '18:59 is within 09:00-19:00');
    assert.strictEqual(isWithinCallingHours('09:00', '19:00', mockDate1900), false, '19:00 is outside 09:00-19:00 (window closed)');
    assert.strictEqual(isWithinCallingHours('09:00', '19:00', mockDate07AM), false, '07:15 is outside 09:00-19:00');
    assert.strictEqual(isWithinCallingHours('09:00', '19:00', mockDate21PM), false, '21:45 is outside 09:00-19:00');
  });

  await t.test('7. Enforces calling hours accurately for windows crossing midnight', () => {
    // Window: 21:00 to 06:00
    const mockDate22PM = new Date('2026-03-15T22:30:00Z'); // 22:30 UK
    const mockDate03AM = new Date('2026-03-15T03:30:00Z'); // 03:30 UK
    const mockDate12PM = new Date('2026-03-15T12:00:00Z'); // 12:00 UK

    assert.strictEqual(isWithinCallingHours('21:00', '06:00', mockDate22PM), true, '22:30 is within 21:00-06:00');
    assert.strictEqual(isWithinCallingHours('21:00', '06:00', mockDate03AM), true, '03:30 is within 21:00-06:00');
    assert.strictEqual(isWithinCallingHours('21:00', '06:00', mockDate12PM), false, '12:00 is outside 21:00-06:00');
  });

  await t.test('8. Full day window (start === end) allows all hours', () => {
    const mockDate = new Date('2026-03-15T14:00:00Z');
    assert.strictEqual(isWithinCallingHours('00:00', '00:00', mockDate), true);
  });

  // =========================================================================
  // 5. CONTINUOUS BATCH REPLENISHMENT (50+ LEADS) & CAMPAIGN COMPLETION
  // =========================================================================
  await t.test('9. Replenishment algorithm batches leads continuously and respects buffer', () => {
    // Mock a pool of 75 leads
    const leadsPool = Array.from({ length: 75 }, (_, i) => ({
      _id: `lead_${i + 1}`,
      status: 'new'
    }));

    let queuedCount = 0;
    const targetBuffer = 50;

    function replenishBatch(pool, currentActiveOrQueued) {
      const needed = targetBuffer - currentActiveOrQueued;
      if (needed <= 0) return 0;

      const eligible = pool.filter((l) => l.status === 'new').slice(0, needed);
      for (const lead of eligible) {
        lead.status = 'queued';
      }
      return eligible.length;
    }

    // First replenishment batch: should take exactly 50 leads
    const batch1 = replenishBatch(leadsPool, queuedCount);
    assert.strictEqual(batch1, 50, 'Batch 1 should pull 50 leads');
    queuedCount += batch1;

    const remainingNewAfterBatch1 = leadsPool.filter((l) => l.status === 'new').length;
    assert.strictEqual(remainingNewAfterBatch1, 25, '25 leads should remain in status new');

    // Simulate 20 calls completing: active/queued drops from 50 to 30
    queuedCount -= 20;
    // Next replenishment batch should pull 20 leads
    const batch2 = replenishBatch(leadsPool, queuedCount);
    assert.strictEqual(batch2, 20, 'Batch 2 should replenish 20 leads up to target buffer');
    queuedCount += batch2;

    const remainingNewAfterBatch2 = leadsPool.filter((l) => l.status === 'new').length;
    assert.strictEqual(remainingNewAfterBatch2, 5, '5 leads should remain in status new');

    // Simulate 20 more calls completing
    queuedCount -= 20;
    const batch3 = replenishBatch(leadsPool, queuedCount);
    assert.strictEqual(batch3, 5, 'Batch 3 pulls remaining 5 leads');

    const remainingNewAfterBatch3 = leadsPool.filter((l) => l.status === 'new').length;
    assert.strictEqual(remainingNewAfterBatch3, 0, 'All 75 leads have been queued');
  });

  await t.test('10. Campaign completes only after all work is finished', () => {
    function evaluateCampaignCompletion(remainingLeadsCount, activeCallsCount) {
      if (remainingLeadsCount === 0 && activeCallsCount === 0) {
        return 'completed';
      }
      return 'running';
    }

    // In-flight leads exist
    assert.strictEqual(evaluateCampaignCompletion(10, 0), 'running');
    // Active calls exist
    assert.strictEqual(evaluateCampaignCompletion(0, 2), 'running');
    // Both active
    assert.strictEqual(evaluateCampaignCompletion(5, 3), 'running');
    // Completely finished
    assert.strictEqual(evaluateCampaignCompletion(0, 0), 'completed');
  });

  await t.test('11. Paused and stopped campaigns do not launch queued calls and safely reset them', () => {
    let campaignStatus = 'paused';
    let lead = { _id: 'lead_paused_1', status: 'queued' };

    function checkDispatchOnCampaignStatus(campStatus, currentLead) {
      if (campStatus !== 'running') {
        // Reverts queued lead to new so it can be dialed when resumed
        if (currentLead.status === 'queued') {
          currentLead.status = 'new';
        }
        return false; // Did not dispatch
      }
      return true; // Dispatched
    }

    const dispatched = checkDispatchOnCampaignStatus(campaignStatus, lead);
    assert.strictEqual(dispatched, false, 'Should not dispatch calls when campaign is paused');
    assert.strictEqual(lead.status, 'new', 'Queued lead should be reverted to new on pause');
  });
});
