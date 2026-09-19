const twilioService = require('../../services/twilioService');

async function handleEndCall({ reason = 'Call completed normally' }, session) {
  if (!session || !session.callId) {
    throw new Error('Valid session is required for end_call');
  }

  // Prevent duplicate execution
  if (session.isEnding || session.isEnded) {
    console.log(`[VOICE] duplicate end_call ignored for callId=${session.callId}`);
    return {
      success: true,
      ended: true,
      reason: session.endCallReason || reason,
      message: 'Call termination already in progress'
    };
  }

  console.log(`[VOICE] tool end_call initiated for callId=${session.callId}, reason=${reason}`);
  session.isEnding = true;
  session.endCallReason = reason;
  session.setConversationState('ENDING');
  if (session.aiProvider && typeof session.aiProvider.setEnding === 'function') {
    session.aiProvider.setEnding(true);
  }

  // Check if AI is currently generating/speaking audio, or if Twilio has buffered audio to play out
  const isAudioActive = session.aiProvider?.isResponding || 
                        session.aiProvider?.activeResponse || 
                        session.hasBufferedAudio;

  if (isAudioActive) {
    console.log(`[VOICE END] audio playback in progress; deferring hangup until Twilio mark confirmation for callId=${session.callId}`);
    return {
      success: true,
      pending: true,
      reason,
      message: 'Call termination deferred until audio playback completes'
    };
  }

  // Safety guard against false transcript immediate termination (e.g. Whisper hallucinating "Bye" on line noise)
  const isDeclineReason = /bye|not interested|declined|hung up|refused|declined to speak/i.test(reason);
  if (isDeclineReason && (session.durationSec || 0) < 15) {
    const customerUtterances = (session.transcript || [])
      .filter((t) => t.speaker === 'customer')
      .map((t) => (t.text || '').toLowerCase().trim());

    const noiseWords = ['bye', 'bye.', 'thank you', 'thank you.', 'thanks', 'you', 'hello', 'hello?'];
    const hasSubstantiveTurn = customerUtterances.some((u) => !noiseWords.includes(u) && u.length > 3);

    if (!hasSubstantiveTurn && customerUtterances.length === 0) {
      console.warn(`[VOICE TOOL] end_call rejected: premature termination on unverified customer speech for callId=${session.callId}`);
      return {
        success: false,
        blocked: true,
        message: 'Premature call termination blocked: customer has not completed a valid turn declining the call. Confirm customer intent verbally first.'
      };
    }
  }

  // If no audio is playing or buffered, hang up immediately
  console.log(`[VOICE END] no active audio; hanging up immediately for callId=${session.callId}`);
  await session.executeHangup(reason);

  return {
    success: true,
    ended: true,
    reason
  };
}

module.exports = {
  handleEndCall
};
