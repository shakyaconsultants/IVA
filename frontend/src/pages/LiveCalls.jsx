import React, { useState, useEffect, useRef } from 'react';
import {
  PhoneCall,
  Radio,
  PhoneForwarded,
  PhoneOff,
  User,
  Clock,
  Sparkles,
  Bot,
  Voicemail,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import api from '../services/api';
import { useSocket } from '../context/SocketContext';

const LiveCalls = () => {
  const { socket } = useSocket();
  const [liveCalls, setLiveCalls] = useState([]);
  const [selectedCallId, setSelectedCallId] = useState(null);
  const [listening, setListening] = useState(false);
  const audioContextRef = useRef(null);
  const audioCursorRef = useRef(0);

  const playMulawAudio = (payload) => {
    if (!listening || !audioContextRef.current) return;
    const binary = atob(payload);
    const samples = new Float32Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      const value = (~binary.charCodeAt(index)) & 0xff;
      const sign = value & 0x80 ? -1 : 1;
      const exponent = (value >> 4) & 0x07;
      const mantissa = value & 0x0f;
      samples[index] = sign * ((mantissa * 2 + 33) * 2 ** exponent - 33) / 32768;
    }

    const audioContext = audioContextRef.current;
    const buffer = audioContext.createBuffer(1, samples.length, 8000);
    buffer.copyToChannel(samples, 0);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    const startAt = Math.max(audioContext.currentTime, audioCursorRef.current);
    source.start(startAt);
    audioCursorRef.current = startAt + buffer.duration;
  };

  useEffect(() => {
    fetchLiveCalls();
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on('call:new', (newCall) => {
      setLiveCalls((prev) => [newCall, ...prev.filter((c) => c.callId !== newCall.callId)]);
    });

    socket.on('call:update', (updated) => {
      setLiveCalls((prev) =>
        prev.map((c) => (c.callId === updated.callId ? { ...c, ...updated } : c))
      );
    });

    socket.on('call:duration', ({ callId, durationSec }) => {
      setLiveCalls((prev) =>
        prev.map((c) => (c.callId === callId ? { ...c, durationSec } : c))
      );
    });

    socket.on('transcript:update', ({ callId, speaker, text, timestamp }) => {
      setLiveCalls((prev) =>
        prev.map((c) => {
          if (c.callId !== callId) return c;
          const transcript = c.transcript ? [...c.transcript] : [];
          transcript.push({ speaker, text, timestamp });
          return { ...c, transcript };
        })
      );
    });

    socket.on('call:ended', ({ callId }) => {
      // Remove from live list after 3 seconds so operators can see disposition
      setTimeout(() => {
        setLiveCalls((prev) => prev.filter((c) => c.callId !== callId));
      }, 3000);
    });

    socket.on('call:audio', ({ callId, payload }) => {
      if (callId === selectedCallId) playMulawAudio(payload);
    });

    return () => {
      socket.off('call:new');
      socket.off('call:update');
      socket.off('call:duration');
      socket.off('transcript:update');
      socket.off('call:ended');
      socket.off('call:audio');
    };
  }, [socket, selectedCallId, listening]);

  const toggleListening = async () => {
    if (listening) {
      setListening(false);
      return;
    }
    const audioContext = audioContextRef.current || new AudioContext();
    audioContextRef.current = audioContext;
    await audioContext.resume();
    audioCursorRef.current = audioContext.currentTime;
    setListening(true);
  };

  const fetchLiveCalls = async () => {
    try {
      const res = await api.get('/calls/live');
      setLiveCalls(res.data);
      if (res.data.length > 0 && !selectedCallId) {
        setSelectedCallId(res.data[0].callId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleHotkeyTransfer = async (callId) => {
    try {
      await api.post(`/calls/${callId}/transfer`, {
        reason: 'Operator Hotkey Transfer'
      });
    } catch (err) {
      alert(err.response?.data?.message || 'Transfer failed');
    }
  };

  const handleHangup = async (callId) => {
    try {
      await api.post(`/calls/${callId}/hangup`, { reason: 'Operator Disconnected' });
    } catch (err) {
      alert(err.response?.data?.message || 'Hangup failed');
    }
  };

  const activeCall = liveCalls.find((c) => c.callId === selectedCallId) || liveCalls[0];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Live Active Calls Monitor</h2>
            <p className="text-xs text-slate-400">
              Twilio Voice call status, machine detection, and transfer controls
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Active Lines:</span>
            <span className="px-2.5 py-1 rounded-lg bg-teal-500/10 text-teal-400 font-bold border border-teal-500/20">
              {liveCalls.length} Calling
            </span>
          </div>
        </div>
      </div>

      {liveCalls.length === 0 ? (
        <div className="p-16 text-center bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
          <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center mx-auto text-slate-500">
            <PhoneCall className="w-6 h-6" />
          </div>
          <p className="text-white font-semibold text-sm">No Active Live Calls</p>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Dial a UK number using the quick test dialer in the header or launch a campaign to monitor live calls here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Active Calls List (Left) */}
          <div className="lg:col-span-5 space-y-3">
            {liveCalls.map((call) => {
              const isSelected = activeCall?.callId === call.callId;
              return (
                <div
                  key={call.callId}
                  onClick={() => setSelectedCallId(call.callId)}
                  className={`p-4 rounded-2xl border cursor-pointer transition relative overflow-hidden ${
                    isSelected
                      ? 'bg-slate-900 border-teal-500/50 shadow-md shadow-teal-500/10'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm font-bold text-white tracking-wide">
                      {call.leadPhone}
                    </span>
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                        call.status === 'in-call'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : call.status === 'ringing'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse'
                          : call.status === 'transferred'
                          ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {call.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="truncate">Lead: {call.leadId?.name || 'Prospect'}</span>
                    <div className="flex items-center gap-1 text-slate-300 font-mono">
                      <Clock className="w-3.5 h-3.5 text-teal-400" />
                      <span>{call.durationSec || 0}s</span>
                    </div>
                  </div>

                  {/* AMD & AI Status Badges */}
                  <div className="mt-3 flex items-center gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                    <span className="px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800 flex items-center gap-1">
                      {call.amdStatus === 'human' ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      ) : call.amdStatus === 'machine' ? (
                        <Voicemail className="w-3 h-3 text-amber-400" />
                      ) : (
                        <Radio className="w-3 h-3 text-slate-500" />
                      )}
                      <span>AMD: {call.amdStatus || 'Analyzing'}</span>
                    </span>

                    <span className="px-2 py-0.5 rounded bg-slate-950 text-teal-300 border border-slate-800 font-mono">
                      AI: {call.aiStatus || 'Connecting'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Call Details, Waveform & Live Transcript (Right) */}
          {activeCall && (
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col h-[650px] overflow-hidden">
              {/* Call Header */}
              <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-base text-white">{activeCall.leadPhone}</h3>
                    <span className="text-xs text-teal-400 font-mono">
                      Duration: {activeCall.durationSec || 0}s
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Lead: <span className="text-slate-200">{activeCall.leadId?.name || 'Prospect'}</span>
                  </p>
                </div>

                {/* Hotkey Controls */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleListening}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                      listening ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>{listening ? 'Listening' : 'Listen'}</span>
                  </button>
                  <button
                    onClick={() => handleHotkeyTransfer(activeCall.callId)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition shadow-md shadow-purple-600/20"
                  >
                    <PhoneForwarded className="w-3.5 h-3.5" />
                    <span>Hotkey Transfer</span>
                  </button>
                  <button
                    onClick={() => handleHangup(activeCall.callId)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 rounded-xl text-xs font-semibold transition"
                  >
                    <PhoneOff className="w-3.5 h-3.5" />
                    <span>End</span>
                  </button>
                </div>
              </div>

              {/* Live Simulated Waveform */}
              <div className="px-6 py-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-1.5 h-8">
                  {[40, 75, 30, 90, 60, 100, 45, 80, 20, 95, 50, 70, 35, 85].map((h, idx) => (
                    <span
                      key={idx}
                      style={{
                        height: activeCall.status === 'in-call' ? `${h}%` : '4px',
                        transition: 'height 0.2s ease'
                      }}
                      className="w-1.5 bg-teal-400/80 rounded-full"
                    />
                  ))}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                </div>
              </div>

              {/* Streaming Transcript */}
              <div className="flex-1 p-5 overflow-y-auto space-y-3 bg-slate-950/30">
                <div className="text-center mb-2">
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                    Live Call Transcription
                  </span>
                </div>

                {!activeCall.transcript || activeCall.transcript.length === 0 ? (
                  <div className="text-center text-xs text-slate-500 py-12">
                    Waiting for lead greeting and AI speech initiation...
                  </div>
                ) : (
                  activeCall.transcript.map((item, idx) => (
                    <div
                      key={idx}
                      className={`flex ${item.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-xs ${
                          item.speaker === 'user'
                            ? 'bg-teal-600 text-slate-950 font-medium'
                            : 'bg-slate-800 text-slate-200 border border-slate-700'
                        }`}
                      >
                        <span className="text-[10px] opacity-70 block font-bold mb-1">
                          {item.speaker === 'user' ? 'UK Lead' : 'Sarah (AI Agent)'}
                        </span>
                        <span>{item.text}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LiveCalls;
