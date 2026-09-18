import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Phone,
  Server,
  Key,
  PhoneForwarded,
  PoundSterling,
  Users,
  Webhook,
  Save,
  CheckCircle2,
  Trash2,
  Plus
} from 'lucide-react';
import api from '../services/api';

const Settings = () => {
  const [settings, setSettings] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // New user form
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [newUserRole, setNewUserRole] = useState('agent');

  useEffect(() => {
    fetchSettings();
    fetchUsers();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await api.get('/settings');
      setSettings(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await api.get('/settings/users');
      setUsers(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);
    try {
      const res = await api.put('/settings', settings);
      setSettings(res.data.settings);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      await api.post('/settings/users', {
        name: newUserName,
        email: newUserEmail,
        password: newUserPass,
        role: newUserRole
      });
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPass('');
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add user');
    }
  };

  const handleDeleteUser = async (id) => {
    if (!confirm('Remove user access?')) return;
    try {
      await api.delete(`/settings/users/${id}`);
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete user');
    }
  };

  if (loading || !settings) {
    return <div className="p-8 text-center text-slate-400">Loading settings...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Platform Configuration</h2>
          <p className="text-xs text-slate-400">
            Operational preferences and billing rates. Provider credentials stay in the backend environment.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-5 py-2 bg-teal-600 hover:bg-teal-500 text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-teal-500/20 disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{saving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Settings'}</span>
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Billing Rates */}
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
          <h3 className="font-bold text-sm text-white flex items-center gap-2">
            <PhoneForwarded className="w-4 h-4 text-teal-400" />
            <span>Transfer & Billing Rates</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Twilio Rate (£/min)</label>
              <input
                type="number"
                step="0.001"
                value={settings.billing?.twilioPerMinCostGbp || 0.015}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    billing: { ...settings.billing, twilioPerMinCostGbp: parseFloat(e.target.value) }
                  })
                }
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">AI Voice Rate (£/min)</label>
              <input
                type="number"
                step="0.001"
                value={settings.billing?.openAiVoicePerMinCostGbp || 0.06}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    billing: { ...settings.billing, openAiVoicePerMinCostGbp: parseFloat(e.target.value) }
                  })
                }
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white"
              />
            </div>
          </div>
        </div>

        {/* 5. Webhook URLs */}
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
          <h3 className="font-bold text-sm text-white flex items-center gap-2">
            <Webhook className="w-4 h-4 text-teal-400" />
            <span>Webhook Endpoints</span>
          </h3>

          <div className="space-y-2 text-xs">
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex justify-between items-center">
              <div>
                <span className="font-semibold text-slate-300 block">Twilio Status Callback URL</span>
                <span className="text-teal-400 font-mono text-[11px]">https://your-domain.com/api/webhooks/twilio</span>
              </div>
              <span className="px-2 py-0.5 bg-slate-900 rounded text-[10px] text-slate-400">POST</span>
            </div>
          </div>
        </div>
      </form>

      {/* 6. Users Management */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
        <h3 className="font-bold text-sm text-white flex items-center gap-2">
          <Users className="w-4 h-4 text-teal-400" />
          <span>Operator & Team Access</span>
        </h3>

        {/* Add User */}
        <form onSubmit={handleAddUser} className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
          <input
            type="text"
            required
            placeholder="User Name"
            value={newUserName}
            onChange={(e) => setNewUserName(e.target.value)}
            className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
          />
          <input
            type="email"
            required
            placeholder="operator@company.co.uk"
            value={newUserEmail}
            onChange={(e) => setNewUserEmail(e.target.value)}
            className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={newUserPass}
            onChange={(e) => setNewUserPass(e.target.value)}
            className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-slate-950 font-bold rounded-xl transition flex items-center justify-center gap-1"
          >
            <Plus className="w-4 h-4" />
            <span>Add User</span>
          </button>
        </form>

        {/* Users Table */}
        <div className="divide-y divide-slate-800 border-t border-slate-800 pt-2">
          {users.map((u) => (
            <div key={u._id} className="py-2.5 flex justify-between items-center text-xs">
              <div>
                <span className="font-semibold text-white mr-2">{u.name}</span>
                <span className="text-slate-400">{u.email}</span>
                <span className="text-[10px] ml-2 px-2 py-0.5 rounded bg-slate-800 text-teal-400 uppercase font-bold">
                  {u.role}
                </span>
              </div>
              {u.email !== 'admin@ivacc.co.uk' && (
                <button
                  onClick={() => handleDeleteUser(u._id)}
                  className="p-1 text-slate-500 hover:text-red-400 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Settings;
