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
  RefreshCw
} from 'lucide-react';
import api from '../services/api';

const AiAgent = () => {
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

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
      setAgent(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);
    try {
      const res = await api.put(`/ai/agent/${agent._id}`, agent);
      setAgent(res.data);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to save configuration');
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
        { role: 'assistant', content: 'Sandbox connection error: ' + err.message }
      ]);
    } finally {
      setTesting(false);
    }
  };

  if (loading || !agent) {
    return <div className="p-8 text-center text-slate-400">Loading AI Agent persona...</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Column: AI Agent Configuration Form */}
      <div className="lg:col-span-7 space-y-6">
        <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Bot className="w-5 h-5 text-teal-400" />
                <span>AI Persona & IVA Qualification Engine</span>
              </h2>
              <p className="text-xs text-slate-400">
                UK Debt Specialist dialogue prompts, voice selection, and warm transfer thresholds
              </p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-teal-500/20 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Config'}</span>
            </button>
          </div>

          {/* Company & Agent Names */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Company Name</label>
              <input
                type="text"
                value={agent.companyName}
                onChange={(e) => setAgent({ ...agent, companyName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Agent Name</label>
              <input
                type="text"
                value={agent.agentName}
                onChange={(e) => setAgent({ ...agent, agentName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:border-teal-500"
              />
            </div>
          </div>

          {/* Opening Hook Script */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Opening Script (Hook)
            </label>
            <textarea
              rows={3}
              value={agent.openingScript}
              onChange={(e) => setAgent({ ...agent, openingScript: e.target.value })}
              className="w-full p-3 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:border-teal-500"
            />
          </div>

          {/* Qualification Rules */}
          <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
            <span className="text-xs font-bold text-teal-400 block">
              UK IVA Qualification Criteria
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Min Debt Amount (£)</label>
                <input
                  type="number"
                  value={agent.qualificationRules?.minDebtAmount || 5000}
                  onChange={(e) =>
                    setAgent({
                      ...agent,
                      qualificationRules: {
                        ...agent.qualificationRules,
                        minDebtAmount: parseInt(e.target.value, 10)
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
                  value={agent.qualificationRules?.minCreditors || 2}
                  onChange={(e) =>
                    setAgent({
                      ...agent,
                      qualificationRules: {
                        ...agent.qualificationRules,
                        minCreditors: parseInt(e.target.value, 10)
                      }
                    })
                  }
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                />
              </div>
            </div>
          </div>

          {/* Transfer Rules & Script */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Warm Transfer Explanation Script
            </label>
            <textarea
              rows={3}
              value={agent.transferRules?.transferScript}
              onChange={(e) =>
                setAgent({
                  ...agent,
                  transferRules: { ...agent.transferRules, transferScript: e.target.value }
                })
              }
              className="w-full p-3 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:border-teal-500"
            />
          </div>

          {/* Voicemail Message */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              AMD Voicemail Drop Message
            </label>
            <textarea
              rows={2}
              value={agent.voicemailMessage}
              onChange={(e) => setAgent({ ...agent, voicemailMessage: e.target.value })}
              className="w-full p-3 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:border-teal-500"
            />
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Complete GPT Realtime System Prompt
            </label>
            <textarea
              rows={6}
              value={agent.systemPrompt}
              onChange={(e) => setAgent({ ...agent, systemPrompt: e.target.value })}
              className="w-full p-3 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white font-mono focus:border-teal-500"
            />
          </div>
        </form>
      </div>

      {/* Right Column: AI Sandbox Simulator */}
      <div className="lg:col-span-5 flex flex-col bg-slate-900 border border-slate-800 rounded-2xl h-[780px]">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-teal-400" />
            <h3 className="font-bold text-sm text-white">AI Dialogue Sandbox</h3>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 font-mono">
            Interactive Test
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
                  {msg.role === 'user' ? 'You (Prospect)' : `${agent.agentName} (AI)`}
                </p>
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}
          {testing && (
            <div className="flex justify-start">
              <div className="bg-slate-950 border border-slate-800 rounded-2xl px-4 py-2 text-xs text-slate-400 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-400" />
                <span>AI is formulating response...</span>
              </div>
            </div>
          )}
        </div>

        {/* Sandbox Input */}
        <form onSubmit={handleSendTestMessage} className="p-3 border-t border-slate-800 flex gap-2">
          <input
            type="text"
            placeholder="Type customer reply (e.g. 'I owe £8,500 on 3 credit cards')..."
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
