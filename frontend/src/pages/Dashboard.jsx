import React, { useState, useEffect } from 'react';
import {
  Users,
  PhoneIncoming,
  PhoneCall,
  Voicemail,
  ThumbsUp,
  PhoneForwarded,
  TrendingUp,
  Clock,
  PoundSterling,
  Activity,
  Play,
  Pause,
  ArrowUpRight
} from 'lucide-react';
import api from '../services/api';
import { useSocket } from '../context/SocketContext';

const Dashboard = ({ setActiveTab }) => {
  const { socket } = useSocket();
  const [stats, setStats] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on('call:new', () => fetchDashboardData());
    socket.on('call:update', () => fetchDashboardData());
    socket.on('call:ended', () => fetchDashboardData());

    return () => {
      socket.off('call:new');
      socket.off('call:update');
      socket.off('call:ended');
    };
  }, [socket]);

  const fetchDashboardData = async () => {
    try {
      const [analyticsRes, campaignsRes] = await Promise.all([
        api.get('/analytics'),
        api.get('/campaigns')
      ]);
      setStats(analyticsRes.data.overview);
      setCampaigns(campaignsRes.data);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCampaignAction = async (id, action) => {
    try {
      await api.post(`/campaigns/${id}/${action}`);
      fetchDashboardData();
    } catch (err) {
      alert(err.response?.data?.message || err.message);
    }
  };

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Activity className="w-6 h-6 animate-spin text-teal-400 mr-2" />
        <span>Loading UK IVA Metrics...</span>
      </div>
    );
  }

  const kpis = [
    { label: 'Total Leads', value: stats.totalLeads, icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Calls Today', value: stats.callsToday, icon: PhoneIncoming, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
    { label: 'Answered', value: stats.answeredCalls, icon: PhoneCall, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Voicemail (AMD)', value: stats.voicemailCalls, icon: Voicemail, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    { label: 'Interested', value: stats.interestedCount, icon: ThumbsUp, color: 'text-teal-400', bg: 'bg-teal-500/10' },
    { label: 'Transferred', value: stats.transferredCount, icon: PhoneForwarded, color: 'text-purple-400', bg: 'bg-purple-500/10' },
    { label: 'Conversion Rate', value: `${stats.conversionPct}%`, icon: TrendingUp, color: 'text-emerald-300', bg: 'bg-emerald-500/10' },
    { label: 'Minutes Used', value: stats.minutesUsed, icon: Clock, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
    { label: 'Total Cost', value: `£${stats.totalCost.toFixed(2)}`, icon: PoundSterling, color: 'text-rose-400', bg: 'bg-rose-500/10' }
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-r from-teal-950/40 via-slate-900 to-slate-900 border border-teal-500/20 shadow-xl">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            UK IVA Dialing Command Center
          </h2>
          <p className="text-xs text-slate-400 mt-1">
                    Automated qualification and Twilio Voice calling
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab('live-calls')}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-teal-500/20"
          >
            <Activity className="w-4 h-4" />
            <span>Open Live Calls</span>
          </button>
          <button
            onClick={() => setActiveTab('upload-leads')}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs border border-slate-700 transition"
          >
            Upload Lead File
          </button>
        </div>
      </div>

      {/* KPI Grid (All 9 metrics requested by user) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
        {kpis.map((kpi, index) => {
          const Icon = kpi.icon;
          return (
            <div
              key={index}
              className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition relative overflow-hidden group shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">{kpi.label}</span>
                <div className={`p-2 rounded-xl ${kpi.bg}`}>
                  <Icon className={`w-4 h-4 ${kpi.color}`} />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-2xl font-bold text-white tracking-tight">
                  {kpi.value}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Campaigns Overview */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-white">Active Dialing Campaigns</h3>
            <p className="text-xs text-slate-400">Pacing, concurrent calls, and live lead progress</p>
          </div>
          <button
            onClick={() => setActiveTab('campaigns')}
            className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1 font-medium"
          >
            <span>Manage Campaigns</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {campaigns.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs">
            No campaigns configured. Click Manage Campaigns to start.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {campaigns.map((camp) => (
              <div key={camp._id} className="py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-sm text-white truncate">{camp.name}</h4>
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${
                        camp.status === 'running'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : camp.status === 'paused'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          : 'bg-slate-700/30 text-slate-400 border-slate-700'
                      }`}
                    >
                      {camp.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    CPS: {camp.maxCPS} • Concurrency: {camp.concurrentCalls} calls
                  </p>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-xs font-semibold text-white">
                      {camp.dialedLeads} / {camp.totalLeads} Leads
                    </p>
                    <p className="text-[10px] text-teal-400">
                      {camp.transferredCalls} Transferred
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    {camp.status === 'running' ? (
                      <button
                        onClick={() => handleCampaignAction(camp._id, 'pause')}
                        title="Pause Campaign"
                        className="p-2 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 transition"
                      >
                        <Pause className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleCampaignAction(camp._id, 'start')}
                        title="Start Campaign"
                        className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
