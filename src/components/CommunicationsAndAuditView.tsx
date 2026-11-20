import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Mail,
  Shield,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  createStaffUser,
  sendBatchDocReminders,
  updateStaffUser,
} from '../lib/apiService';
import { formatTimestamp, hasPendingDocs } from '../lib/atsHelpers';
import {
  AuditLogRecord,
  CandidateRecord,
  DEPARTMENTS,
  EmailLogRecord,
  ROLE_META,
  StaffRole,
  StaffUser,
} from '../types/ats';

interface CommunicationsAndAuditViewProps {
  mode: 'emails' | 'audit';
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
  const isHrAdmin = currentUser.role === 'HR_ADMIN';

  const [selectedEmailId, setSelectedEmailId] = useState<number | null>(emailLogs[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Create new staff user form (HR_ADMIN only)
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('RECRUITER');
  const [newDept, setNewDept] = useState<string>('Human Resources');

  const pendingDocCandidates = useMemo(
    () => candidates.filter((c) => hasPendingDocs(c)),
    [candidates]
  );

  const selectedEmail =
    emailLogs.find((e) => e.id === selectedEmailId) || emailLogs[0] || null;

  const handleBatchReminder = async () => {
    if (pendingDocCandidates.length === 0) return;
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
      await onRefresh();
      onNotify(`Created ${newRole} account for ${newEmail}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create staff user.');
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (user: StaffUser, role: StaffRole) => {
    setBusy(true);
    setError('');
    try {
      await updateStaffUser(user.id, role, user.department);
      await onRefresh();
      onNotify(`Updated ${user.email} role to ${ROLE_META[role].label}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update staff role.');
    } finally {
      setBusy(false);
    }
  };

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
          <button
            type="button"
            disabled={busy || pendingDocCandidates.length === 0}
            onClick={handleBatchReminder}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
          >
            <BellRing className="h-3.5 w-3.5" />
            Send Batch Doc Reminders ({pendingDocCandidates.length})
          </button>
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

  // AUDIT & TEAM RBAC VIEW
  return (
    <div className="space-y-6">
      <div className="border-b border-[#E2E8F0] pb-4">
        <h1 className="text-xl font-bold text-[#0F172A]">Team Roles (RBAC) &amp; Security Audit Trail</h1>
        <p className="text-xs text-[#64748B] mt-0.5">
          Manage `HR_ADMIN` and `RECRUITER` staff accounts in SQLite and review immutable recruitment audit events.
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
        {(['HR_ADMIN', 'RECRUITER'] as StaffRole[]).map((roleKey) => (
          <div key={roleKey} className="rounded-lg border border-[#E2E8F0] bg-white p-4 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#0F172A]">
                <Shield className="h-4 w-4 text-[#0F766E]" />
                {ROLE_META[roleKey].label}
              </span>
              <span className="font-mono text-[11px] font-semibold text-[#64748B]">{roleKey}</span>
            </div>
            <p className="text-xs text-[#475569] leading-relaxed">{ROLE_META[roleKey].summary}</p>
          </div>
        ))}
      </div>

      {/* Staff Accounts Table + Create Form */}
      <div className="rounded-lg border border-[#E2E8F0] bg-white overflow-hidden">
        <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 flex items-center justify-between">
          <div className="inline-flex items-center gap-2 text-xs font-bold text-[#0F172A]">
            <Users className="h-4 w-4 text-[#0F766E]" />
            HR Staff Accounts ({staffUsers.length})
          </div>
          {!isHrAdmin && (
            <span className="text-[11px] text-[#64748B]">Read-only (HR Admin required to modify roles)</span>
          )}
        </div>

        <table className="w-full text-left text-xs">
          <thead className="border-b border-[#E2E8F0] bg-[#FAFBFC] text-[11px] uppercase tracking-wider text-[#64748B]">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Staff Name</th>
              <th className="px-4 py-2.5 font-semibold">Email</th>
              <th className="px-4 py-2.5 font-semibold">Department</th>
              <th className="px-4 py-2.5 font-semibold">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E8F0]">
            {staffUsers.map((u) => (
              <tr key={u.id} className="hover:bg-[#FAFBFC]">
                <td className="px-4 py-3 font-semibold text-[#0F172A]">
                  {u.name} {u.id === currentUser.id && <span className="text-[11px] text-[#0F766E]">(You)</span>}
                </td>
                <td className="px-4 py-3 font-mono text-[#334155]">{u.email}</td>
                <td className="px-4 py-3 text-[#475569]">{u.department}</td>
                <td className="px-4 py-3">
                  {isHrAdmin ? (
                    <select
                      value={u.role}
                      disabled={busy}
                      onChange={(e) => handleRoleChange(u, e.target.value as StaffRole)}
                      className="rounded border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-semibold text-[#0F172A]"
                    >
                      <option value="HR_ADMIN">HR Admin</option>
                      <option value="RECRUITER">Recruiter</option>
                    </select>
                  ) : (
                    <span className="font-mono font-semibold text-[#334155]">{ROLE_META[u.role].label}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {isHrAdmin && (
          <form
            onSubmit={handleCreateUser}
            className="border-t border-[#E2E8F0] bg-[#FAFBFC] p-4 space-y-3"
          >
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0F172A]">
              <UserPlus className="h-3.5 w-3.5 text-[#0F766E]" />
              Add New Staff Account
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Full Name"
                className="rounded border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs"
              />
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="staff@company.com"
                className="rounded border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs"
              />
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Temp Password (6+ chars)"
                className="rounded border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs"
              />
              <select
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                className="rounded border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs"
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as StaffRole)}
                  className="flex-1 rounded border border-[#CBD5E1] bg-white px-2 py-1.5 text-xs"
                >
                  <option value="RECRUITER">Recruiter</option>
                  <option value="HR_ADMIN">HR Admin</option>
                </select>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded bg-[#0F766E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* Audit Logs */}
      <div className="rounded-lg border border-[#E2E8F0] bg-white overflow-hidden">
        <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-xs font-bold text-[#0F172A]">
          Immutable Recruitment Audit Log ({auditLogs.length} recent events)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#E2E8F0] bg-[#FAFBFC] text-[11px] uppercase tracking-wider text-[#64748B]">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Timestamp</th>
                <th className="px-4 py-2.5 font-semibold">Actor</th>
                <th className="px-4 py-2.5 font-semibold">Action</th>
                <th className="px-4 py-2.5 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[#64748B]">
                    No audit events recorded yet.
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-[#FAFBFC]">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[#64748B] whitespace-nowrap">
                      {formatTimestamp(log.created_at)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="font-medium text-[#0F172A]">{log.actor_email}</span>{' '}
                      <span className="font-mono text-[10px] text-[#64748B]">({log.actor_role})</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-[#0F766E] whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className="px-4 py-2.5 text-[#334155]">{log.details}</td>
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
