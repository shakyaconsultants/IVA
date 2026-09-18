import React, { useState, useEffect } from 'react';
import {
  History,
  Filter,
  Search,
  FileText,
  Volume2,
  Clock,
  PoundSterling,
  Calendar,
  X,
  CheckCircle2,
  PhoneForwarded,
  Voicemail
} from 'lucide-react';
import api from '../services/api';

const CallHistory = () => {
  const [calls, setCalls] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filters, setFilters] = useState({
    campaignId: '',
    disposition: '',
    interested: '',
    transferred: '',
    dateFrom: '',
    dateTo: '',
    search: ''
  });

  // Selected Call for Modal
  const [selectedCall, setSelectedCall] = useState(null);

  useEffect(() => {
    fetchCampaigns();
    fetchCalls();
  }, [filters]);

  const fetchCampaigns = async () => {
    try {
      const res = await api.get('/campaigns');
      setCampaigns(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchCalls = async () => {
    setLoading(true);
    try {
      const res = await api.get('/calls', { params: filters });
      setCalls(res.data.calls);
      setTotal(res.data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Call Records & Transcripts</h2>
        <p className="text-xs text-slate-400">
          Search, filter, and inspect call audio logs, AI qualification transcripts, and disposition notes
        </p>
      </div>

      {/* Filter Bar */}
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
        {/* Campaign Filter */}
        <div>
          <label className="block text-slate-400 mb-1">Campaign</label>
          <select
            value={filters.campaignId}
            onChange={(e) => setFilters({ ...filters, campaignId: e.target.value })}
            className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
          >
            <option value="">All Campaigns</option>
            {campaigns.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Disposition */}
        <div>
          <label className="block text-slate-400 mb-1">Disposition</label>
          <select
            value={filters.disposition}
            onChange={(e) => setFilters({ ...filters, disposition: e.target.value })}
            className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
          >
            <option value="">All Dispositions</option>
            <option value="Transferred to Specialist">Transferred to Specialist</option>
            <option value="Voicemail">Voicemail</option>
            <option value="Connected">Connected</option>
            <option value="Callback">Callback</option>
            <option value="DNC">DNC</option>
          </select>
        </div>

        {/* Interested */}
        <div>
          <label className="block text-slate-400 mb-1">Interested Lead</label>
          <select
            value={filters.interested}
            onChange={(e) => setFilters({ ...filters, interested: e.target.value })}
            className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
          >
            <option value="">All</option>
            <option value="true">Interested Only</option>
            <option value="false">Not Interested</option>
          </select>
        </div>

        {/* Transferred */}
        <div>
          <label className="block text-slate-400 mb-1">Transferred</label>
          <select
            value={filters.transferred}
            onChange={(e) => setFilters({ ...filters, transferred: e.target.value })}
            className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
          >
            <option value="">All</option>
            <option value="true">Transferred Only</option>
            <option value="false">Not Transferred</option>
          </select>
        </div>

        {/* Date From */}
        <div>
          <label className="block text-slate-400 mb-1">Date From</label>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
            className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
          />
        </div>

        {/* Date To */}
        <div>
          <label className="block text-slate-400 mb-1">Date To</label>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
            className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 font-semibold uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-5 py-3">Lead Phone</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Disposition</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {calls.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No call logs matching filters.
                  </td>
                </tr>
              ) : (
                calls.map((call) => (
                  <tr key={call.callId} className="hover:bg-slate-800/40 transition">
                    <td className="px-5 py-3 font-mono font-semibold text-white">
                      {call.leadPhone}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {call.leadId?.name || 'Prospect'}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {call.campaignId?.name || 'Manual Dial'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          call.disposition?.includes('Transferred')
                            ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                            : call.disposition === 'Voicemail'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                      >
                        {call.disposition}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300 font-mono">
                      {call.durationSec}s
                    </td>
                    <td className="px-4 py-3 text-teal-400 font-mono">
                      £{call.cost?.toFixed(3) || '0.000'}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {new Date(call.createdAt).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setSelectedCall(call)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-teal-400 font-semibold rounded-lg transition"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: View Transcript & Details */}
      {selectedCall && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-white">Call Details & Transcript</h3>
                <p className="text-xs text-slate-400 font-mono">ID: {selectedCall.callId}</p>
              </div>
              <button
                onClick={() => setSelectedCall(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-500 block">Phone</span>
                <span className="font-mono text-white font-semibold">{selectedCall.leadPhone}</span>
              </div>
              <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-500 block">Duration</span>
                <span className="text-white font-semibold">{selectedCall.durationSec}s</span>
              </div>
              <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-500 block">Disposition</span>
                <span className="text-teal-400 font-semibold">{selectedCall.disposition}</span>
              </div>
              <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-500 block">Call Cost</span>
                <span className="text-purple-400 font-semibold">£{selectedCall.cost?.toFixed(3)}</span>
              </div>
            </div>

            {/* Notes */}
            {selectedCall.notes && (
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300">
                <span className="font-bold text-slate-400 block mb-1">Agent / AI Notes:</span>
                {selectedCall.notes}
              </div>
            )}

            {/* Transcript */}
            <div className="flex-1 overflow-y-auto p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider text-center">
                Full Conversation Transcript
              </p>
              {!selectedCall.transcript || selectedCall.transcript.length === 0 ? (
                <p className="text-center text-xs text-slate-500 py-6">No transcript recorded for this call.</p>
              ) : (
                selectedCall.transcript.map((t, idx) => (
                  <div
                    key={idx}
                    className={`flex ${t.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3.5 py-2 text-xs ${
                        t.speaker === 'user'
                          ? 'bg-teal-600 text-slate-950 font-medium'
                          : 'bg-slate-800 text-slate-200'
                      }`}
                    >
                      <span className="text-[10px] opacity-70 block font-bold">
                        {t.speaker === 'user' ? 'Prospect' : 'AI Advisor'}
                      </span>
                      {t.text}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CallHistory;
