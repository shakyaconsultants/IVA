import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  UploadCloud,
  Megaphone,
  Bot,
  PhoneCall,
  History,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Radio,
  Clock,
  ShieldCheck,
  PhoneForwarded
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import api from '../services/api';

const Layout = ({ activeTab, setActiveTab, children }) => {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const [liveCount, setLiveCount] = useState(0);
  const [ukTime, setUkTime] = useState('');
  const [quickCallPhone, setQuickCallPhone] = useState('');
  const [calling, setCalling] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setUkTime(
        now.toLocaleTimeString('en-GB', {
          timeZone: 'Europe/London',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchLiveCount();
    const interval = setInterval(fetchLiveCount, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchLiveCount = async () => {
    try {
      const res = await api.get('/calls/live');
      setLiveCount(res.data.length);
    } catch (e) {}
  };

  const handleQuickDial = async (e) => {
    e.preventDefault();
    if (!quickCallPhone) return;
    setCalling(true);
    try {
      await api.post('/calls/start', {
        phone: quickCallPhone,
        name: 'Manual Test Dial'
      });
      setQuickCallPhone('');
      setActiveTab('live-calls');
    } catch (err) {
      alert(err.response?.data?.message || err.message);
    } finally {
      setCalling(false);
    }
  };

  const navigation = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'upload-leads', label: 'Upload Leads', icon: UploadCloud },
    { id: 'campaigns', label: 'Campaigns', icon: Megaphone },
    { id: 'ai-agent', label: 'AI Voice Agent', icon: Bot },
    { id: 'live-calls', label: 'Live Calls', icon: PhoneCall, badge: liveCount },
    { id: 'call-history', label: 'Call History', icon: History },
    { id: 'lead-management', label: 'Lead Management', icon: Users },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900/80 border-r border-slate-800/80 flex flex-col justify-between shrink-0">
        <div>
          {/* Logo & Brand */}
          <div className="p-5 border-b border-slate-800/80">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-teal-500/20">
                <PhoneForwarded className="w-5 h-5 text-slate-950" />
              </div>
              <div>
                <h1 className="font-bold text-base tracking-wide text-white flex items-center gap-1.5">
                  IVA Cold Call
                </h1>
                <span className="text-[11px] px-2 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 font-medium">
                  Twilio Voice
                </span>
              </div>
            </div>
          </div>

          {/* Nav items */}
          <nav className="p-3 space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-teal-500/15 text-teal-400 border border-teal-500/30 shadow-sm shadow-teal-500/10'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-teal-400' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge > 0 && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400 border border-red-500/30 font-bold animate-pulse">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/50 border border-slate-700/50 text-xs">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'} opacity-75`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
              </span>
              <span className="text-slate-300 font-medium">Twilio Voice</span>
            </div>
            <span className="text-[10px] text-teal-400 uppercase font-mono">
              {connected ? 'ONLINE' : 'CONNECTING'}
            </span>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-teal-400">
                {user?.name ? user.name[0] : 'A'}
              </div>
              <div className="truncate">
                <p className="text-xs font-semibold text-white truncate">{user?.name || 'Admin'}</p>
                <p className="text-[10px] text-slate-400 truncate">{user?.email || 'admin@ivacc.co.uk'}</p>
              </div>
            </div>
            <button
              onClick={logout}
              title="Logout"
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-slate-800/80 bg-slate-900/40 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-white capitalize">
              {navigation.find((n) => n.id === activeTab)?.label || 'Dashboard'}
            </h2>
            <div className="h-4 w-px bg-slate-800" />
            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/60 px-2.5 py-1 rounded-md border border-slate-700/50">
              <Clock className="w-3.5 h-3.5 text-teal-400" />
              <span>UK London Time:</span>
              <span className="font-mono text-teal-300 font-semibold">{ukTime || '--:--:--'}</span>
            </div>
          </div>

          {/* Quick Manual Test Dial */}
          <form onSubmit={handleQuickDial} className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                placeholder="Direct UK Dial (e.g. +447700900123)"
                value={quickCallPhone}
                onChange={(e) => setQuickCallPhone(e.target.value)}
                className="w-64 px-3 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={calling || !quickCallPhone}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-slate-950 font-semibold text-xs transition shadow-sm disabled:opacity-50"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>{calling ? 'Dialing...' : 'Test Call'}</span>
            </button>
          </form>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-6 bg-slate-950/50">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
