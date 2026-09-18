import React, { useState, useEffect } from 'react';
import {
  Users,
  Search,
  PhoneCall,
  CheckCircle2,
  XCircle,
  FileText,
  Clock,
  PoundSterling,
  Plus
} from 'lucide-react';
import api from '../services/api';

const LeadManagement = () => {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeads();
  }, [search, statusFilter]);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const res = await api.get('/leads', {
        params: { search, status: statusFilter }
      });
      setLeads(res.data.leads);
      setTotal(res.data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDialLead = async (lead) => {
    try {
      await api.post('/calls/start', {
        phone: lead.phone,
        name: lead.name,
        campaignId: lead.campaignId?._id
      });
      alert(`Dialing initiated for ${lead.name} (${lead.phone})`);
    } catch (err) {
      alert(err.response?.data?.message || 'Dialing failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Lead Directory & CRM</h2>
          <p className="text-xs text-slate-400">
            Prospect records, debt figures, qualification attempts, and CRM history
          </p>
        </div>

        {/* Search & Status Filter */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search name, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 w-56"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white"
          >
            <option value="">All Statuses</option>
            <option value="new">New</option>
            <option value="in-call">In Call</option>
            <option value="transferred">Transferred</option>
            <option value="completed">Completed</option>
            <option value="dnc">DNC</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 font-semibold uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-5 py-3.5">Lead Name</th>
                <th className="px-4 py-3.5">Phone (E.164)</th>
                <th className="px-4 py-3.5">Debt Amount</th>
                <th className="px-4 py-3.5">Creditors</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Attempts</th>
                <th className="px-4 py-3.5">Last Call</th>
                <th className="px-4 py-3.5">Disposition</th>
                <th className="px-4 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-500">
                    No leads found. Upload an Excel file to get started.
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead._id} className="hover:bg-slate-800/40 transition">
                    <td className="px-5 py-3.5 font-semibold text-white">
                      {lead.name}
                      {lead.postcode && (
                        <span className="text-[10px] text-slate-400 ml-1.5">({lead.postcode})</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-teal-400 font-semibold">
                      {lead.phone}
                    </td>
                    <td className="px-4 py-3.5 text-slate-200 font-semibold">
                      {lead.debtAmount ? `£${lead.debtAmount.toLocaleString()}` : '£0'}
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">
                      {lead.creditorCount || '-'}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          lead.status === 'transferred'
                            ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                            : lead.status === 'in-call'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 animate-pulse'
                            : lead.status === 'new'
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-300 font-mono">
                      {lead.attempts}
                    </td>
                    <td className="px-4 py-3.5 text-slate-400">
                      {lead.lastCallAt
                        ? new Date(lead.lastCallAt).toLocaleDateString('en-GB')
                        : 'Never'}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-slate-300 font-medium">
                        {lead.disposition || 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        onClick={() => handleDialLead(lead)}
                        title="Trigger Direct Call"
                        className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500 hover:text-slate-950 transition"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LeadManagement;
