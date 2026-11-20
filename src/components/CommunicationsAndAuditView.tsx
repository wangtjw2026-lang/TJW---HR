import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Download,
  Loader2,
  Lock,
  Mail,
  RotateCcw,
  Search,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  createStaffUser,
  deleteStaffUser,
  downloadAuditLogCsv,
  fetchAuditLogsWithMeta,
  sendBatchDocReminders,
  updateStaffUser,
} from '../lib/apiService';
import { formatTimestamp, hasPendingDocs } from '../lib/atsHelpers';
import {
  AuditActorRole,
  AuditLogFilters,
  AuditLogRecord,
  CandidateRecord,
  DEPARTMENTS,
  EmailLogRecord,
  ROLE_META,
  StaffRole,
  StaffUser,
} from '../types/ats';

const EMPTY_AUDIT_FILTERS: AuditLogFilters = {
  search: '',
  actor: '',
  role: '',
  page_visited: '',
  action_taken: '',
  date_from: '',
  date_to: '',
};

const AUDIT_ROLE_LABELS: Record<AuditActorRole, string> = {
  administrator: 'Administrator',
  manager: 'Manager (View Only)',
  candidate_portal: 'Candidate Portal',
  system: 'System',
};

function formatAuditMytDisplay(timestamp: string): { display: string; iso: string } {
  const raw = String(timestamp || '').trim();
  const parenIdx = raw.indexOf(' (');
  if (parenIdx > 0 && raw.endsWith(')')) {
    return {
      display: raw.slice(0, parenIdx),
      iso: raw.slice(parenIdx + 2, -1),
    };
  }
  return { display: raw || '—', iso: raw };
}

