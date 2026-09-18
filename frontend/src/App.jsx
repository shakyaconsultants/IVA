import React, { useState } from 'react';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import UploadLeads from './pages/UploadLeads';
import Campaigns from './pages/Campaigns';
import AiAgent from './pages/AiAgent';
import LiveCalls from './pages/LiveCalls';
import CallHistory from './pages/CallHistory';
import LeadManagement from './pages/LeadManagement';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';

function App() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-teal-400 font-mono text-sm">
        Initializing UK IVA Telephony CRM...
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  const renderScreen = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard setActiveTab={setActiveTab} />;
      case 'upload-leads':
        return <UploadLeads setActiveTab={setActiveTab} />;
      case 'campaigns':
        return <Campaigns setActiveTab={setActiveTab} />;
      case 'ai-agent':
        return <AiAgent />;
      case 'live-calls':
        return <LiveCalls />;
      case 'call-history':
        return <CallHistory />;
      case 'lead-management':
        return <LeadManagement />;
      case 'analytics':
        return <Analytics />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard setActiveTab={setActiveTab} />;
    }
  };

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab}>
      {renderScreen()}
    </Layout>
  );
}

export default App;
