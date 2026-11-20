import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CalendarX2,
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  fetchDangerZoneStats,
  purgeRejectedCandidates,
  resetUnbookedInterviewSlots,
  reviewUserTwoFaChange,
  revokeAllUserSessions,
} from '../lib/apiService';
import {
  DangerZoneStats,
  StaffUser,
  TwoFaRequestedAction,
  TwoFaRequestedPayload,
} from '../types/ats';

const TWO_FA_ACTION_LABELS: Record<TwoFaRequestedAction, string> = {
  RESET_2FA: 'Reset 2FA Enrollment (Email OTP)',
  DISABLE_2FA: 'Disable 2FA Protection',
  ENABLE_2FA: 'Enable 2FA Protection',
  SWITCH_TO_AUTHENTICATOR_APP: 'Switch Method to Authenticator App',
  SWITCH_TO_EMAIL_OTP: 'Switch Method to Email OTP',
};

function parseTwoFaRequest(raw: string): TwoFaRequestedPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TwoFaRequestedPayload>;
    if (parsed && typeof parsed.action === 'string') {
      return {
        action: parsed.action as TwoFaRequestedAction,
        reason: String(parsed.reason || ''),
        requested_at: String(parsed.requested_at || ''),
      };
    }
  } catch {
    return {
      action: raw as TwoFaRequestedAction,
      reason: '',
      requested_at: '',
    };
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatShortMyt(ts: string): string {
  const raw = String(ts || '').trim();
  if (!raw) return '—';
  const idx = raw.indexOf(' (');
  return idx > 0 ? raw.slice(0, idx) : raw;
}

type DangerActionKind = 'purge_rejected' | 'revoke_sessions' | 'reset_slots';

interface DangerModalConfig {
  kind: DangerActionKind;
  title: string;
  description: string;
  phrase: string;
  confirmLabel: string;
}

interface TwoFaModalState {
  targetUser: StaffUser;
  decision: 'approve' | 'deny';
  actionToApply?: TwoFaRequestedAction;
  requestSummary: string;
}

interface DangerZoneGovernancePanelProps {
  currentUser: StaffUser;
  staffUsers: StaffUser[];
  onRefreshWorkspace: () => Promise<void> | void;
  onNotify: (message: string) => void;
  onForceGlobalLogout: (notice: string) => void;
}

export const DangerZoneGovernancePanel: React.FC<DangerZoneGovernancePanelProps> = ({
  currentUser,
  staffUsers,
  onRefreshWorkspace,
  onNotify,
  onForceGlobalLogout,
}) => {
  const isAdmin = currentUser.role === 'administrator';

  const [stats, setStats] = useState<DangerZoneStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState('');

  // Admin-initiated 2FA governance controls
  const [overrideUserId, setOverrideUserId] = useState<string>('');
  const [overrideAction, setOverrideAction] = useState<TwoFaRequestedAction>('RESET_2FA');

  // 2FA Password Verification Modal state
  const [twoFaModal, setTwoFaModal] = useState<TwoFaModalState | null>(null);
  const [twoFaAdminPassword, setTwoFaAdminPassword] = useState('');
  const [twoFaNotes, setTwoFaNotes] = useState('');
  const [twoFaSubmitting, setTwoFaSubmitting] = useState(false);
  const [twoFaError, setTwoFaError] = useState('');

  // Danger Zone Guarded Action Modal state
  const [dangerModal, setDangerModal] = useState<DangerModalConfig | null>(null);
  const [dangerPassword, setDangerPassword] = useState('');
  const [dangerPhraseInput, setDangerPhraseInput] = useState('');
  const [dangerSubmitting, setDangerSubmitting] = useState(false);
  const [dangerError, setDangerError] = useState('');

  const loadStats = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingStats(true);
    setStatsError('');
    try {
      const data = await fetchDangerZoneStats();
      setStats(data);
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : 'Failed to load Danger Zone live metrics.');
    } finally {
      setLoadingStats(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadStats();
  }, [isAdmin, loadStats, staffUsers.length]);

  // Strictly hidden for any non-administrator role
  if (!isAdmin) {
    return null;
  }

  const openTwoFaReviewModal = (
    user: StaffUser,
    decision: 'approve' | 'deny',
    explicitAction?: TwoFaRequestedAction
  ) => {
    const parsed = parseTwoFaRequest(user.two_fa_requested_state);
    const effectiveAction = explicitAction || parsed?.action;
    const summary = effectiveAction
      ? TWO_FA_ACTION_LABELS[effectiveAction] || effectiveAction
      : 'Pending 2FA Change';
    setTwoFaModal({
      targetUser: user,
      decision,
      actionToApply: effectiveAction,
      requestSummary: summary,
    });
    setTwoFaAdminPassword('');
    setTwoFaNotes('');
    setTwoFaError('');
  };

  const handleConfirmTwoFaReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFaModal) return;
    if (!twoFaAdminPassword) {
      setTwoFaError('Enter your current System Administrator password to verify this action.');
      return;
    }

    setTwoFaSubmitting(true);
    setTwoFaError('');
    try {
      const res = await reviewUserTwoFaChange(twoFaModal.targetUser.id, {
        decision: twoFaModal.decision,
        admin_password: twoFaAdminPassword,
        requested_action: twoFaModal.actionToApply,
        notes: twoFaNotes.trim(),
      });
      setStats(res.stats);
      setTwoFaModal(null);
      setTwoFaAdminPassword('');
      setTwoFaNotes('');
      await onRefreshWorkspace();
      onNotify(
        twoFaModal.decision === 'approve'
          ? `Approved & applied 2FA change (${twoFaModal.requestSummary}) for ${twoFaModal.targetUser.email}.`
          : `Denied 2FA change request for ${twoFaModal.targetUser.email}. Account remains locked.`
      );
    } catch (err) {
      setTwoFaError(err instanceof Error ? err.message : '2FA governance review failed.');
    } finally {
      setTwoFaSubmitting(false);
    }
  };

  const openDangerActionModal = (kind: DangerActionKind) => {
    setDangerPassword('');
    setDangerPhraseInput('');
    setDangerError('');

    if (kind === 'purge_rejected') {
      setDangerModal({
        kind,
        title: 'Purge Rejected / Withdrawn Candidate Data',
        description:
          'Permanently removes rejected and withdrawn candidate records from SQLite and deletes their physical resume/document files from uploads/. Active pipeline candidates and immutable audit logs are strictly preserved.',
        phrase: 'PURGE REJECTED CANDIDATES',
        confirmLabel: 'Execute PDPA Purge',
      });
    } else if (kind === 'revoke_sessions') {
      setDangerModal({
        kind,
        title: 'Revoke All Active User Sessions',
        description:
          'Increments token_version across every staff account in SQLite, immediately invalidating all active JWT tokens (including your current session) so every staff member must re-authenticate.',
        phrase: 'REVOKE ALL SESSIONS',
        confirmLabel: 'Force Global Logout',
      });
    } else {
      setDangerModal({
        kind,
        title: 'Reset Unbooked Future Interview Slots',
        description:
          'Deletes all unbooked future interview slots from today onward (MYT). All booked candidate interviews and completed slot records remain untouched.',
        phrase: 'RESET INTERVIEW SLOTS',
        confirmLabel: 'Delete Unbooked Slots',
      });
    }
  };

  const handleExecuteDangerAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dangerModal) return;

    if (dangerPhraseInput.trim() !== dangerModal.phrase) {
      setDangerError(`Confirmation phrase must match exactly: ${dangerModal.phrase}`);
      return;
    }
    if (!dangerPassword) {
      setDangerError('Enter your current System Administrator password to confirm.');
      return;
    }

    setDangerSubmitting(true);
    setDangerError('');

    try {
      if (dangerModal.kind === 'purge_rejected') {
        const res = await purgeRejectedCandidates({
          admin_password: dangerPassword,
          confirmation_phrase: dangerPhraseInput.trim(),
        });
        setStats(res.stats);
        setDangerModal(null);
        await onRefreshWorkspace();
        onNotify(
          `PDPA cleanup complete: purged ${res.purgedCandidates} rejected/withdrawn candidate(s) and deleted ${res.removedFiles} file(s) from uploads/.`
        );
      } else if (dangerModal.kind === 'revoke_sessions') {
        const res = await revokeAllUserSessions({
          admin_password: dangerPassword,
          confirmation_phrase: dangerPhraseInput.trim(),
        });
        setDangerModal(null);
        onForceGlobalLogout(
          `All active user sessions (${res.revokedAccounts} account${res.revokedAccounts === 1 ? '' : 's'}) were revoked by System Administrator. Please sign in again.`
        );
      } else {
        const res = await resetUnbookedInterviewSlots({
          admin_password: dangerPassword,
          confirmation_phrase: dangerPhraseInput.trim(),
        });
        setStats(res.stats);
        setDangerModal(null);
        await onRefreshWorkspace();
        onNotify(
          `Reset ${res.deletedSlots} unbooked future interview slot(s). Preserved ${res.preservedBookedSlots} booked slot(s).`
        );
      }
    } catch (err) {
      setDangerError(err instanceof Error ? err.message : 'Danger Zone operation failed.');
    } finally {
      setDangerSubmitting(false);
    }
  };

  const handleLaunchAdminTwoFaOverride = () => {
    const targetId = Number(overrideUserId);
    const target = staffUsers.find((u) => u.id === targetId);
    if (!target) return;
    openTwoFaReviewModal(target, 'approve', overrideAction);
  };

  const pendingTwoFaUsers = stats?.pendingTwoFaUsers || [];

  return (
    <section className="rounded-lg border border-[#FECACA] bg-white overflow-hidden">
      {/* Danger Zone Header */}
      <div className="border-b border-[#FECACA] bg-[#FEF2F2] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="inline-flex items-center gap-2 text-sm font-bold text-[#991B1B]">
            <ShieldAlert className="h-4 w-4 text-[#DC2626] shrink-0" />
            <span>Danger Zone &amp; 2FA Governance</span>
          </div>
          <p className="text-xs text-[#7F1D1D]">
            System Administrator restricted console · Live SQLite inventory, locked 2FA approvals, and password-verified critical actions.
          </p>
        </div>

        <button
          type="button"
          disabled={loadingStats}
          onClick={() => void loadStats()}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#FECACA] bg-white px-3 py-1.5 text-xs font-semibold text-[#991B1B] hover:bg-[#FFF5F5] disabled:opacity-50 cursor-pointer whitespace-nowrap"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingStats ? 'animate-spin' : ''}`} />
          <span>Refresh Live Counts</span>
        </button>
      </div>

      {statsError && (
        <div className="mx-5 mt-4 flex items-center gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#B91C1C]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{statsError}</span>
        </div>
      )}

      {/* Live SQLite & Disk Inventory Strip (100% Real Data) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-[#E2E8F0] border-b border-[#E2E8F0]">
        <div className="p-4 space-y-1">
          <div className="text-[11px] font-semibold text-[#64748B]">Candidates in SQLite</div>
          <div className="font-mono text-xl font-bold text-[#0F172A] tabular-nums">
            {loadingStats && !stats ? '—' : stats?.candidates.total ?? 0}
          </div>
          <div className="text-[11px] text-[#475569] font-mono tabular-nums">
            {stats
              ? `${stats.candidates.active} active · ${stats.candidates.rejectedOrWithdrawn} rejected/withdrawn`
              : 'Loading live counts...'}
          </div>
        </div>

        <div className="p-4 space-y-1">
          <div className="text-[11px] font-semibold text-[#64748B]">Uploaded Files (uploads/)</div>
          <div className="font-mono text-xl font-bold text-[#0F172A] tabular-nums">
            {loadingStats && !stats ? '—' : stats?.files.filesOnDisk ?? 0}
          </div>
          <div className="text-[11px] text-[#475569] font-mono tabular-nums">
            {stats
              ? `${stats.files.dbDocumentRecords} DB doc rows · ${formatBytes(stats.files.totalDiskBytes)}`
              : 'Scanning disk...'}
          </div>
        </div>

        <div className="p-4 space-y-1">
          <div className="text-[11px] font-semibold text-[#64748B]">Interview Slots &amp; Bookings</div>
          <div className="font-mono text-xl font-bold text-[#0F172A] tabular-nums">
            {loadingStats && !stats ? '—' : stats?.interviews.totalSlots ?? 0}
          </div>
          <div className="text-[11px] text-[#475569] font-mono tabular-nums">
            {stats
              ? `${stats.interviews.bookedSlots} booked (${stats.interviews.confirmedBookings} confirmed) · ${stats.interviews.unbookedFutureSlots} unbooked`
              : 'Loading schedule...'}
          </div>
        </div>

        <div className="p-4 space-y-1">
          <div className="text-[11px] font-semibold text-[#64748B]">2FA Locked &amp; Pending Requests</div>
          <div className="font-mono text-xl font-bold text-[#0F172A] tabular-nums">
            {loadingStats && !stats ? '—' : stats?.users.twoFaLockedUsers ?? 0}
          </div>
          <div className="text-[11px] text-[#475569] font-mono tabular-nums">
            {stats
              ? `${stats.users.rejectedOrLockedUsers} suspended · ${stats.users.pendingTwoFaRequests} pending 2FA`
              : 'Checking accounts...'}
          </div>
        </div>

        <div className="p-4 space-y-1 bg-[#FAFBFC]">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#0F766E]">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            <span>Immutable Audit Ledger</span>
          </div>
          <div className="font-mono text-xl font-bold text-[#0F172A] tabular-nums">
            {loadingStats && !stats ? '—' : stats?.auditLogs.totalEntries ?? 0}
          </div>
          <div className="text-[11px] font-medium text-[#0F766E]">
            Protected by SQLite Immutability Triggers — Cannot Be Purged
          </div>
        </div>
      </div>

      {/* Section 1: 2FA Governance & Approval Queue */}
      <div className="p-5 border-b border-[#E2E8F0] space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-bold text-[#0F172A]">
              <KeyRound className="h-4 w-4 text-[#0F766E]" />
              <span>2FA Authentication Lock &amp; Approval Queue</span>
            </div>
            <p className="text-xs text-[#64748B] mt-0.5">
              2FA settings are locked across all accounts. Non-admin direct edits are blocked (HTTP 403); only a password-verified System Administrator can approve or execute 2FA changes.
            </p>
          </div>
          <div className="text-xs font-mono tabular-nums text-[#475569]">
            {pendingTwoFaUsers.length} pending request{pendingTwoFaUsers.length === 1 ? '' : 's'}
          </div>
        </div>

        {pendingTwoFaUsers.length === 0 ? (
          <div className="rounded-md border border-[#E2E8F0] bg-[#FAFBFC] px-4 py-3 text-xs text-[#64748B] flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#0F766E] shrink-0" />
            <span>
              No pending 2FA change or reset requests in SQLite. All active staff accounts are locked under current 2FA policy.
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[#FDE68A]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#FDE68A] bg-[#FFFBEB] text-[11px] text-[#92400E]">
                <tr>
                  <th className="px-4 py-2 font-semibold whitespace-nowrap">Staff Account</th>
                  <th className="px-4 py-2 font-semibold whitespace-nowrap">Current 2FA</th>
                  <th className="px-4 py-2 font-semibold whitespace-nowrap">Requested Change</th>
                  <th className="px-4 py-2 font-semibold">Reason &amp; Submitted</th>
                  <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">Admin Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#FEF3C7] bg-white">
                {pendingTwoFaUsers.map((u) => {
                  const req = parseTwoFaRequest(u.two_fa_requested_state);
                  const reqLabel = req?.action
                    ? TWO_FA_ACTION_LABELS[req.action] || req.action
                    : '2FA Change Request';
                  return (
                    <tr key={u.id} className="align-top">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-semibold text-[#0F172A]">{u.name}</div>
                        <div className="font-mono text-[11px] text-[#475569]">{u.email}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px] text-[#334155]">
                        {u.two_fa_enabled ? `Enabled · ${u.two_fa_method}` : 'Disabled'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-semibold text-[#92400E]">
                        {reqLabel}
                      </td>
                      <td className="px-4 py-3 text-[#334155] min-w-[200px]">
                        <div>{req?.reason || 'No justification recorded.'}</div>
                        {req?.requested_at && (
                          <div className="mt-0.5 font-mono text-[10px] text-[#64748B] tabular-nums">
                            {formatShortMyt(req.requested_at)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openTwoFaReviewModal(u, 'approve', req?.action)}
                            className="inline-flex items-center gap-1 rounded bg-[#0F766E] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#115E59] cursor-pointer"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Approve</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openTwoFaReviewModal(u, 'deny', req?.action)}
                            className="inline-flex items-center gap-1 rounded border border-[#FECACA] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#DC2626] hover:bg-[#FEF2F2] cursor-pointer"
                          >
                            <XCircle className="h-3 w-3" />
                            <span>Deny</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Direct Administrator 2FA Reset / Override Control (Password Verified) */}
        <div className="pt-2 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="block text-[11px] font-semibold text-[#475569] mb-1">
              Administrator 2FA Governance Override (Target Account)
            </label>
            <select
              value={overrideUserId}
              onChange={(e) => setOverrideUserId(e.target.value)}
              className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
            >
              <option value="">Select staff account...</option>
              {staffUsers.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.name} ({u.email}) — {u.two_fa_enabled ? `2FA On (${u.two_fa_method})` : '2FA Off'}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="block text-[11px] font-semibold text-[#475569] mb-1">
              2FA Action to Execute
            </label>
            <select
              value={overrideAction}
              onChange={(e) => setOverrideAction(e.target.value as TwoFaRequestedAction)}
              className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-medium text-[#0F172A]"
            >
              {(Object.keys(TWO_FA_ACTION_LABELS) as TwoFaRequestedAction[]).map((key) => (
                <option key={key} value={key}>
                  {TWO_FA_ACTION_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={!overrideUserId}
            onClick={handleLaunchAdminTwoFaOverride}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] disabled:opacity-45 cursor-pointer whitespace-nowrap"
          >
            <KeyRound className="h-3.5 w-3.5 text-[#0F766E]" />
            <span>Verify Password &amp; Apply</span>
          </button>
        </div>
      </div>

      {/* Section 2: Guarded Critical Danger Zone Actions */}
      <div className="divide-y divide-[#E2E8F0]">
        {/* Action 1: Purge Rejected / Withdrawn Candidates */}
        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <div className="text-xs font-bold text-[#0F172A]">
              1. Purge Rejected / Withdrawn Candidate Data (PDPA Retention Cleanup)
            </div>
            <p className="text-xs text-[#475569] leading-relaxed">
              Permanently deletes candidates marked Rejected, Not Qualified, Offer Rejected, or Withdrawn and removes their physical files from <span className="font-mono text-[#0F172A]">uploads/</span>. Active pipeline records and immutable audit logs remain untouched.
            </p>
            <div className="text-[11px] font-mono tabular-nums text-[#64748B]">
              Live scope: {stats?.candidates.rejectedOrWithdrawn ?? 0} eligible candidate(s) ·{' '}
              {stats?.files.rejectedCandidateFiles ?? 0} associated file(s) · Phrase:{' '}
              <span className="text-[#991B1B] font-semibold">PURGE REJECTED CANDIDATES</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openDangerActionModal('purge_rejected')}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2 text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2] cursor-pointer whitespace-nowrap shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Purge Rejected Data</span>
          </button>
        </div>

        {/* Action 2: Revoke All Active User Sessions */}
        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <div className="text-xs font-bold text-[#0F172A]">
              2. Revoke All Active User Sessions (Force Global Logout)
            </div>
            <p className="text-xs text-[#475569] leading-relaxed">
              Increments <span className="font-mono text-[#0F172A]">token_version</span> across all staff accounts in SQLite, immediately invalidating every active JWT token so all administrators and hiring managers must sign in again.
            </p>
            <div className="text-[11px] font-mono tabular-nums text-[#64748B]">
              Live scope: {stats?.users.totalUsers ?? staffUsers.length} user account(s) · Phrase:{' '}
              <span className="text-[#991B1B] font-semibold">REVOKE ALL SESSIONS</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openDangerActionModal('revoke_sessions')}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2 text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2] cursor-pointer whitespace-nowrap shrink-0"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Revoke All Sessions</span>
          </button>
        </div>

        {/* Action 4: Reset Unbooked Interview Slots */}
        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <div className="text-xs font-bold text-[#0F172A]">
              3. Reset Unbooked Future Interview Slots
            </div>
            <p className="text-xs text-[#475569] leading-relaxed">
              Clears all unbooked future interview slots from today onward (Malaysia Time) while strictly preserving booked candidate interviews and completed schedules.
            </p>
            <div className="text-[11px] font-mono tabular-nums text-[#64748B]">
              Live scope: {stats?.interviews.unbookedFutureSlots ?? 0} unbooked future slot(s) ·{' '}
              {stats?.interviews.bookedSlots ?? 0} booked slot(s) preserved · Phrase:{' '}
              <span className="text-[#991B1B] font-semibold">RESET INTERVIEW SLOTS</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openDangerActionModal('reset_slots')}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2 text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2] cursor-pointer whitespace-nowrap shrink-0"
          >
            <CalendarX2 className="h-3.5 w-3.5" />
            <span>Reset Unbooked Slots</span>
          </button>
        </div>

        {/* Immutable Audit Logs Lock Notice (Cannot Be Purged) */}
        <div className="px-5 py-3.5 bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-[#334155]">
            <Lock className="h-4 w-4 text-[#0F766E] shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-[#0F172A]">
                Audit Trail Permanently Locked Against Deletion:
              </span>{' '}
              All{' '}
              <span className="font-mono font-semibold tabular-nums">
                {stats?.auditLogs.totalEntries ?? 0}
              </span>{' '}
              entries in <span className="font-mono">audit_logs</span> are protected by database-level triggers (
              <span className="font-mono text-[11px]">
                {stats?.auditLogs.triggers?.join(', ') ||
                  'prevent_audit_log_delete, prevent_audit_log_update'}
              </span>
              ) and cannot be cleared even from the Danger Zone.
            </div>
          </div>
          <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-[#0F766E] whitespace-nowrap">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Immutability Enforced</span>
          </span>
        </div>
      </div>

      {/* Modal 1: Administrator Password Re-Verification for 2FA Governance */}
      {twoFaModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/60 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-[#E2E8F0] bg-white shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 text-sm font-bold text-[#0F172A]">
                <KeyRound className="h-4 w-4 text-[#0F766E]" />
                <span>
                  {twoFaModal.decision === 'approve'
                    ? 'Approve & Execute 2FA Change'
                    : 'Deny 2FA Change Request'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setTwoFaModal(null)}
                className="rounded p-1 text-[#64748B] hover:bg-[#E2E8F0]/60 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmTwoFaReview} className="p-5 space-y-4">
              <div className="rounded-md border border-[#E2E8F0] bg-[#FAFBFC] p-3 text-xs space-y-1">
                <div>
                  <span className="text-[#64748B]">Account:</span>{' '}
                  <strong className="text-[#0F172A]">
                    {twoFaModal.targetUser.name} ({twoFaModal.targetUser.email})
                  </strong>
                </div>
                <div>
                  <span className="text-[#64748B]">Action:</span>{' '}
                  <strong className="text-[#0F766E]">{twoFaModal.requestSummary}</strong>
                </div>
                <div>
                  <span className="text-[#64748B]">Approver Recorded:</span>{' '}
                  <span className="font-mono text-[11px] text-[#334155]">
                    {currentUser.name} ({currentUser.email})
                  </span>
                </div>
              </div>

              {twoFaError && (
                <div className="flex items-start gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{twoFaError}</span>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Re-enter Your System Administrator Password
                </label>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={twoFaAdminPassword}
                  onChange={(e) => setTwoFaAdminPassword(e.target.value)}
                  placeholder="Enter your administrator password"
                  className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Governance Remarks (Optional — Logged in Audit Trail)
                </label>
                <input
                  type="text"
                  value={twoFaNotes}
                  onChange={(e) => setTwoFaNotes(e.target.value)}
                  placeholder="e.g. Verified identity via HR ticket"
                  className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTwoFaModal(null)}
                  className="rounded-md border border-[#CBD5E1] bg-white px-3.5 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={twoFaSubmitting}
                  className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer ${
                    twoFaModal.decision === 'approve'
                      ? 'bg-[#0F766E] hover:bg-[#115E59]'
                      : 'bg-[#DC2626] hover:bg-[#B91C1C]'
                  }`}
                >
                  {twoFaSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>
                    {twoFaModal.decision === 'approve' ? 'Confirm & Apply 2FA' : 'Confirm Denial'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Dual-Guard Danger Zone Action Confirmation (Password + Typed Phrase) */}
      {dangerModal && (
        <div
          role="alertdialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/65 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-[#FECACA] bg-white shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#FECACA] bg-[#FEF2F2] flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 text-sm font-bold text-[#991B1B]">
                <AlertTriangle className="h-4 w-4 text-[#DC2626] shrink-0" />
                <span>{dangerModal.title}</span>
              </div>
              <button
                type="button"
                onClick={() => setDangerModal(null)}
                className="rounded p-1 text-[#991B1B] hover:bg-[#FEE2E2] cursor-pointer"
                aria-label="Close confirmation modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteDangerAction} className="p-5 space-y-4">
              <p className="text-xs leading-relaxed text-[#334155]">{dangerModal.description}</p>

              {dangerError && (
                <div className="flex items-start gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{dangerError}</span>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Type exact confirmation phrase:{' '}
                  <span className="font-mono font-bold text-[#B91C1C]">{dangerModal.phrase}</span>
                </label>
                <input
                  type="text"
                  required
                  value={dangerPhraseInput}
                  onChange={(e) => setDangerPhraseInput(e.target.value)}
                  placeholder={dangerModal.phrase}
                  className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 font-mono text-xs text-[#0F172A] focus:border-[#DC2626] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Re-enter Your System Administrator Password
                </label>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={dangerPassword}
                  onChange={(e) => setDangerPassword(e.target.value)}
                  placeholder="Enter your administrator password"
                  className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#DC2626] focus:outline-none"
                />
              </div>

              <div className="text-[11px] text-[#64748B]">
                This action is permanently recorded in the immutable SQLite Audit Trail under{' '}
                <span className="font-mono text-[#334155]">{currentUser.email}</span>.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDangerModal(null)}
                  className="rounded-md border border-[#CBD5E1] bg-white px-3.5 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    dangerSubmitting ||
                    dangerPhraseInput.trim() !== dangerModal.phrase ||
                    !dangerPassword
                  }
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#DC2626] px-4 py-2 text-xs font-semibold text-white hover:bg-[#B91C1C] disabled:opacity-45 cursor-pointer"
                >
                  {dangerSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{dangerModal.confirmLabel}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
