import React, { useState, useEffect } from 'react';
import {
  Megaphone,
  Plus,
  Play,
  Pause,
  Square,
  Clock,
  Zap,
  PhoneCall,
  PhoneForwarded,
  Bot,
  Layers,
  X,
  Trash2
} from 'lucide-react';
import api from '../services/api';

const Campaigns = ({ setActiveTab }) => {
  const [campaigns, setCampaigns] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [chunkSize, setChunkSize] = useState(50);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    callingHoursStart: '09:00',
    callingHoursEnd: '19:00',
    maxCPS: 2,
    concurrentCalls: 5,
    agentId: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [campRes, agentRes] = await Promise.all([
        api.get('/campaigns'),
        api.get('/ai/agent')
      ]);
      setCampaigns(campRes.data);
      if (agentRes.data) {
        setAgents([agentRes.data]);
        setFormData((prev) => ({ ...prev, agentId: agentRes.data._id }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id, action) => {
    try {
      await api.post(`/campaigns/${id}/${action}`);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || err.message);
    }
  };

  const handleAssignChunk = async (id) => {
    try {
      const response = await api.post(`/campaigns/${id}/assign-leads`, { limit: chunkSize });
      alert(response.data.message);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || err.message);
    }
  };

  const handleDeleteCampaign = async (campaign) => {
    if (!window.confirm(`Delete campaign "${campaign.name}" and all of its leads?`)) return;

    try {
      await api.delete(`/campaigns/${campaign._id}`);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete campaign');
    }
  };

  const handleCreateCampaign = async (e) => {
    e.preventDefault();
    try {
      await api.post('/campaigns', formData);
      setShowModal(false);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to create campaign');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Create Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Campaigns Manager</h2>
          <p className="text-xs text-slate-400">
            Configure UK IVA outbound dialer pacing and concurrency limits
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-teal-500/20"
        >
          <Plus className="w-4 h-4" />
          <span>New Campaign</span>
        </button>
      </div>

      {/* Campaigns List */}
      <div className="grid grid-cols-1 gap-4">
        {campaigns.map((camp) => (
          <div
            key={camp._id}
            className="p-6 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-sm hover:border-slate-700 transition space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="font-bold text-base text-white">{camp.name}</h3>
                  <span
                    className={`text-[10px] uppercase font-bold px-2.5 py-0.5 rounded-full border ${
                      camp.status === 'running'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : camp.status === 'paused'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {camp.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{camp.description || 'UK Debt Recovery Lead Campaign'}</p>
              </div>

              {/* Action Buttons: Start / Pause / Stop */}
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={chunkSize}
                  onChange={(e) => setChunkSize(parseInt(e.target.value, 10) || 1)}
                  title="Number of unassigned leads to attach"
                  className="w-20 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs"
                />
                <button
                  onClick={() => handleAssignChunk(camp._id)}
                  title="Assign unassigned leads to this campaign"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Assign Chunk</span>
                </button>
                {camp.status === 'running' ? (
                  <button
                    onClick={() => handleAction(camp._id, 'pause')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold transition"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleAction(camp._id, 'start')}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold transition shadow-md shadow-emerald-600/20"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Start Dialing</span>
                  </button>
                )}
                <button
                  onClick={() => handleAction(camp._id, 'stop')}
                  disabled={camp.status === 'stopped'}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-red-400 text-xs transition disabled:opacity-30"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Stop</span>
                </button>
                <button
                  onClick={() => handleDeleteCampaign(camp)}
                  title="Delete campaign and its leads"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </div>

            {/* Campaign Parameters Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <span className="text-slate-500 font-medium block mb-1">Calling Hours</span>
                <span className="text-slate-200 font-semibold">{camp.callingHoursStart} - {camp.callingHoursEnd}</span>
              </div>
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <span className="text-slate-500 font-medium block mb-1">Max CPS</span>
                <span className="text-slate-200 font-semibold">{camp.maxCPS} calls/sec</span>
              </div>
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <span className="text-slate-500 font-medium block mb-1">Concurrency</span>
                <span className="text-slate-200 font-semibold">{camp.concurrentCalls} lines</span>
              </div>
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <span className="text-slate-500 font-medium block mb-1">Dialed / Total</span>
                <span className="text-white font-bold">{camp.dialedLeads} / {camp.totalLeads}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal: Create Campaign */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base">Configure New Campaign</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCampaign} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Campaign Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Manchester & Leeds IVA Leads"
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-teal-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Max CPS (Calls/Sec)</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={formData.maxCPS}
                    onChange={(e) => setFormData({ ...formData, maxCPS: parseInt(e.target.value, 10) })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Concurrent Calls</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={formData.concurrentCalls}
                    onChange={(e) => setFormData({ ...formData, concurrentCalls: parseInt(e.target.value, 10) })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Calling Start (UK Time)</label>
                  <input
                    type="time"
                    value={formData.callingHoursStart}
                    onChange={(e) => setFormData({ ...formData, callingHoursStart: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Calling End (UK Time)</label>
                  <input
                    type="time"
                    value={formData.callingHoursEnd}
                    onChange={(e) => setFormData({ ...formData, callingHoursEnd: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-500 text-slate-950 font-bold rounded-xl text-xs shadow-md shadow-teal-500/20"
                >
                  Save Campaign
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Campaigns;
