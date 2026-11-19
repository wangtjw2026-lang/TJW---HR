import React, { useState } from 'react';
import { BellRing, Mail, ShieldCheck, Users } from 'lucide-react';
import {
  CandidateRecord,
  DEPARTMENTS,
  EmailLogRecord,
  PdpaAuditLogRecord,
  ROLE_META,
  StaffRole,
  StaffUser,
} from '../types/ats';
import { formatTimestamp, hasPendingDocs } from '../lib/atsHelpers';
import { updateStaffUserRole } from '../lib/firestoreService';

interface CommunicationsAndAuditViewProps {
  initialSection: 'emails' | 'audit' | 'rbac';
  emailLogs: EmailLogRecord[];
  auditLogs: PdpaAuditLogRecord[];
  staffUsers: StaffUser[];
  candidates: CandidateRecord[];
  actor: StaffUser;
  effectiveRole: StaffRole;
  onSendBatchDocReminders: (targets: CandidateRecord[]) => Promise<void>;
  sendingBatchReminders: boolean;
  onNotify: (msg: string) => void;
}

const TEMPLATE_LABELS: Record<EmailLogRecord['templateType'], string> = {
  shortlist_forms_disc: 'Stage 5 · Shortlisted (Forms & DISC Links)',
  docs_reminder_48h: 'Stage 6 · 48h Missing Academic Docs Reminder',
  interview_invite: 'Stage 9 · Self-Scheduling Interview Invite',
  interview_confirmation: 'Stage 10 · Atomic Slot Booking Confirmation',
  employment_offer: 'Stage 13 · Official MYR Employment Offer',
  rejection_notice: 'Application Outcome Notice',
};

