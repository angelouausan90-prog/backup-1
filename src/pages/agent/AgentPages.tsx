import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { MapPicker } from '../../components/MapPicker';
import { PaginationBar, StatusText } from '../../components/SharedUI';
import {
  FranchiseePaperFormModal,
  ApplicationStatusBadge,
  ApplicationWorkflowTimeline,
  downloadApplicationPdf,
} from '../../components/FranchiseePaperFormModal';
import { SignaturePadCanvas } from '../../components/SignaturePadCanvas';
import {
  validateFranchiseeStep1,
  validateFranchiseeStep2,
  composeApplicantFullName,
  composeStoreFullAddress,
  buildFranchiseeUsernameBase,
} from '../../utils/domainRules';

// ===== 1. AGENT RECRUITS DASHBOARD =====
export const AgentRecruitsView: React.FC<{ onNavigate: (path: string) => void }> = ({
  onNavigate,
}) => {
  const [rows, setRows] = useState<any[]>([]);
  const [activePromos, setActivePromos] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({
    total: 0,
    approved: 0,
    pending: 0,
    pending_review: 0,
    for_delivery: 0,
    delivered: 0,
    active: 0,
    rejected: 0,
  });
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedApplication, setSelectedApplication] = useState<any | null>(null);

  const load = (page = 1) => {
    api
      .get(
        `/franchisee-applications?page=${page}&search=${encodeURIComponent(
          search
        )}&status=${encodeURIComponent(statusFilter)}`
      )
      .then((res) => {
        setRows(res.data || []);
        if (res.summary) setSummary(res.summary);
        if (res.pagination) setPagination(res.pagination);
      });
  };

  useEffect(() => {
    load(1);
  }, [search, statusFilter]);

  useEffect(() => {
    api
      .get('/promos')
      .then((res) => setActivePromos(res.data || []))
      .catch(() => {});
  }, []);

  const handleStartNewRegistration = () => {
    sessionStorage.removeItem('aice_edit_application_id');
    onNavigate('/agent/register-franchisee');
  };

  const handleEditApplication = (appRecord: any) => {
    sessionStorage.setItem('aice_edit_application_id', String(appRecord.id));
    setSelectedApplication(null);
    onNavigate('/agent/register-franchisee');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs font-extrabold uppercase tracking-wider mb-1">
            AICE Cotabato-JCDL Corporation • Official Franchisee Records
          </div>
          <h1 className="text-xl font-bold text-slate-900">My Recruited Franchisees</h1>
          <p className="text-sm text-slate-600">
            Track every digitized NEW FRANCHISEE FORM from Admin Review through Equipment Delivery,
            On-Site Signatures, and Store Activation.
          </p>
        </div>
        <button
          type="button"
          onClick={handleStartNewRegistration}
          className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 whitespace-nowrap shrink-0 shadow-xs"
        >
          + New Franchisee Form
        </button>
      </div>

      {/* READ-ONLY ACTIVE PROMOTIONS FOR AGENTS */}
      <div className="bg-white border border-emerald-200 rounded-xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Active Promotions (Read-Only Reference for Your Franchisees)
            </h2>
            <p className="text-xs text-slate-600">
              Share these ongoing AICE stock-replenishment offers with your recruited franchisees.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/agent/promotions')}
            className="text-xs font-semibold text-emerald-800 hover:underline"
          >
            Open Full Promotions Directory →
          </button>
        </div>
        {activePromos.length === 0 ? (
          <p className="text-xs text-slate-500">No active promotions right now.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activePromos.map((p) => (
              <div
                key={p.id}
                className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/50 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">{p.name}</span>
                  <span className="font-mono text-[11px] text-slate-600">
                    Valid: {p.start_date} → {p.end_date}
                  </span>
                </div>
                <div className="text-xs font-semibold text-emerald-900">{p.how_it_works}</div>
                {p.description && <div className="text-xs text-slate-600">{p.description}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Total Recruits</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {summary.total || 0}
          </div>
        </div>
        <div className="bg-white border border-amber-200 rounded-xl p-4">
          <div className="text-xs font-medium text-amber-800">Pending Admin Review</div>
          <div className="mt-1 text-2xl font-bold text-amber-700 font-mono tabular-nums">
            {summary.pending_review ?? summary.pending ?? 0}
          </div>
        </div>
        <div className="bg-white border border-indigo-200 rounded-xl p-4">
          <div className="text-xs font-medium text-indigo-800">Approved / For Delivery</div>
          <div className="mt-1 text-2xl font-bold text-indigo-700 font-mono tabular-nums">
            {Number(summary.approved_only || 0) + Number(summary.for_delivery || 0)}
          </div>
        </div>
        <div className="bg-white border border-emerald-200 rounded-xl p-4">
          <div className="text-xs font-medium text-emerald-800">Active (Equipment Issued)</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700 font-mono tabular-nums">
            {Number(summary.active || 0) + Number(summary.delivered || 0)}
          </div>
        </div>
        <div className="bg-white border border-rose-200 rounded-xl p-4">
          <div className="text-xs font-medium text-rose-800">Rejected</div>
          <div className="mt-1 text-2xl font-bold text-rose-700 font-mono tabular-nums">
            {summary.rejected || 0}
          </div>
        </div>
      </div>

      {/* Applications List */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            type="search"
            aria-label="Search recruited franchisees"
            placeholder="Search application #, store name, applicant, or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-80 px-3.5 py-2 rounded-lg border border-slate-300 text-sm"
          />
          <select
            aria-label="Filter recruits by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3.5 py-2 rounded-lg border border-slate-300 text-sm bg-white font-medium"
          >
            <option value="">All Workflow Statuses</option>
            <option value="Pending Admin Review">Pending Admin Review</option>
            <option value="Approved">Approved (Awaiting Rider Assignment)</option>
            <option value="For Delivery">For Delivery (Rider Assigned)</option>
            <option value="Delivered">Delivered</option>
            <option value="Active">Active (Equipment & Signatures Complete)</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>

        {rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            No franchisee applications found matching your filter.
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((f) => (
              <div
                key={f.id}
                className="border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition bg-slate-50/40 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-black px-2 py-0.5 rounded bg-slate-900 text-white">
                        {f.application_no || `FR-${f.id}`}
                      </span>
                      <h3 className="text-base font-bold text-slate-900">{f.store_name}</h3>
                      <ApplicationStatusBadge status={f.status} />
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      Applicant:{' '}
                      <strong className="text-slate-900">
                        {f.complete_name || f.owner_name || 'User'}
                      </strong>{' '}
                      • Account ID:{' '}
                      <span className="font-mono text-blue-700">
                        {f.username}
                      </span>{' '}
                      • Contact: <span className="font-mono">{f.contact_number}</span> • Date
                      Applied: <span className="font-mono">{String(f.date_applied || '').slice(0, 10)}</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Address: {f.full_address || f.address}{' '}
                      {f.landmark ? ` (Landmark: ${f.landmark})` : ''}
                    </p>
                    {f.freezer_no && (
                      <p className="text-xs font-semibold text-emerald-800 mt-1">
                        Issued Freezer #: <span className="font-mono">{f.freezer_no}</span>
                        {f.date_delivered ? ` • Delivered ${f.date_delivered}` : ''}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {f.status === 'Pending Admin Review' && (
                      <button
                        type="button"
                        onClick={() => handleEditApplication(f)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 transition"
                      >
                        Edit Form
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedApplication(f)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition"
                    >
                      View Paper Form
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadApplicationPdf(f)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition"
                    >
                      PDF
                    </button>
                  </div>
                </div>

                {/* 5-Step Workflow Timeline */}
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                  <ApplicationWorkflowTimeline
                    status={f.status}
                    rejectionReason={f.rejection_reason}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <PaginationBar pagination={pagination} onPageChange={load} />
      </div>

      {selectedApplication && (
        <FranchiseePaperFormModal
          applicationId={selectedApplication.id}
          initialApplication={selectedApplication}
          viewerRole="agent"
          onClose={() => setSelectedApplication(null)}
          onUpdated={() => load(pagination.page)}
          onEditRequest={handleEditApplication}
        />
      )}
    </div>
  );
};

// ===== 2. AGENT REGISTER / EDIT FRANCHISEE WIZARD (Digitized "NEW FRANCHISEE FORM" — AICE Cotabato-JCDL Corporation) =====
const WIZARD_DRAFT_STORAGE_KEY = 'aice_franchisee_wizard_draft';

interface FranchiseeWizardFormState {
  date_applied: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  contact_number: string;
  store_name: string;
  street: string;
  barangay: string;
  city_municipality: string;
  province: string;
  landmark: string;
  facebook_account: string;
  email: string;
  remarks: string;
  initial_password: string;
  lat: number | null;
  lng: number | null;
}

function createInitialWizardFormState(todayDefault: string): FranchiseeWizardFormState {
  return {
    date_applied: todayDefault,
    first_name: '',
    middle_name: '',
    last_name: '',
    contact_number: '',
    store_name: '',
    street: '',
    barangay: '',
    city_municipality: 'Cotabato City',
    province: 'Maguindanao del Norte',
    landmark: '',
    facebook_account: '',
    email: '',
    remarks: '',
    initial_password: '',
    lat: 7.2236,
    lng: 124.2464,
  };
}

export const RegisterFranchiseeView: React.FC = () => {
  const todayDefault = new Date().toISOString().slice(0, 10);

  const [editingAppId, setEditingAppId] = useState<number | null>(() => {
    const saved = sessionStorage.getItem('aice_edit_application_id');
    return saved ? Number(saved) : null;
  });
  const [editingAppNo, setEditingAppNo] = useState<string>('');

  const [step, setStep] = useState<1 | 2 | 3>(() => {
    if (sessionStorage.getItem('aice_edit_application_id')) return 1;
    try {
      const raw = sessionStorage.getItem(WIZARD_DRAFT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.step === 1 || parsed?.step === 2 || parsed?.step === 3) {
          return parsed.step;
        }
      }
    } catch {
      // ignore corrupted draft
    }
    return 1;
  });

  const [form, setForm] = useState<FranchiseeWizardFormState>(() => {
    const defaults = createInitialWizardFormState(todayDefault);
    if (sessionStorage.getItem('aice_edit_application_id')) return defaults;
    try {
      const raw = sessionStorage.getItem(WIZARD_DRAFT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.form && typeof parsed.form === 'object') {
          return {
            ...defaults,
            ...parsed.form,
            lat: parsed.form.lat !== undefined && parsed.form.lat !== null ? Number(parsed.form.lat) : 7.2236,
            lng: parsed.form.lng !== undefined && parsed.form.lng !== null ? Number(parsed.form.lng) : 124.2464,
          };
        }
      }
    } catch {
      // ignore corrupted draft
    }
    return defaults;
  });

  const [storePhotoFile, setStorePhotoFile] = useState<File | null>(null);
  const [storePhotoPreview, setStorePhotoPreview] = useState<string | null>(null);
  const [agentSignature, setAgentSignature] = useState<string | null>(() => {
    if (sessionStorage.getItem('aice_edit_application_id')) return null;
    try {
      const raw = sessionStorage.getItem(WIZARD_DRAFT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed?.agentSignature || null;
      }
    } catch {
      // ignore
    }
    return null;
  });
  const [agentPrintedName, setAgentPrintedName] = useState<string>('Sales Agent');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [toastMessage, setToastMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [checkingStep, setCheckingStep] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submittedRecord, setSubmittedRecord] = useState<any | null>(null);
  const [showSubmittedModal, setShowSubmittedModal] = useState(false);

  // Persist wizard draft to sessionStorage when registering a new franchisee
  useEffect(() => {
    if (editingAppId || submittedRecord) return;
    try {
      sessionStorage.setItem(
        WIZARD_DRAFT_STORAGE_KEY,
        JSON.stringify({
          step,
          form,
          agentSignature,
        })
      );
    } catch {
      // ignore storage quota errors
    }
  }, [step, form, agentSignature, editingAppId, submittedRecord]);

  // Functional field updater so no handler can ever overwrite state with a stale form reference
  const updateField = <K extends keyof FranchiseeWizardFormState>(
    field: K,
    value: FranchiseeWizardFormState[K]
  ) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // Functional coordinate updater for Leaflet map clicks
  const handleMapPick = (lat: number, lng: number) => {
    setForm((prev) => ({
      ...prev,
      lat,
      lng,
    }));
  };

  // Load logged-in agent name on mount
  useEffect(() => {
    api
      .get('/auth/me')
      .then((res) => {
        if (res?.user?.full_name) {
          setAgentPrintedName(res.user.full_name);
        }
      })
      .catch(() => {});
  }, []);

  // Load application details only when editing an existing Pending Admin Review record
  useEffect(() => {
    if (!editingAppId) return;
    api
      .get<{ data: any }>(`/franchisee-applications/${editingAppId}`)
      .then((res) => {
        const rec = res.data;
        if (!rec || rec.status !== 'Pending Admin Review') {
          sessionStorage.removeItem('aice_edit_application_id');
          setEditingAppId(null);
          return;
        }
        setEditingAppNo(rec.application_no || `FR-${rec.id}`);
        setForm({
          date_applied: String(rec.date_applied || todayDefault).slice(0, 10),
          first_name: rec.first_name || '',
          middle_name: rec.middle_name || '',
          last_name: rec.last_name || '',
          contact_number: rec.contact_number || '',
          store_name: rec.store_name || '',
          street: rec.street || '',
          barangay: rec.barangay || '',
          city_municipality: rec.city_municipality || '',
          province: rec.province || '',
          landmark: rec.landmark || '',
          facebook_account: rec.facebook_account || '',
          email: rec.email || '',
          remarks: rec.remarks || '',
          initial_password: '',
          lat: rec.lat !== undefined ? Number(rec.lat) : 7.2236,
          lng: rec.lng !== undefined ? Number(rec.lng) : 124.2464,
        });
        setStorePhotoPreview(rec.store_photo_url || null);
        setAgentSignature(rec.signatures?.sales_agent?.signature_image || null);
      })
      .catch(() => {
        sessionStorage.removeItem('aice_edit_application_id');
        setEditingAppId(null);
      });
  }, [editingAppId, todayDefault]);

  const completeNamePreview = composeApplicantFullName(
    form.first_name,
    form.middle_name,
    form.last_name
  );
  const fullAddressPreview = composeStoreFullAddress(
    form.street,
    form.barangay,
    form.city_municipality,
    form.province
  );
  const derivedUsernamePreview =
    completeNamePreview && form.store_name
      ? `fr_${buildFranchiseeUsernameBase(completeNamePreview, form.store_name)}_###`
      : 'fr_owner_store_###';

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) return;
    setStorePhotoFile(file);
    const url = URL.createObjectURL(file);
    setStorePhotoPreview(url);
  };

  const handleNextFromStep1 = async () => {
    setToastMessage(null);
    const check = validateFranchiseeStep1(form, !editingAppId);
    if (!check.ok) {
      setFieldErrors(check.errors);
      setToastMessage({
        type: 'error',
        text: Object.values(check.errors)[0] || 'Please fix the highlighted fields in Step 1.',
      });
      return;
    }

    // Check server for duplicate contact number, email, or store name
    setCheckingStep(true);
    try {
      const q = new URLSearchParams({
        contact_number: form.contact_number,
        email: form.email,
        store_name: form.store_name,
      });
      if (editingAppId) {
        q.set('exclude_id', String(editingAppId));
      }
      const dupRes = await api.get<{
        hasDuplicates: boolean;
        errors: Record<string, string>;
      }>(`/franchisee-applications/check-duplicate?${q.toString()}`);

      if (dupRes.hasDuplicates) {
        setFieldErrors(dupRes.errors || {});
        setToastMessage({
          type: 'error',
          text:
            Object.values(dupRes.errors || {})[0] ||
            'Duplicate contact number, email, or store name detected.',
        });
        return;
      }

      setFieldErrors({});
      setStep(2);
    } catch (err: any) {
      setToastMessage({
        type: 'error',
        text: err.message || 'Could not validate applicant details.',
      });
    } finally {
      setCheckingStep(false);
    }
  };

  const handleNextFromStep2 = () => {
    setToastMessage(null);
    const check = validateFranchiseeStep2(form);
    if (!check.ok) {
      setFieldErrors(check.errors);
      setToastMessage({
        type: 'error',
        text: Object.values(check.errors)[0] || 'Please complete the store address and map pin.',
      });
      return;
    }
    setFieldErrors({});
    setStep(3);
  };

  const handleSubmitApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    setToastMessage(null);
    setFieldErrors({});
    setSaving(true);

    try {
      const fd = new FormData();
      fd.append('date_applied', form.date_applied);
      fd.append('first_name', form.first_name.trim());
      fd.append('middle_name', form.middle_name.trim());
      fd.append('last_name', form.last_name.trim());
      fd.append('contact_number', form.contact_number.trim());
      fd.append('store_name', form.store_name.trim());
      fd.append('street', form.street.trim());
      fd.append('barangay', form.barangay.trim());
      fd.append('city_municipality', form.city_municipality.trim());
      fd.append('province', form.province.trim());
      fd.append('landmark', form.landmark.trim());
      fd.append('facebook_account', form.facebook_account.trim());
      fd.append('email', form.email.trim());
      fd.append('remarks', form.remarks.trim());
      if (form.initial_password) {
        fd.append('initial_password', form.initial_password);
      }
      fd.append('lat', String(form.lat ?? 7.2236));
      fd.append('lng', String(form.lng ?? 124.2464));
      if (agentSignature) {
        fd.append('sales_agent_signature', agentSignature);
      }
      if (storePhotoFile) {
        fd.append('store_photo', storePhotoFile);
      }

      if (editingAppId) {
        const res = await api.putForm<{ message: string; application: any }>(
          `/franchisee-applications/${editingAppId}`,
          fd
        );
        setSubmittedRecord(res.application);
        setToastMessage({
          type: 'success',
          text: res.message || 'Application updated successfully!',
        });
        sessionStorage.removeItem('aice_edit_application_id');
        sessionStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
        setEditingAppId(null);
      } else {
        const res = await api.postForm<{
          message: string;
          application: any;
          generatedUsername: string;
          applicationNo: string;
        }>('/franchisee-applications', fd);
        setSubmittedRecord(res.application);
        sessionStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
        setToastMessage({
          type: 'success',
          text:
            res.message ||
            `Application ${res.applicationNo} registered!`,
        });
      }
    } catch (err: any) {
      setToastMessage({
        type: 'error',
        text: err.message || 'Failed to submit franchisee application.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetNewForm = () => {
    sessionStorage.removeItem('aice_edit_application_id');
    sessionStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
    setEditingAppId(null);
    setEditingAppNo('');
    setSubmittedRecord(null);
    setToastMessage(null);
    setFieldErrors({});
    setStep(1);
    setForm(createInitialWizardFormState(todayDefault));
    setStorePhotoFile(null);
    setStorePhotoPreview(null);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Official Company Paper Form Header Banner */}
      <div className="bg-white border-2 border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 text-center border-b border-slate-200">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
            Official Digitized Franchisee Registration
          </p>
          <h1 className="text-xl sm:text-2xl font-black tracking-wide text-slate-900">
            AICE COTABATO-JCDL CORPORATION
          </h1>
        </div>
        <div className="bg-emerald-600 text-white px-6 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <span className="font-extrabold tracking-widest uppercase text-sm sm:text-base">
            NEW FRANCHISEE FORM {editingAppId ? `(EDITING ${editingAppNo})` : ''}
          </span>
          <span className="text-xs font-semibold bg-emerald-700 px-2.5 py-0.5 rounded">
            Sales Agent: {agentPrintedName}
          </span>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="alert"
          className={`p-4 rounded-xl border text-sm font-semibold flex items-center justify-between gap-3 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-rose-50 border-rose-300 text-rose-900'
          }`}
        >
          <span>{toastMessage.text}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-xs font-bold underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Confirmation Banner After Successful Submission */}
      {submittedRecord && (
        <div className="bg-emerald-50 border-2 border-emerald-400 rounded-2xl p-5 space-y-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded bg-emerald-700 text-white font-mono text-xs font-bold">
                  {submittedRecord.application_no}
                </span>
                <ApplicationStatusBadge status={submittedRecord.status} />
              </div>
              <h2 className="text-lg font-extrabold text-slate-900 mt-1">
                Franchisee Application Saved for &ldquo;{submittedRecord.store_name}&rdquo;
              </h2>
              <p className="text-xs text-slate-700 mt-0.5">
                Applicant: <strong>{submittedRecord.complete_name}</strong> • Auto-Generated
                Franchisee Username:{' '}
                <strong className="font-mono text-blue-800 bg-white px-2 py-0.5 rounded border border-blue-200">
                  {submittedRecord.username}
                </strong>
              </p>
              <p className="text-xs text-emerald-900 mt-1">
                The Admin has been notified. Once the Admin approves this application and assigns a
                Delivery Staff rider, the rider will complete Section 2 (Equipment Checklist) and
                Section 3 (On-Site Signatures) upon freezer delivery.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSubmittedModal(true)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800"
              >
                View / Print Official Form
              </button>
              <button
                type="button"
                onClick={() => downloadApplicationPdf(submittedRecord)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Download PDF
              </button>
              <button
                type="button"
                onClick={handleResetNewForm}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                Register Another Franchisee
              </button>
            </div>
          </div>

          <div className="bg-white border border-emerald-200 rounded-xl p-3">
            <ApplicationWorkflowTimeline status={submittedRecord.status} />
          </div>
        </div>
      )}

      {/* Multi-Step Wizard Progress Bar */}
      {!submittedRecord && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { num: 1, title: '1. Applicant Details', desc: 'Owner name, PH mobile, store & remarks' },
              { num: 2, title: '2. Store Location', desc: 'Complete address, landmark & map pin' },
              { num: 3, title: '3. Review & Submit', desc: 'Verify official form & Sales Agent sign-off' },
            ].map((s) => {
              const active = step === s.num;
              const done = step > s.num;
              return (
                <button
                  key={s.num}
                  type="button"
                  onClick={() => {
                    if (s.num < step) setStep(s.num as 1 | 2 | 3);
                  }}
                  className={`text-left p-3 rounded-xl border transition ${
                    active
                      ? 'border-emerald-600 bg-emerald-50/70 ring-2 ring-emerald-100'
                      : done
                      ? 'border-emerald-200 bg-emerald-50/30 cursor-pointer'
                      : 'border-slate-200 bg-slate-50 opacity-75'
                  }`}
                >
                  <div className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                    <span
                      className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center font-bold ${
                        active || done
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {done ? '✓' : s.num}
                    </span>
                    <span>{s.title}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 pl-6">{s.desc}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Wizard Form Body */}
      {!submittedRecord && (
        <form
          onSubmit={handleSubmitApplication}
          className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5 shadow-xs"
        >
          {/* STEP 1: APPLICANT DETAILS */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="border-b border-slate-200 pb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-extrabold text-slate-900 uppercase tracking-wide">
                    Section 1: Applicant Details
                  </h2>
                  <p className="text-xs text-slate-500">
                    All fields marked with <span className="text-red-600 font-bold">*</span> are
                    required. Duplicate contact numbers, emails, or store names are automatically
                    checked.
                  </p>
                </div>
                {editingAppId && (
                  <button
                    type="button"
                    onClick={handleResetNewForm}
                    className="text-xs font-bold text-slate-600 hover:text-slate-900 underline"
                  >
                    Cancel Edit & Start Fresh
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Date Applied <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.date_applied}
                    onChange={(e) => updateField('date_applied', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  {fieldErrors.date_applied && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">
                      {fieldErrors.date_applied}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    First Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter first name"
                    value={form.first_name}
                    onChange={(e) => updateField('first_name', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  {fieldErrors.first_name && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">
                      {fieldErrors.first_name}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Middle Name / Initial
                  </label>
                  <input
                    type="text"
                    placeholder="Middle name or initial"
                    value={form.middle_name}
                    onChange={(e) => updateField('middle_name', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Last Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter last name"
                    value={form.last_name}
                    onChange={(e) => updateField('last_name', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  {fieldErrors.last_name && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">
                      {fieldErrors.last_name}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Name of Store <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter store name"
                    value={form.store_name}
                    onChange={(e) => updateField('store_name', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  {fieldErrors.store_name && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">
                      {fieldErrors.store_name}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Contact Number (PH Mobile Format) <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="09XXXXXXXXX"
                    value={form.contact_number}
                    onChange={(e) => updateField('contact_number', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                  {fieldErrors.contact_number && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">
                      {fieldErrors.contact_number}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    FB Acct (Name or Profile Link) <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Facebook profile or page link"
                    value={form.facebook_account}
                    onChange={(e) => updateField('facebook_account', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  {fieldErrors.facebook_account && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">
                      {fieldErrors.facebook_account}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Email Address <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="email"
                    placeholder="Enter email address"
                    value={form.email}
                    onChange={(e) => updateField('email', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  {fieldErrors.email && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">{fieldErrors.email}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Initial Account Password{' '}
                    {editingAppId ? '(Leave blank to keep)' : <span className="text-red-600">*</span>}
                  </label>
                  <input
                    type="password"
                    placeholder="Min. 8 characters"
                    value={form.initial_password}
                    onChange={(e) => updateField('initial_password', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  {fieldErrors.initial_password && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">
                      {fieldErrors.initial_password}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Remarks <span className="text-red-600">*</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Enter store assessment, electrical readiness, foot traffic notes, or special delivery remarks..."
                  value={form.remarks}
                  onChange={(e) => updateField('remarks', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
                {fieldErrors.remarks && (
                  <p className="text-xs text-rose-600 mt-1 font-medium">{fieldErrors.remarks}</p>
                )}
              </div>

              {/* Derived Account Preview Box */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="text-slate-500">Complete Name on Form:</span>{' '}
                  <strong className="text-slate-900">{completeNamePreview || '—'}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Auto-Derived Username Pattern:</span>{' '}
                  <code className="font-mono font-bold text-blue-700">
                    {derivedUsernamePreview}
                  </code>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={checkingStep}
                  onClick={handleNextFromStep1}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  {checkingStep ? 'Checking Duplicates...' : 'Next: Store Location & Map Pin →'}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: STORE LOCATION & MAP PIN */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="border-b border-slate-200 pb-3">
                <h2 className="text-base font-extrabold text-slate-900 uppercase tracking-wide">
                  Step 2: Store Address, Landmark, Photo & Map Pin
                </h2>
                <p className="text-xs text-slate-500">
                  Provide the complete store location and pin the exact coordinates on the
                  OpenStreetMap so the Delivery Staff rider can navigate to the store.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Street / Building / Purok <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Street, building or purok"
                    value={form.street}
                    onChange={(e) => updateField('street', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  {fieldErrors.street && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">{fieldErrors.street}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Barangay <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter barangay"
                    value={form.barangay}
                    onChange={(e) => updateField('barangay', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  {fieldErrors.barangay && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">{fieldErrors.barangay}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    City / Municipality <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter city or municipality"
                    value={form.city_municipality}
                    onChange={(e) => updateField('city_municipality', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  {fieldErrors.city_municipality && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">
                      {fieldErrors.city_municipality}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Province <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter province"
                    value={form.province}
                    onChange={(e) => updateField('province', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  {fieldErrors.province && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">{fieldErrors.province}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Landmark <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Nearest landmark or cross street"
                    value={form.landmark}
                    onChange={(e) => updateField('landmark', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  {fieldErrors.landmark && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">{fieldErrors.landmark}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Optional Store Photo Upload (JPG, PNG, WEBP)
                  </label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handlePhotoChange}
                    className="w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-slate-900 file:text-white hover:file:bg-slate-800"
                  />
                  {storePhotoFile && (
                    <p className="text-[11px] font-semibold text-emerald-700 mt-1">
                      Selected photo: {storePhotoFile.name}
                    </p>
                  )}
                  {storePhotoPreview && (
                    <img
                      src={storePhotoPreview}
                      alt="Store preview"
                      className="mt-2 h-16 rounded border border-slate-300 object-cover"
                    />
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="block text-xs font-bold text-slate-700">
                    Pin Franchisee Store Location on Map <span className="text-red-600">*</span>
                  </span>
                  {form.lat !== null && form.lng !== null && (
                    <span className="font-mono text-xs text-emerald-700 font-semibold">
                      Pinned: {Number(form.lat).toFixed(5)}, {Number(form.lng).toFixed(5)}
                    </span>
                  )}
                </div>
                <MapPicker
                  lat={form.lat}
                  lng={form.lng}
                  onPick={handleMapPick}
                />
                {(fieldErrors.coordinates || fieldErrors.coords) && (
                  <p className="text-xs text-rose-600 mt-1 font-medium">
                    {fieldErrors.coordinates || fieldErrors.coords}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  ← Back to Applicant Details
                </button>
                <button
                  type="button"
                  onClick={handleNextFromStep2}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
                >
                  Next: Review & Submit →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: REVIEW & SUBMIT */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="border-b border-slate-200 pb-3">
                <h2 className="text-base font-extrabold text-slate-900 uppercase tracking-wide">
                  Step 3: Review Digitized NEW FRANCHISEE FORM & Sales Agent Sign-Off
                </h2>
                <p className="text-xs text-slate-500">
                  Review all Section 1 fields below. Section 2 (Equipment Received by the Customer)
                  and Section 3 delivery signatures will be completed by the Delivery Staff on site
                  after Admin approval.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 border border-slate-300 rounded-xl overflow-hidden">
                  <div className="bg-slate-800 text-white px-3.5 py-2 text-xs font-bold uppercase tracking-wider">
                    Section 1 Summary — Applicant & Store Details
                  </div>
                  <div className="divide-y divide-slate-200 text-xs">
                    <div className="grid grid-cols-12 p-2.5">
                      <span className="col-span-4 font-bold text-slate-500">DATE APPLIED:</span>
                      <span className="col-span-8 font-semibold text-slate-900">
                        {form.date_applied}
                      </span>
                    </div>
                    <div className="grid grid-cols-12 p-2.5">
                      <span className="col-span-4 font-bold text-slate-500">COMPLETE NAME:</span>
                      <span className="col-span-8 font-bold text-slate-900">
                        {completeNamePreview}
                      </span>
                    </div>
                    <div className="grid grid-cols-12 p-2.5">
                      <span className="col-span-4 font-bold text-slate-500">CONTACT NUMBER:</span>
                      <span className="col-span-8 font-mono font-semibold text-slate-900">
                        {form.contact_number}
                      </span>
                    </div>
                    <div className="grid grid-cols-12 p-2.5">
                      <span className="col-span-4 font-bold text-slate-500">NAME OF STORE:</span>
                      <span className="col-span-8 font-bold text-blue-900">{form.store_name}</span>
                    </div>
                    <div className="grid grid-cols-12 p-2.5">
                      <span className="col-span-4 font-bold text-slate-500">STORE ADDRESS:</span>
                      <span className="col-span-8 font-semibold text-slate-900">
                        {fullAddressPreview}
                      </span>
                    </div>
                    <div className="grid grid-cols-12 p-2.5">
                      <span className="col-span-4 font-bold text-slate-500">LANDMARK:</span>
                      <span className="col-span-8 text-slate-800">{form.landmark}</span>
                    </div>
                    <div className="grid grid-cols-12 p-2.5">
                      <span className="col-span-4 font-bold text-slate-500">FB ACCT:</span>
                      <span className="col-span-8 text-slate-800">{form.facebook_account}</span>
                    </div>
                    <div className="grid grid-cols-12 p-2.5">
                      <span className="col-span-4 font-bold text-slate-500">EMAIL:</span>
                      <span className="col-span-8 text-slate-800">{form.email}</span>
                    </div>
                    <div className="grid grid-cols-12 p-2.5">
                      <span className="col-span-4 font-bold text-slate-500">GPS COORDINATES:</span>
                      <span className="col-span-8 font-mono text-slate-800">
                        {Number(form.lat).toFixed(5)}, {Number(form.lng).toFixed(5)}
                      </span>
                    </div>
                    <div className="grid grid-cols-12 p-2.5">
                      <span className="col-span-4 font-bold text-slate-500">REMARKS:</span>
                      <span className="col-span-8 text-slate-800">{form.remarks}</span>
                    </div>
                    {storePhotoPreview && (
                      <div className="grid grid-cols-12 p-2.5 items-center">
                        <span className="col-span-4 font-bold text-slate-500">STORE PHOTO:</span>
                        <div className="col-span-8 flex items-center gap-2">
                          <img
                            src={storePhotoPreview}
                            alt="Store preview"
                            className="h-12 rounded border border-slate-300 object-cover"
                          />
                          {storePhotoFile && (
                            <span className="text-[11px] font-semibold text-emerald-700">
                              {storePhotoFile.name}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-5 space-y-4">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-xs space-y-1.5">
                    <div className="font-extrabold text-emerald-900 uppercase">
                      Section 2: Equipment Checklist (Completed at Delivery)
                    </div>
                    <p className="text-emerald-800">
                      The 6 standard items (<strong>Freezer, Lock &amp; Key, Scraper, Baskets, Manual, Freezer Cover</strong>) and <strong>Freezer #</strong> will be checked as NEW or OLD by the assigned Delivery Staff rider upon physical delivery.
                    </p>
                  </div>

                  <SignaturePadCanvas
                    label="Sales Agent Sign-Off (Section 3)"
                    printedName={agentPrintedName}
                    readOnlyName
                    signatureDataUrl={agentSignature}
                    onSignatureChange={setAgentSignature}
                    height={115}
                    helperText="Your name is recorded automatically from your Agent session. Draw your signature above (optional)."
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  ← Back to Store Location
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 shadow-xs"
                >
                  {saving
                    ? 'Submitting Official Form...'
                    : editingAppId
                    ? `Save Changes to ${editingAppNo}`
                    : 'Submit NEW FRANCHISEE FORM for Admin Review'}
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      {showSubmittedModal && submittedRecord && (
        <FranchiseePaperFormModal
          applicationId={submittedRecord.id}
          initialApplication={submittedRecord}
          viewerRole="agent"
          onClose={() => setShowSubmittedModal(false)}
        />
      )}
    </div>
  );
};

// ===== 3. AGENT COMMISSIONS VIEW =====
export const AgentCommissionsView: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });

  const load = (page = 1) => {
    api.get(`/commissions?page=${page}`).then((res) => {
      setRows(res.data);
      setPagination(res.pagination);
    });
  };

  useEffect(() => {
    load(1);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">My Commission Records</h1>
        <p className="text-sm text-slate-600">
          Commissions manually issued by the Admin based on your approved franchisee recruits.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 pr-4">Period</th>
                <th className="py-2.5 pr-4 text-right">Approved Recruits Count</th>
                <th className="py-2.5 pr-4 text-right">Commission Amount</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 pr-4">Notes</th>
                <th className="py-2.5 text-right">Recorded Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-slate-500">
                    No commission records issued yet.
                  </td>
                </tr>
              ) : (
                rows.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-4 font-semibold text-slate-900">{c.period_label}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs">{c.recruits_count}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-xs font-bold text-slate-900">
                      PHP {Number(c.amount).toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <StatusText status={c.status} />
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-slate-600">{c.notes || '—'}</td>
                    <td className="py-2.5 text-right font-mono text-xs text-slate-500">
                      {c.created_at}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar pagination={pagination} onPageChange={load} />
      </div>
    </div>
  );
};

// ===== 4. AGENT READ-ONLY ACTIVE PROMOTIONS VIEW =====
export const AgentPromotionsView: React.FC = () => {
  const [promos, setPromos] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    api
      .get('/promos')
      .then((res) => setPromos(res.data || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Active Franchisee Promotions (Read-Only)</h1>
        <p className="text-sm text-slate-600">
          Review active AICE stock-replenishment promotions so you can inform your recruited franchisees about eligible bulk discounts, free cartons, and seasonal deals.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading active promotions...</p>
        ) : promos.length === 0 ? (
          <p className="text-sm text-slate-500">No active promotions right now.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2.5 pr-4">Promotion Name</th>
                  <th className="py-2.5 pr-4">How It Works</th>
                  <th className="py-2.5 pr-4">Scope</th>
                  <th className="py-2.5 pr-4">Valid Period</th>
                  <th className="py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {promos.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-slate-900">{p.name}</div>
                      {p.description && (
                        <div className="text-xs text-slate-500">{p.description}</div>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs font-semibold text-emerald-800">
                      {p.how_it_works}
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-700">
                      {p.scope === 'all_products'
                        ? 'All Products'
                        : p.scope === 'category'
                        ? 'Selected Categories'
                        : 'Selected Products'}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-700">
                      {p.start_date} → {p.end_date}
                      {p.days_remaining !== null && p.days_remaining <= 7 && (
                        <div className="text-[11px] font-sans font-bold text-amber-800">
                          Ends in {p.days_remaining} day{p.days_remaining === 1 ? '' : 's'}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <StatusText status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
