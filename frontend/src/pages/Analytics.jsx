import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  PhoneCall,
  CheckCircle2,
  Voicemail,
  ThumbsUp,
  PhoneForwarded,
  PoundSterling,
  PieChart,
  TrendingUp,
  Activity
} from 'lucide-react';
import api from '../services/api';

const Analytics = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const res = await api.get('/analytics');
      setData(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="p-8 text-center text-slate-400">
        <Activity className="w-6 h-6 animate-spin text-teal-400 mx-auto mb-2" />
        <span>Loading UK Telephony Analytics...</span>
      </div>
    );
  }

  const { overview, dispositionBreakdown } = data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Analytics & Campaign Intelligence</h2>
        <p className="text-xs text-slate-400">
          Dialing funnel metrics, human vs answering machine breakdown, and transfer cost ROI
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400 block mb-1">Total Dialed</span>
          <span className="text-2xl font-bold text-white">{overview.totalDialed}</span>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400 block mb-1">Answered (Pick-up)</span>
          <span className="text-2xl font-bold text-emerald-400">{overview.answeredCalls}</span>
          <span className="text-[10px] text-slate-500 block mt-0.5">{overview.answerRate}% answer rate</span>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400 block mb-1">Human %</span>
          <span className="text-2xl font-bold text-teal-400">{overview.humanPct}%</span>
          <span className="text-[10px] text-slate-500 block mt-0.5">AMD human pass</span>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400 block mb-1">Voicemail %</span>
          <span className="text-2xl font-bold text-amber-400">{overview.voicemailPct}%</span>
          <span className="text-[10px] text-slate-500 block mt-0.5">Machine drop</span>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400 block mb-1">Interested %</span>
          <span className="text-2xl font-bold text-cyan-400">{overview.interestedPct}%</span>
          <span className="text-[10px] text-slate-500 block mt-0.5">{overview.interestedCount} leads</span>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400 block mb-1">Transfers</span>
          <span className="text-2xl font-bold text-purple-400">{overview.transferredCount}</span>
          <span className="text-[10px] text-slate-500 block mt-0.5">{overview.conversionPct}% conversion</span>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400 block mb-1">Cost / Lead</span>
          <span className="text-2xl font-bold text-white">£{overview.costPerLead.toFixed(2)}</span>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400 block mb-1">Cost / Transfer</span>
          <span className="text-2xl font-bold text-rose-400">£{overview.costPerTransfer.toFixed(2)}</span>
        </div>
      </div>

      {/* Funnel Visualization */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Conversion Funnel */}
        <div className="lg:col-span-7 p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
          <h3 className="font-bold text-sm text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-teal-400" />
            <span>Outbound Dialing Conversion Funnel</span>
          </h3>

          <div className="space-y-3 pt-2">
            {[
              { label: 'Total Calls Dialed', val: overview.totalDialed, pct: 100, color: 'bg-blue-500' },
              { label: 'Answered by Prospect', val: overview.answeredCalls, pct: overview.answerRate, color: 'bg-indigo-500' },
              { label: 'Human Voice Detected (AMD)', val: overview.humanCalls, pct: overview.humanPct, color: 'bg-teal-500' },
              { label: 'Qualified Debt (>£5k, 2+ Creditors)', val: overview.interestedCount, pct: overview.interestedPct, color: 'bg-emerald-500' },
              { label: 'Transferred to Human Specialist', val: overview.transferredCount, pct: overview.conversionPct, color: 'bg-purple-500' }
            ].map((step, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300 font-medium">{step.label}</span>
                  <span className="text-white font-mono font-bold">
                    {step.val} ({step.pct}%)
                  </span>
                </div>
                <div className="w-full h-3 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
                  <div
                    className={`h-full ${step.color} rounded-full transition-all duration-500`}
                    style={{ width: `${Math.max(4, step.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Dispositions Breakdown */}
        <div className="lg:col-span-5 p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
          <h3 className="font-bold text-sm text-white flex items-center gap-2">
            <PieChart className="w-4 h-4 text-teal-400" />
            <span>Call Dispositions Breakdown</span>
          </h3>

          <div className="space-y-2.5 pt-2">
            {dispositionBreakdown.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">No dispositions recorded yet.</p>
            ) : (
              dispositionBreakdown.map((disp, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 flex items-center justify-between text-xs"
                >
                  <span className="text-slate-300 font-medium">{disp._id || 'Unknown'}</span>
                  <span className="px-2.5 py-0.5 rounded-md bg-teal-500/10 text-teal-400 font-bold font-mono">
                    {disp.count}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
