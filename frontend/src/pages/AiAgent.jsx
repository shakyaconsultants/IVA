import React, { useState, useEffect } from 'react';
import {
  Bot,
  Save,
  Send,
  Sparkles,
  HelpCircle,
  PhoneForwarded,
  Voicemail,
  CheckCircle2,
  RefreshCw,
  Sliders,
  MessageSquare,
  ShieldAlert,
  Volume2
} from 'lucide-react';
import api from '../services/api';

const AiAgent = () => {
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Sandbox chat
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: "Hi there! I'm Sarah from Beacon Debt Advisory. Are you currently looking into UK government debt relief or IVA programs to manage your personal debts?" }
  ]);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetchAgent();
  }, []);

  const fetchAgent = async () => {
    try {
      const res = await api.get('/ai/agent');
      const data = res.data;
      // Ensure behaviour object exists
      if (!data.behaviour) {
        data.behaviour = {
          askOneQuestionAtATime: true,
          allowInterruptions: true,
          offerCallback: true,
          transferOnRequest: true
        };
      }
      // Ensure instructions field exists (fallback to systemPrompt if empty)
      if (!data.instructions && data.systemPrompt) {
        data.instructions = data.systemPrompt;
      }
      // Ensure greeting field exists (fallback to openingScript)
      if (!data.greeting && data.openingScript) {
        data.greeting = data.openingScript;
      }
      setAgent(data);
    } catch (err) {
      console.error('Failed to fetch agent:', err);
      setErrorMessage('Failed to load agent configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);
    setErrorMessage('');
    try {
      const res = await api.put(`/ai/agent/${agent._id}`, agent);
      setAgent(res.data);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setErrorMessage(err.response?.data?.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || testing) return;

    const userMsg = { role: 'user', content: chatInput };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput('');
    setTesting(true);

    try {
      const res = await api.post('/ai/test', {
        message: chatInput,
        instructions: agent?.instructions || agent?.systemPrompt,
        systemPrompt: agent?.systemPrompt,
        debtQuestions: agent?.debtQuestions
      });

      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.data.reply }
      ]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sandbox connection error: ' + (err.response?.data?.message || err.message) }
      ]);
    } finally {
      setTesting(false);
    }
  };

  if (loading || !agent) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 gap-2">
        <RefreshCw className="w-5 h-5 animate-spin text-teal-400" />
        <span>Loading AI Voice Agent persona & instructions...</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pb-8">
      {/* Left Column: AI Agent Configuration Form */}
      <div className="lg:col-span-7 space-y-6">
        <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
          {/* Header & Save Action */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Bot className="w-5 h-5 text-teal-400" />
                  <span>AI Agent Instructions & Persona</span>
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono border border-slate-700">
                  v{agent.version || 1}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Control how the AI speaks, its conversational guidelines, objection handling, and tone
              </p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-teal-500/20 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : saveSuccess ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>

          {errorMessage && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Company & Agent Names */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Company Name</label>
              <input
                type="text"
                value={agent.companyName || ''}
                onChange={(e) => setAgent({ ...agent, companyName: e.target.value })}
                placeholder="e.g. Beacon Debt Advisory"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Agent Name</label>
              <input
                type="text"
                value={agent.agentName || ''}
                onChange={(e) => setAgent({ ...agent, agentName: e.target.value })}
                placeholder="e.g. Sarah Collins"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:border-teal-500"
              />
            </div>
          </div>

          {/* Voice, Language & Tone Controls */}
          <div className="grid grid-cols-3 gap-3 p-3.5 bg-slate-950/60 rounded-xl border border-slate-800">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">Conversational Tone</label>
              <select
                value={agent.tone || 'professional'}
                onChange={(e) => setAgent({ ...agent, tone: e.target.value })}
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:border-teal-500"
              >
                <option value="professional">Professional</option>
                <option value="empathetic">Empathetic</option>
                <option value="friendly">Friendly</option>
                <option value="direct">Direct</option>
                <option value="calm">Calm & Reassuring</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">Realtime Voice</label>
              <select
                value={agent.voice || 'alloy'}
                onChange={(e) => setAgent({ ...agent, voice: e.target.value })}
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:border-teal-500"
              >
                <option value="alloy">Alloy (Balanced)</option>
                <option value="shimmer">Shimmer (Warm / Clear)</option>
                <option value="echo">Echo (Authoritative)</option>
                <option value="nova">Nova (Energetic)</option>
                <option value="onyx">Onyx (Deep / Direct)</option>
                <option value="fable">Fable (Expressive)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">Language / Accent</label>
              <select
                value={agent.language || 'en-GB'}
                onChange={(e) => setAgent({ ...agent, language: e.target.value })}
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:border-teal-500"
              >
                <option value="en-GB">English (UK) - en-GB</option>
                <option value="en-US">English (US) - en-US</option>
              </select>
            </div>
          </div>

          {/* PRIMARY: Agent Instructions Editor */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-teal-400 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Agent Instructions (Conversational Behaviour & Guidelines)</span>
              </label>
              <span className="text-[10px] text-slate-400">
                Primary client instruction layer
              </span>
            </div>
            <textarea
              rows={8}
              value={agent.instructions || ''}
              onChange={(e) => setAgent({ ...agent, instructions: e.target.value })}
              placeholder={`You are an IVA qualification specialist for Beacon Debt Advisory.
Speak politely, concisely, and professionally.
Ask one question at a time and listen patiently.
Do not pressure customers or rush them.
If the customer expresses worry about debt collectors, reassure them that legal solutions exist to freeze interest and action.
If the customer asks to speak with a human advisor, offer an immediate live transfer.
If the customer wants a callback, help arrange a convenient time.
Do not make promises of guaranteed debt write-offs.`}
              className="w-full p-3.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white font-sans focus:border-teal-500 leading-relaxed shadow-inner"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Specify how the agent should speak, question order, objection handling, and what it should avoid saying.
            </p>
          </div>

          {/* Greeting / Opening Script */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Opening Greeting Spoken When Call Connects
            </label>
            <textarea
              rows={3}
              value={agent.greeting || agent.openingScript || ''}
              onChange={(e) =>
                setAgent({
                  ...agent,
                  greeting: e.target.value,
                  openingScript: e.target.value
                })
              }
              placeholder="Hi [LeadName], this is [AgentName] calling from [CompanyName] on a recorded line..."
              className="w-full p-3 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:border-teal-500"
            />
            <p className="text-[10px] text-slate-500 mt-0.5">
              Available dynamic placeholders: <code className="text-teal-400">[LeadName]</code>, <code className="text-teal-400">[AgentName]</code>, <code className="text-teal-400">[CompanyName]</code>
            </p>
          </div>

          {/* Behaviour Toggles */}
          <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2.5">
            <span className="text-xs font-bold text-teal-400 flex items-center gap-1.5 block mb-2">
              <Sliders className="w-3.5 h-3.5" />
              <span>Voice Pacing & Conversation Controls</span>
            </span>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={agent.behaviour?.askOneQuestionAtATime !== false}
                  onChange={(e) =>
                    setAgent({
                      ...agent,
                      behaviour: { ...agent.behaviour, askOneQuestionAtATime: e.target.checked }
                    })
                  }
                  className="rounded border-slate-700 text-teal-500 focus:ring-teal-500 bg-slate-900"
                />
                <span>Ask one question at a time</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={agent.behaviour?.allowInterruptions !== false}
                  onChange={(e) =>
                    setAgent({
                      ...agent,
                      behaviour: { ...agent.behaviour, allowInterruptions: e.target.checked }
                    })
                  }
                  className="rounded border-slate-700 text-teal-500 focus:ring-teal-500 bg-slate-900"
                />
                <span>Allow caller barge-in interruptions</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={agent.behaviour?.offerCallback !== false}
                  onChange={(e) =>
                    setAgent({
                      ...agent,
                      behaviour: { ...agent.behaviour, offerCallback: e.target.checked }
                    })
                  }
                  className="rounded border-slate-700 text-teal-500 focus:ring-teal-500 bg-slate-900"
                />
                <span>Offer callback if prospect is busy</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={agent.behaviour?.transferOnRequest !== false}
                  onChange={(e) =>
                    setAgent({
                      ...agent,
                      behaviour: { ...agent.behaviour, transferOnRequest: e.target.checked }
                    })
                  }
                  className="rounded border-slate-700 text-teal-500 focus:ring-teal-500 bg-slate-900"
                />
                <span>Offer live transfer on human request</span>
              </label>
            </div>
          </div>

          {/* Deterministic Business Rules (Separated from instructions) */}
          <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
            <span className="text-xs font-bold text-slate-300 block">
              Configured Business Thresholds (Evaluated Deterministically by Backend)
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Min Debt Amount (£)</label>
                <input
                  type="number"
                  value={agent.qualificationRules?.minDebtAmount ?? 5000}
                  onChange={(e) =>
                    setAgent({
                      ...agent,
                      qualificationRules: {
                        ...agent.qualificationRules,
                        minDebtAmount: parseInt(e.target.value, 10) || 0
                      }
                    })
                  }
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Min Creditors Count</label>
                <input
                  type="number"
                  value={agent.qualificationRules?.minCreditors ?? 2}
                  onChange={(e) =>
                    setAgent({
                      ...agent,
                      qualificationRules: {
                        ...agent.qualificationRules,
                        minCreditors: parseInt(e.target.value, 10) || 0
                      }
                    })
                  }
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                />
              </div>
            </div>
          </div>

          {/* Transfer & Voicemail Drop */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Warm Transfer Transition Script
              </label>
              <textarea
                rows={2}
                value={agent.transferRules?.transferScript || ''}
                onChange={(e) =>
                  setAgent({
                    ...agent,
                    transferRules: { ...agent.transferRules, transferScript: e.target.value }
                  })
                }
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                AMD Voicemail Drop Message
              </label>
              <textarea
                rows={2}
                value={agent.voicemailMessage || ''}
                onChange={(e) => setAgent({ ...agent, voicemailMessage: e.target.value })}
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:border-teal-500"
              />
            </div>
          </div>
        </form>
      </div>

      {/* Right Column: AI Dialogue Sandbox Simulator */}
      <div className="lg:col-span-5 flex flex-col bg-slate-900 border border-slate-800 rounded-2xl h-[780px] sticky top-6">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-teal-400" />
            <h3 className="font-bold text-sm text-white">Interactive Dialogue Sandbox</h3>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 font-mono">
            Live Instruction Test
          </span>
        </div>

        {/* Chat Stream */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3">
          {chatMessages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs ${
                  msg.role === 'user'
                    ? 'bg-teal-600 text-slate-950 font-medium'
                    : 'bg-slate-950 border border-slate-800 text-slate-200'
                }`}
              >
                <p className="text-[10px] opacity-60 mb-1 font-bold">
                  {msg.role === 'user' ? 'You (Prospect)' : `${agent.agentName || 'Agent'} (AI)`}
                </p>
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
            </div>
          ))}
          {testing && (
            <div className="flex justify-start">
              <div className="bg-slate-950 border border-slate-800 rounded-2xl px-4 py-2 text-xs text-slate-400 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-400" />
                <span>AI is formulating response using your instructions...</span>
              </div>
            </div>
          )}
        </div>

        {/* Sandbox Input */}
        <form onSubmit={handleSendTestMessage} className="p-3 border-t border-slate-800 flex gap-2">
          <input
            type="text"
            placeholder="Test customer reply (e.g. 'I owe £8,500 on 3 cards')..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            className="flex-1 px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-teal-500"
          />
          <button
            type="submit"
            disabled={testing || !chatInput.trim()}
            className="p-2.5 bg-teal-600 hover:bg-teal-500 text-slate-950 rounded-xl transition disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};

export default AiAgent;