function summarizeUserAgent(ua: string): string {
  const raw = String(ua || '').trim();
  if (!raw) return '';
  if (/Edg\//i.test(raw)) return 'Edge';
  if (/Chrome\//i.test(raw) && !/Chromium/i.test(raw)) return 'Chrome';
  if (/Firefox\//i.test(raw)) return 'Firefox';
  if (/Safari\//i.test(raw) && !/Chrome\//i.test(raw)) return 'Safari';
  if (/curl\//i.test(raw)) return 'cURL';
  return raw.slice(0, 32);
}

function getActionToneClass(action: string): string {
  const upper = String(action || '').toUpperCase();
  if (
    upper.includes('FAILED') ||
    upper.includes('DELETE') ||
    upper.includes('CANCEL')
  ) {
    return 'text-[#B91C1C]';
  }
  if (
    upper.includes('CREATE') ||
    upper.includes('ISSUE_OFFER') ||
    upper.includes('AI_RESUME') ||
    upper.includes('EXPORT')
  ) {
    return 'text-[#0F766E]';
  }
  if (upper === 'PAGE_VIEW' || upper === 'LOGIN_SUCCESS') {
    return 'text-[#1D4ED8]';
  }
  return 'text-[#334155]';
}

interface CommunicationsAndAuditViewProps {
  mode: 'emails' | 'team' | 'audit';
  emailLogs: EmailLogRecord[];
  auditLogs: AuditLogRecord[];
  staffUsers: StaffUser[];
  candidates: CandidateRecord[];
  currentUser: StaffUser;
  onRefresh: () => Promise<void> | void;
  onNotify: (message: string) => void;
}

export const CommunicationsAndAuditView: React.FC<CommunicationsAndAuditViewProps> = ({
  mode,
  emailLogs,
  auditLogs,
  staffUsers,
  candidates,
  currentUser,
  onRefresh,
  onNotify,
}) => {
  const isAdmin = currentUser.role === 'administrator';

  const [selectedEmailId, setSelectedEmailId] = useState<number | null>(emailLogs[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Create new staff user form (administrator only)
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('manager');
  const [newDept, setNewDept] = useState<string>('Human Resources');
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<number | null>(null);

  // Tamper-evident Audit Trail filter & query state
  const [auditFilters, setAuditFilters] = useState<AuditLogFilters>(EMPTY_AUDIT_FILTERS);
  const [filteredAuditLogs, setFilteredAuditLogs] = useState<AuditLogRecord[]>(auditLogs);
  const [auditTotalCount, setAuditTotalCount] = useState<number>(auditLogs.length);
  const [auditFacets, setAuditFacets] = useState<{
    actors: string[];
    pages: string[];
    actions: string[];
  }>({ actors: [], pages: [], actions: [] });
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [downloadingAuditCsv, setDownloadingAuditCsv] = useState(false);
  const [auditError, setAuditError] = useState('');

  const hasActiveAuditFilters = useMemo(
    () => Object.values(auditFilters).some((v) => String(v).trim().length > 0),
    [auditFilters]
  );

  const loadAuditTrail = useCallback(async (activeFilters: AuditLogFilters) => {
    setLoadingAudit(true);
    setAuditError('');
    try {
      const result = await fetchAuditLogsWithMeta(activeFilters, 500);
      setFilteredAuditLogs(result.auditLogs);
      setAuditTotalCount(result.totalCount);
      setAuditFacets(result.facets);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Failed to load audit trail records.');
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== 'audit') return;
    const timer = window.setTimeout(() => {
      void loadAuditTrail(auditFilters);
    }, auditFilters.search ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [mode, auditFilters, auditLogs, loadAuditTrail]);

  const handleDownloadAuditCsv = async () => {
    if (!isAdmin) return;
    setDownloadingAuditCsv(true);
    setAuditError('');
    try {
      const filename = await downloadAuditLogCsv(auditFilters);
      onNotify(`Downloaded ${filename}.`);
      await loadAuditTrail(auditFilters);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Failed to download audit log CSV.');
    } finally {
      setDownloadingAuditCsv(false);
    }
  };

  const pendingDocCandidates = useMemo(
    () => candidates.filter((c) => hasPendingDocs(c)),
    [candidates]
  );

  const selectedEmail =
    emailLogs.find((e) => e.id === selectedEmailId) || emailLogs[0] || null;

  const handleBatchReminder = async () => {
    if (!isAdmin || pendingDocCandidates.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const count = await sendBatchDocReminders(pendingDocCandidates.map((c) => c.id));
      await onRefresh();
      onNotify(`Sent ${count} document submission reminder email(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send batch reminders.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy(true);
    setError('');
    try {
      await createStaffUser({
        name: newName,
        email: newEmail,
        password: newPassword,
        role: newRole,
        department: newDept,
      });
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('manager');
      await onRefresh();
      onNotify(`Created ${ROLE_META[newRole].label} account for ${newEmail}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user account.');
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (user: StaffUser, role: StaffRole) => {
    if (!isAdmin) return;
    setBusy(true);
    setError('');
    try {
      await updateStaffUser(user.id, role, user.department);
      await onRefresh();
      onNotify(`Updated ${user.email} role to ${ROLE_META[role].badgeLabel}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUser = async (user: StaffUser) => {
    if (!isAdmin) return;
    setBusy(true);
    setError('');
    try {
      await deleteStaffUser(user.id);
      setConfirmDeleteUserId(null);
      await onRefresh();
      onNotify(`Removed ${user.email} from workspace access.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user.');
    } finally {
      setBusy(false);
    }
  };

  // EMAIL AUTOMATION LOG VIEW
  if (mode === 'emails') {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E2E8F0] pb-4">
          <div>
            <h1 className="text-xl font-bold text-[#0F172A]">Email Automation Log</h1>
            <p className="text-xs text-[#64748B] mt-0.5">
              Every Nodemailer dispatch (Shortlist Forms, Reminders, Interview Invites, Confirmations &amp; Offers) is logged in SQLite.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              disabled={busy || pendingDocCandidates.length === 0}
              onClick={handleBatchReminder}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
            >
              <BellRing className="h-3.5 w-3.5" />
              Send Batch Doc Reminders ({pendingDocCandidates.length})
            </button>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#B91C1C]">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Email list */}
          <div className="lg:col-span-5 border border-[#E2E8F0] rounded-lg bg-white overflow-hidden">
            <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5 text-xs font-semibold text-[#334155]">
              Dispatched Messages ({emailLogs.length})
            </div>
            <div className="divide-y divide-[#E2E8F0] max-h-[600px] overflow-y-auto">
              {emailLogs.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#64748B]">
                  No automated emails recorded yet. Shortlist or qualify a candidate to trigger email automation.
                </div>
              ) : (
                emailLogs.map((log) => {
                  const active = selectedEmail?.id === log.id;
                  return (
                    <button
                      key={log.id}
                      type="button"
                      onClick={() => setSelectedEmailId(log.id)}
                      className={`w-full text-left px-4 py-3 transition-colors ${
                        active ? 'bg-[#F0FDFA]' : 'hover:bg-[#FAFBFC]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[#64748B]">
                        <span className="font-mono font-semibold text-[#0F766E]">
                          Stage {log.stage_triggered} · {log.template_type}
                        </span>
                        <span>{formatTimestamp(log.created_at)}</span>
                      </div>
                      <div className="mt-1 text-xs font-bold text-[#0F172A] truncate">
                        {log.subject}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[11px] text-[#475569]">
                        <span className="truncate">
                          To: {log.candidate_name} ({log.recipient_email})
                        </span>
                        <span className="font-mono text-[10px] text-[#15803D] shrink-0 ml-2">
                          {log.delivery_status}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Email preview */}
          <div className="lg:col-span-7 border border-[#E2E8F0] rounded-lg bg-white p-5">
            {selectedEmail ? (
              <div className="space-y-4">
                <div className="border-b border-[#E2E8F0] pb-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F766E]">
                      <Mail className="h-4 w-4" />
                      {selectedEmail.template_type}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[#15803D]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {selectedEmail.delivery_status}
                    </span>
                  </div>
                  <h2 className="text-base font-bold text-[#0F172A]">{selectedEmail.subject}</h2>
                  <div className="text-xs text-[#475569]">
                    Recipient: <strong>{selectedEmail.candidate_name}</strong> &lt;{selectedEmail.recipient_email}&gt;
                  </div>
                  <div className="text-[11px] text-[#64748B]">
                    Triggered by {selectedEmail.triggered_by} · {formatTimestamp(selectedEmail.created_at)}
                  </div>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-[#334155] bg-[#F8FAFC] border border-[#E2E8F0] rounded-md p-4">
                  {selectedEmail.body_preview}
                </pre>
              </div>
            ) : (
              <div className="py-16 text-center text-xs text-[#64748B]">
                Select an email log entry to inspect its full dispatch body and Google Apps Script links.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // TEAM & ACCESS VIEW (ADMINISTRATOR ONLY)
  if (mode === 'team') {
    if (!isAdmin) {
      return (
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-8 text-center text-xs text-[#64748B]">
          Team &amp; Access management is restricted to Administrator accounts.
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="border-b border-[#E2E8F0] pb-4">
          <h1 className="text-xl font-bold text-[#0F172A]">Team &amp; Access</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Create and manage <strong>Administrator</strong> (full access) and <strong>Manager (View Only)</strong> logins directly in SQLite.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#B91C1C]">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Role Policy Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(['administrator', 'manager'] as StaffRole[]).map((roleKey) => (
            <div key={roleKey} className="rounded-lg border border-[#E2E8F0] bg-white p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#0F172A]">
                  <Shield className="h-4 w-4 text-[#0F766E]" />
                  {ROLE_META[roleKey].badgeLabel}
                </span>
                <span className="font-mono text-[11px] font-semibold text-[#64748B]">{roleKey}</span>
              </div>
              <p className="text-xs text-[#475569] leading-relaxed">{ROLE_META[roleKey].summary}</p>
            </div>
          ))}
        </div>

        {/* Create User Form */}
        <form
          onSubmit={handleCreateUser}
          className="rounded-lg border border-[#E2E8F0] bg-white p-5 space-y-4"
        >
          <div className="inline-flex items-center gap-1.5 text-sm font-bold text-[#0F172A]">
            <UserPlus className="h-4 w-4 text-[#0F766E]" />
            Create New User Login
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#475569] mb-1">Full Name</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Enter full name"
                className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#475569] mb-1">Work Email</label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="name@yourcompany.com"
                className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#475569] mb-1">Password (min 6 chars)</label>
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Set login password"
                className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#475569] mb-1">Department</label>
              <select
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#475569] mb-1">Access Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as StaffRole)}
                className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-semibold text-[#0F172A]"
              >
                <option value="manager">Manager (View Only)</option>
                <option value="administrator">Administrator (Full Access)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Create User Account
            </button>
          </div>
        </form>

        {/* Staff Accounts Table */}
        <div className="rounded-lg border border-[#E2E8F0] bg-white overflow-hidden">
          <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-xs font-bold text-[#0F172A]">
              <Users className="h-4 w-4 text-[#0F766E]" />
              Registered Workspace Users ({staffUsers.length})
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E2E8F0] bg-[#FAFBFC] text-[11px] uppercase tracking-wider text-[#64748B]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Name</th>
                  <th className="px-4 py-2.5 font-semibold">Work Email</th>
                  <th className="px-4 py-2.5 font-semibold">Department</th>
                  <th className="px-4 py-2.5 font-semibold">Role</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {staffUsers.map((u) => {
                  const isSelf = u.id === currentUser.id;
                  return (
                    <tr key={u.id} className="hover:bg-[#FAFBFC]">
                      <td className="px-4 py-3 font-semibold text-[#0F172A]">
                        {u.name}{' '}
                        {isSelf && <span className="text-[11px] font-mono text-[#0F766E]">(You)</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-[#334155]">{u.email}</td>
                      <td className="px-4 py-3 text-[#475569]">{u.department}</td>
                      <td className="px-4 py-3">
                        <select
                          value={u.role}
                          disabled={busy}
                          onChange={(e) => handleRoleChange(u, e.target.value as StaffRole)}
                          className="rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-xs font-semibold text-[#0F172A]"
                        >
                          <option value="administrator">Administrator</option>
                          <option value="manager">Manager (View Only)</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isSelf ? (
                          <span className="text-[11px] text-[#94A3B8]">Current Session</span>
                        ) : confirmDeleteUserId === u.id ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleDeleteUser(u)}
                              className="rounded bg-[#DC2626] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#B91C1C]"
                            >
                              Confirm Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteUserId(null)}
                              className="rounded border border-[#CBD5E1] px-2 py-1 text-[11px] text-[#475569]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmDeleteUserId(u.id)}
                            className="inline-flex items-center gap-1 rounded border border-[#FECACA] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#DC2626] hover:bg-[#FEF2F2]"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // TAMPER-EVIDENT IMMUTABLE AUDIT TRAIL VIEW (BOTH ROLES; CSV DOWNLOAD FOR ADMINISTRATOR ONLY)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E2E8F0] pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-[#0F172A]">User Activity Audit Trail</h1>
            <span className="inline-flex items-center gap-1.5 rounded border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-0.5 text-[11px] font-mono font-semibold text-[#334155]">
              <Lock className="h-3 w-3 text-[#0F766E]" />
              Tamper-Proof Audit Trail • Deletion Disabled
            </span>
          </div>
          <p className="text-xs text-[#64748B]">
            Append-only SQLite activity ledger recording logins, page visits, AI resume screening, candidate lifecycle updates, documents, interviews, offers, emails, and exports.
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            disabled={downloadingAuditCsv}
            onClick={handleDownloadAuditCsv}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50 cursor-pointer shrink-0"
          >
            {downloadingAuditCsv ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Download Audit Log (CSV)
          </button>
        )}
      </div>

      {auditError && (
        <div className="flex items-center gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#B91C1C]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{auditError}</span>
        </div>
      )}

      {/* Multi-Filter Toolbar */}
      <div className="rounded-lg border border-[#E2E8F0] bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2">
            <label className="block text-[11px] font-semibold text-[#475569] mb-1">
              Search Activity
            </label>
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={auditFilters.search}
                onChange={(e) => setAuditFilters((prev) => ({ ...prev, search: e.target.value }))}
                placeholder="User, target, details, or IP..."
                className="w-full rounded-md border border-[#CBD5E1] bg-white pl-8 pr-3 py-1.5 text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0F766E] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#475569] mb-1">Role</label>
            <select
              value={auditFilters.role}
              onChange={(e) => setAuditFilters((prev) => ({ ...prev, role: e.target.value }))}
              className="w-full rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
            >
              <option value="">All Roles</option>
              <option value="administrator">Administrator</option>
              <option value="manager">Manager (View Only)</option>
              <option value="candidate_portal">Candidate Portal</option>
              <option value="system">System</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#475569] mb-1">
              Page Visited
            </label>
            <select
              value={auditFilters.page_visited}
              onChange={(e) =>
                setAuditFilters((prev) => ({ ...prev, page_visited: e.target.value }))
              }
              className="w-full rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
            >
              <option value="">All Pages</option>
              {auditFacets.pages.map((page) => (
                <option key={page} value={page}>
                  {page}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#475569] mb-1">
              Action Taken
            </label>
            <select
              value={auditFilters.action_taken}
              onChange={(e) =>
                setAuditFilters((prev) => ({ ...prev, action_taken: e.target.value }))
              }
              className="w-full rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-mono text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
            >
              <option value="">All Actions</option>
              {auditFacets.actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-[#475569] mb-1">From</label>
              <input
                type="date"
                value={auditFilters.date_from}
                onChange={(e) =>
                  setAuditFilters((prev) => ({ ...prev, date_from: e.target.value }))
                }
                className="w-full rounded-md border border-[#CBD5E1] bg-white px-2 py-1.5 text-xs font-mono text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#475569] mb-1">To</label>
              <input
                type="date"
                value={auditFilters.date_to}
                onChange={(e) => setAuditFilters((prev) => ({ ...prev, date_to: e.target.value }))}
                className="w-full rounded-md border border-[#CBD5E1] bg-white px-2 py-1.5 text-xs font-mono text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#F1F5F9] text-[11px] text-[#64748B]">
          <div className="flex items-center gap-2 font-mono tabular-nums">
            {loadingAudit && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0F766E]" />}
            <span>
              Showing <strong className="text-[#0F172A]">{filteredAuditLogs.length}</strong> of{' '}
              <strong className="text-[#0F172A]">{auditTotalCount}</strong> immutable event(s)
            </span>
          </div>

          {hasActiveAuditFilters && (
            <button
              type="button"
              onClick={() => setAuditFilters(EMPTY_AUDIT_FILTERS)}
              className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-[11px] font-medium text-[#334155] hover:bg-[#F8FAFC] cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Immutable 7-Column Activity Table (Zero Delete/Edit/Clear Controls) */}
      <div className="rounded-lg border border-[#E2E8F0] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] uppercase tracking-wider text-[#64748B]">
              <tr>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">Timestamp</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">User &amp; Role</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">Page Visited</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">Action Taken</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">Target</th>
                <th className="px-4 py-2.5 font-semibold">Details</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {filteredAuditLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-[#64748B]">
                    {loadingAudit
                      ? 'Loading audit trail records...'
                      : hasActiveAuditFilters
                        ? 'No audit events match the active filters.'
                        : 'No user activity events recorded yet.'}
                  </td>
                </tr>
              ) : (
                filteredAuditLogs.map((log) => {
                  const ts = formatAuditMytDisplay(log.timestamp);
                  const browserSummary = summarizeUserAgent(log.user_agent);
                  const roleLabel =
                    AUDIT_ROLE_LABELS[log.actor_role] || log.actor_role;

                  return (
                    <tr key={log.id} className="hover:bg-[#FAFBFC] align-top">
                      <td
                        className="px-4 py-2.5 font-mono text-[11px] text-[#475569] whitespace-nowrap tabular-nums"
                        title={ts.iso}
                      >
                        <div className="font-medium text-[#0F172A]">{ts.display}</div>
                        <div className="text-[10px] text-[#94A3B8]">#{log.id}</div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="font-semibold text-[#0F172A]">{log.actor_name}</div>
                        <div
                          className={`text-[10px] font-mono ${
                            log.actor_role === 'administrator'
                              ? 'text-[#0F766E]'
                              : log.actor_role === 'candidate_portal'
                                ? 'text-[#1D4ED8]'
                                : 'text-[#64748B]'
                          }`}
                        >
                          {roleLabel}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-[#334155] whitespace-nowrap">
                        {log.page_visited}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span
                          className={`font-mono text-[11px] font-semibold ${getActionToneClass(
                            log.action_taken
                          )}`}
                        >
                          {log.action_taken}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[#334155] max-w-[200px]">
                        <div className="truncate font-medium" title={log.target_entity || undefined}>
                          {log.target_entity || '—'}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[#334155] min-w-[240px]">
                        <div className="leading-relaxed">{log.details}</div>
                        {browserSummary && (
                          <div
                            className="mt-0.5 text-[10px] font-mono text-[#94A3B8] truncate max-w-[320px]"
                            title={log.user_agent}
                          >
                            Client: {browserSummary}
                          </div>
                        )}
                      </td>
                      <td
                        className="px-4 py-2.5 font-mono text-[11px] text-[#64748B] whitespace-nowrap tabular-nums"
                        title={log.user_agent || undefined}
                      >
                        {log.ip_address || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
