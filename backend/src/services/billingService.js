/**
 * Calculates call cost based on duration, Twilio SIP rates, and OpenAI Realtime rates.
 */
function calculateCallCost(durationSec, settings) {
  if (!durationSec || durationSec <= 0) return 0;

  const twilioPerMin = settings?.billing?.twilioPerMinCostGbp || 0.015;
  const openAiPerMin = settings?.billing?.openAiVoicePerMinCostGbp || 0.06;

  const minutes = durationSec / 60;
  const twilioCost = minutes * twilioPerMin;
  const aiCost = minutes * openAiPerMin;

  const total = twilioCost + aiCost;
  return Math.round(total * 1000) / 1000; // 3 decimal places in GBP
}

module.exports = {
  calculateCallCost
};