export const CommunicationsAndAuditView: React.FC<CommunicationsAndAuditViewProps> = ({
  initialSection,
  emailLogs,
  auditLogs,
  staffUsers,
  candidates,
  actor,
  effectiveRole,
  onSendBatchDocReminders,
  sendingBatchReminders,
  onNotify,
}) => {
  const [section, setSection] = useState<'emails' | 'audit' | 'rbac'>(initialSection);
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(emailLogs[0]?.id ?? null);
  const [updatingUid, setUpdatingUid] = useState<string | null>(null);

  const pendingDocsCandidates = candidates.filter((c) => hasPendingDocs(c));

  const handleRoleChange = async (target: StaffUser, newRole: StaffRole, dept: string) => {
    setUpdatingUid(target.uid);
    try {
      await updateStaffUserRole({
        targetUser: target,
        newRole,
        department: dept,
        actor,
      });
      onNotify(`Updated RBAC role for ${target.email} to ${ROLE_META[newRole].label}.`);
    } finally {
      setUpdatingUid(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-Section Segmented Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setSection('emails')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              section === 'emails' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Email Automation ({emailLogs.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSection('audit')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              section === 'audit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>PDPA Audit Log ({auditLogs.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSection('rbac')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              section === 'rbac' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>RBAC & Team Access</span>
          </button>
        </div>

        {section === 'emails' && effectiveRole !== 'hiring_manager' && (
          <button
            type="button"
            disabled={sendingBatchReminders || pendingDocsCandidates.length === 0}
            onClick={() => onSendBatchDocReminders(pendingDocsCandidates)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap"
          >
            <BellRing className="w-3.5 h-3.5" />
            <span>
              {sendingBatchReminders
                ? 'Dispatching 48h Reminders...'
                : `Run 48h Missing-Docs Reminder Check (${pendingDocsCandidates.length} eligible)`}
            </span>
          </button>
        )}
      </div>

      {/* SECTION 1: AUTOMATED EMAIL LOGS */}
      {section === 'emails' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Event-Driven Recruitment Email Ledger
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Tracks automated dispatches across Stage 5 (Forms & DISC), Stage 6 (48h Docs Reminders), Stage 9–10 (Interview), and Stage 13 (Offer).
            </p>
          </div>

          {emailLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No automated candidate emails dispatched yet. Advance a candidate to Stage 5 or run a document reminder to see live email logs.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {emailLogs.map((log) => {
                const expanded = expandedEmailId === log.id;
                return (
                  <div key={log.id} className="px-5 py-3.5">
                    <button
                      type="button"
                      onClick={() => setExpandedEmailId(expanded ? null : log.id)}
                      className="w-full text-left flex flex-wrap items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">{log.subject}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          To: <span className="font-medium text-slate-700">{log.candidateName}</span> (
                          <span className="font-mono">{log.maskedRecipient}</span>) · {TEMPLATE_LABELS[log.templateType]}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[11px] font-semibold text-emerald-700">Dispatched</div>
                        <div className="font-mono tabular-nums text-[11px] text-slate-400">
                          {formatTimestamp(log.createdAt)}
                        </div>
                      </div>
                    </button>

                    {expanded && (
                      <pre className="mt-3 p-3.5 bg-slate-50 border border-slate-200 rounded-md text-xs font-sans text-slate-700 whitespace-pre-wrap leading-relaxed">
                        {log.bodyPreview}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* SECTION 2: IMMUTABLE PDPA SECURITY AUDIT LOG */}
      {section === 'audit' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Malaysian PDPA 2010 Immutable Security Audit Log
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Append-only Firestore audit records (updates & deletions strictly blocked at database security rule layer).
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-4 whitespace-nowrap">Timestamp</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Actor & Role</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Action</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Scope</th>
                  <th className="py-2.5 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 px-4 text-center text-slate-500">
                      No audit entries logged yet.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-mono tabular-nums text-[11px] text-slate-500 whitespace-nowrap">
                        {formatTimestamp(log.createdAt)}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <div className="font-medium text-slate-900">{log.actorEmail}</div>
                        <div className="text-[11px] text-slate-500">{ROLE_META[log.actorRole]?.label || log.actorRole}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] font-semibold text-teal-800 whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {log.targetType}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">{log.details}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* SECTION 3: RBAC PERMISSION MATRIX & STAFF DIRECTORY */}
      {section === 'rbac' && (
        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Role-Based Access Control (RBAC) & PDPA Field Masking Policy
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Enforced both in the UI and via split-collection Cloud Firestore security rules.
              </p>
            </div>
            <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 text-xs">
              {(['hr_admin', 'recruiter', 'hiring_manager'] as StaffRole[]).map((roleKey) => {
                const info = ROLE_META[roleKey];
                return (
                  <div key={roleKey} className="p-5 space-y-2">
                    <div className="font-display text-sm font-bold text-slate-900">{info.label}</div>
                    <p className="text-slate-600 leading-relaxed">{info.summary}</p>
                    <div className="pt-2 space-y-1 text-[11px] text-slate-500 font-mono">
                      <div>Candidate PII & Academic Docs: {info.canViewPii ? 'Full Access' : 'Masked (PDPA)'}</div>
                      <div>MYR Salary & Offers: {info.canViewSalary ? 'Full Access' : 'Masked (Admin Only)'}</div>
                      <div>Excel CSV Exports: {info.canExportCsv ? 'Allowed (Audited)' : 'Blocked'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Registered Staff Accounts
              </h3>
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              {staffUsers.map((u) => (
                <div key={u.uid} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{u.displayName}</div>
                    <div className="font-mono text-[11px] text-slate-500">{u.email} · {u.department}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {actor.role === 'hr_admin' && u.uid !== actor.uid ? (
                      <>
                        <select
                          disabled={updatingUid === u.uid}
                          value={u.role}
                          onChange={(e) => handleRoleChange(u, e.target.value as StaffRole, u.department)}
                          className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                        >
                          <option value="hr_admin">HR Admin</option>
                          <option value="recruiter">Recruiter</option>
                          <option value="hiring_manager">Hiring Manager</option>
                        </select>
                        <select
                          disabled={updatingUid === u.uid}
                          value={u.department}
                          onChange={(e) => handleRoleChange(u, u.role, e.target.value)}
                          className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                        >
                          {DEPARTMENTS.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <span className="font-semibold text-teal-800">{ROLE_META[u.role].label}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
