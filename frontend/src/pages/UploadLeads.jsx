import React, { useState, useEffect } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Database,
  RefreshCw,
  Layers,
  Sparkles
} from 'lucide-react';
import api from '../services/api';

const UploadLeads = ({ setActiveTab }) => {
  const [step, setStep] = useState(1); // 1: Upload, 2: Map, 3: Validate & Dedupe, 4: Done
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [file, setFile] = useState(null);
  const [uploadData, setUploadData] = useState(null);
  const [mapping, setMapping] = useState({
    phone: '',
    name: '',
    email: '',
    debtAmount: '',
    creditorCount: '',
    postcode: ''
  });
  const [validationStats, setValidationStats] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const fetchCampaigns = async () => {
    try {
      const res = await api.get('/campaigns');
      setCampaigns(res.data);
      if (res.data.length > 0) {
        setSelectedCampaign(res.data[0]._id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleFileUpload = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const res = await api.post('/leads/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setUploadData(res.data);
      setMapping((prev) => ({
        ...prev,
        ...res.data.suggestedMapping
      }));
      setStep(2);
    } catch (err) {
      alert(err.response?.data?.message || 'File upload failed');
    }
  };

  const handleProceedToValidation = () => {
    if (!mapping.phone) {
      alert('Please select a column for Phone Number');
      return;
    }

    // Run client-side preliminary validation on preview rows
    const rows = uploadData.previewRows || [];
    let validPhones = 0;
    let invalidPhones = 0;

    rows.forEach((row) => {
      const raw = String(row[mapping.phone] || '').trim();
      const cleaned = raw.replace(/[\s\-\(\)\.]/g, '');
      if (cleaned.startsWith('07') || cleaned.startsWith('+447') || cleaned.startsWith('447')) {
        validPhones++;
      } else {
        invalidPhones++;
      }
    });

    setValidationStats({
      total: uploadData.totalRows,
      sampleValid: validPhones,
      sampleInvalid: invalidPhones
    });

    setStep(3);
  };

  const handleExecuteImport = async () => {
    setImporting(true);
    try {
      // Send mapped leads
      const res = await api.post('/leads/import', {
        rows: uploadData.rows,
        mapping,
        campaignId: selectedCampaign
      });
      setImportResult(res.data);
      setStep(4);
    } catch (err) {
      alert(err.response?.data?.message || 'Lead import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl">
        {[
          { num: 1, label: 'Upload Excel' },
          { num: 2, label: 'Map Columns' },
          { num: 3, label: 'Validate & Dedupe' },
          { num: 4, label: 'Import Completed' }
        ].map((s, idx) => (
          <React.Fragment key={s.num}>
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
                  step >= s.num
                    ? 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                {step > s.num ? <CheckCircle2 className="w-4 h-4" /> : s.num}
              </div>
              <span className={`text-xs font-semibold ${step >= s.num ? 'text-white' : 'text-slate-500'}`}>
                {s.label}
              </span>
            </div>
            {idx < 3 && <div className="h-0.5 w-12 bg-slate-800 hidden sm:block" />}
          </React.Fragment>
        ))}
      </div>

      {/* STEP 1: Upload File */}
      {step === 1 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-6 text-center">
          <div className="max-w-md mx-auto">
            <label className="border-2 border-dashed border-slate-700 hover:border-teal-500 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition bg-slate-950/40 hover:bg-slate-950/70 group">
              <div className="w-16 h-16 rounded-2xl bg-teal-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition">
                <UploadCloud className="w-8 h-8 text-teal-400" />
              </div>
              <p className="font-bold text-base text-white">Click or drag Excel / CSV here</p>
              <p className="text-xs text-slate-400 mt-1">
                Supports .xlsx, .xls, and .csv files up to 25MB
              </p>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          <div className="pt-4 border-t border-slate-800/80 flex items-center justify-center gap-6 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-teal-400" />
              Auto Column Detection
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              UK Phone Normalizer (+44)
            </span>
            <span className="flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-cyan-400" />
              Instant Deduplication
            </span>
          </div>
        </div>
      )}

      {/* STEP 2: Map Columns */}
      {step === 2 && uploadData && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="font-bold text-white text-base">Map Spreadsheet Columns</h3>
              <p className="text-xs text-slate-400">
                Found {uploadData.totalRows} leads in {uploadData.fileName}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Target Campaign</label>
              <select
                value={selectedCampaign}
                onChange={(e) => setSelectedCampaign(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-xl bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-teal-500"
              >
                {campaigns.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { key: 'phone', label: 'UK Phone / Mobile Number *', required: true },
              { key: 'name', label: 'Lead Full Name *', required: true },
              { key: 'email', label: 'Email Address' },
              { key: 'debtAmount', label: 'Total Unsecured Debt (£)' },
              { key: 'creditorCount', label: 'Number of Creditors' },
              { key: 'postcode', label: 'Postcode / City' }
            ].map((field) => (
              <div key={field.key} className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {field.label}
                </label>
                <select
                  value={mapping[field.key] || ''}
                  onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-teal-500"
                >
                  <option value="">-- Do Not Map --</option>
                  {uploadData.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-slate-800">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 text-xs text-slate-400 hover:text-white transition"
            >
              Back
            </button>
            <button
              onClick={handleProceedToValidation}
              className="flex items-center gap-2 px-5 py-2 bg-teal-600 hover:bg-teal-500 text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-teal-500/20"
            >
              <span>Validate & Review</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Validate & Deduplicate */}
      {step === 3 && validationStats && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div>
            <h3 className="font-bold text-white text-base">Validation & Duplicate Checks</h3>
            <p className="text-xs text-slate-400">
              Verifying UK standard formatting (+44) and suppressing internal duplicates
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-xs text-slate-400">Total Rows Found</span>
              <p className="text-xl font-bold text-white mt-1">{validationStats.total}</p>
            </div>
            <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30">
              <span className="text-xs text-emerald-400">Sample Valid UK Mobiles</span>
              <p className="text-xl font-bold text-emerald-300 mt-1">{validationStats.sampleValid}</p>
            </div>
            <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30">
              <span className="text-xs text-amber-400">Format Corrections Applied</span>
              <p className="text-xl font-bold text-amber-300 mt-1">E.164 +44 Prefix</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/50 space-y-2 text-xs text-slate-300">
            <p className="font-semibold text-white">Import Guarantee Checklist:</p>
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Numbers normalized to international E.164 (+44)</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Duplicate telephone numbers inside this campaign will be merged</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Numbers automatically queued for BullMQ dialer pacing</span>
            </div>
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-slate-800">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 text-xs text-slate-400 hover:text-white transition"
            >
              Back to Mapping
            </button>
            <button
              onClick={handleExecuteImport}
              disabled={importing}
              className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-500 text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-teal-500/20 disabled:opacity-50"
            >
              {importing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Importing Leads...</span>
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" />
                  <span>Execute Lead Import</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Import Complete */}
      {step === 4 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-white">Leads Successfully Imported!</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Your UK IVA leads are validated, stored in MongoDB, and ready for Twilio campaign dialing.
          </p>

          <div className="flex justify-center gap-3 pt-4">
            <button
              onClick={() => {
                setStep(1);
                setFile(null);
                setUploadData(null);
              }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
            >
              Upload Another File
            </button>
            <button
              onClick={() => setActiveTab('campaigns')}
              className="px-5 py-2 bg-teal-600 hover:bg-teal-500 text-slate-950 font-bold rounded-xl text-xs shadow-md shadow-teal-500/20"
            >
              View Campaigns
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadLeads;
