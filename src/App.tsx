import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Database,
  Eye,
  Globe,
  LayoutDashboard,
  Loader2,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Shield,
  Users,
} from 'lucide-react';
import { AuthGate } from './components/AuthGate';
import { CandidateDetailDrawer } from './components/CandidateDetailDrawer';
import { CandidateIntakeModal } from './components/CandidateIntakeModal';
import { CandidatePortalView } from './components/CandidatePortalView';
import { CandidateTableView } from './components/CandidateTableView';
import { CommunicationsAndAuditView } from './components/CommunicationsAndAuditView';
import { DashboardView } from './components/DashboardView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InterviewSchedulerView } from './components/InterviewSchedulerView';
import {
  fetchAuditLogs,
  fetchCandidates,
  fetchCurrentUser,
  fetchEmailLogs,
  fetchInterviewSlots,
  fetchStaffUsers,
  getStoredToken,
  logCsvExport,
  logoutStaff,
  sendBatchDocReminders,
} from './lib/apiService';
import { exportCandidatesToExcelCsv } from './lib/atsHelpers';
import {
  AuditLogRecord,
  CandidateFilters,
  CandidateRecord,
  CandidateStatus,
  EmailLogRecord,
  InterviewSlot,
  ROLE_META,
  StaffUser,
} from './types/ats';

type NavTab = 'dashboard' | 'candidates' | 'interviews' | 'portal' | 'emails' | 'team' | 'audit';

const EMPTY_FILTERS: CandidateFilters = {
  search: '',
  dateFrom: '',
  dateTo: '',
  position: '',
  department: '',
  source: '',
  stage: '',
  status: '',
  interviewDate: '',
  offerStatus: '',
};

function getPublicPortalTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const token = new URLSearchParams(window.location.search).get('portal');
  return token && token.trim().length > 0 ? token.trim() : null;
}

export default function App() {
  const publicPortalToken = useMemo(() => getPublicPortalTokenFromUrl(), []);

  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [authChecking, setAuthChecking] = useState(!publicPortalToken);

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [slots, setSlots] = useState<InterviewSlot[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLogRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);

  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [sendingBatchReminders, setSendingBatchReminders] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  const [filters, setFilters] = useState<CandidateFilters>(EMPTY_FILTERS);
  const [showIntakeModal, setShowIntakeModal] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [portalPreviewCandidateId, setPortalPreviewCandidateId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const isAdmin = staffUser?.role === 'administrator';

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => {
      setToast((prev) => (prev === message ? null : prev));
    }, 4500);
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!staffUser) return;
    setLoadingWorkspace(true);
    try {
      const [cands, fetchedSlots, emails, audits, users] = await Promise.all([
        fetchCandidates(),
        fetchInterviewSlots(),
        fetchEmailLogs(),
        fetchAuditLogs(),
        staffUser.role === 'administrator' ? fetchStaffUsers() : Promise.resolve([]),
      ]);
      setCandidates(cands);
      setSlots(fetchedSlots);
      setEmailLogs(emails);
      setAuditLogs(audits);
      setStaffUsers(users);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load workspace data.';
      if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('unauthorized')) {
        setStaffUser(null);
      } else {
        notify(msg);
      }
    } finally {
      setLoadingWorkspace(false);
    }
  }, [staffUser, notify]);

  useEffect(() => {
    if (publicPortalToken) return;
    let active = true;
    const token = getStoredToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    fetchCurrentUser()
      .then((user) => {
        if (active) setStaffUser(user);
      })
      .catch(() => {
        if (active) setStaffUser(null);
      })
      .finally(() => {
        if (active) setAuthChecking(false);
      });
    return () => {
      active = false;
    };
  }, [publicPortalToken]);

  useEffect(() => {
    if (staffUser && !publicPortalToken) {
      if (staffUser.role !== 'administrator' && activeTab === 'team') {
        setActiveTab('dashboard');
      }
      void refreshWorkspace();
    }
  }, [staffUser, publicPortalToken, refreshWorkspace, activeTab]);

  // Public self-service candidate portal (no HR login required)
  if (publicPortalToken) {
    return (
      <ErrorBoundary>
        <CandidatePortalView publicToken={publicPortalToken} />
      </ErrorBoundary>
    );
  }

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] text-xs text-[#64748B] gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-[#0F766E]" />
        Verifying session...
      </div>
    );
  }

  if (!staffUser) {
    return (
      <ErrorBoundary>
        <AuthGate onAuthenticated={(user) => setStaffUser(user)} />
      </ErrorBoundary>
    );
  }

  const selectedCandidate =
    selectedCandidateId !== null
      ? candidates.find((c) => c.id === selectedCandidateId) || null
      : null;

  const handleLogout = () => {
    logoutStaff();
    setStaffUser(null);
    setCandidates([]);
    setSlots([]);
    setEmailLogs([]);
    setAuditLogs([]);
    setStaffUsers([]);
    setSelectedCandidateId(null);
    setActiveTab('dashboard');
  };

  const handleBatchDocReminders = async (targets: CandidateRecord[]) => {
    if (!isAdmin || targets.length === 0) return;
    setSendingBatchReminders(true);
    try {
      const count = await sendBatchDocReminders(targets.map((c) => c.id));
      await refreshWorkspace();
      notify(`Dispatched ${count} document submission reminder email(s).`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to send batch reminders.');
    } finally {
      setSendingBatchReminders(false);
    }
  };

  const handleExportCsv = async (filtered: CandidateRecord[]) => {
    setExportingCsv(true);
    try {
      exportCandidatesToExcelCsv(filtered, staffUser.role);
      await logCsvExport(filtered.length);
      await refreshWorkspace();
      notify(`Exported ${filtered.length} candidate record(s) to Excel CSV.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'CSV export failed.');
    } finally {
      setExportingCsv(false);
    }
  };

  const handleNavigateToDatabase = (preset?: { stage?: number; status?: string }) => {
    setFilters({
      ...EMPTY_FILTERS,
      stage: preset?.stage ?? '',
      status: (preset?.status as CandidateStatus) || '',
    });
    setActiveTab('candidates');
  };

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'dashboard', label: 'Pipeline Dashboard', icon: LayoutDashboard },
    { id: 'candidates', label: 'Candidate Database', icon: Database },
    { id: 'interviews', label: 'Interview Calendar', icon: Calendar },
    { id: 'portal', label: 'Candidate Portal', icon: Globe },
    { id: 'emails', label: 'Email Automation', icon: Mail },
    ...(isAdmin ? [{ id: 'team' as NavTab, label: 'Team & Access', icon: Users }] : []),
    { id: 'audit', label: 'Audit Trail', icon: Shield },
  ];

  const roleMeta = ROLE_META[staffUser.role];

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col lg:flex-row">
        {/* Left Sidebar */}
        <aside className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-[#E2E8F0] bg-white flex flex-col">
          <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#0F766E] text-white font-bold text-xs tracking-wide">
                TF
              </div>
              <div>
                <div className="text-sm font-bold text-[#0F172A] leading-tight">TalentFlow MY</div>
                <div className="text-[11px] text-[#64748B]">Enterprise ATS · SQLite</div>
              </div>
            </div>
          </div>

          {isAdmin && (
            <div className="p-3">
              <button
                type="button"
                onClick={() => setShowIntakeModal(true)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-[#0F766E] px-3 py-2 text-xs font-semibold text-white hover:bg-[#115E59] transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                New Candidate Intake
              </button>
            </div>
          )}

          <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-x-auto lg:overflow-visible flex lg:flex-col gap-1 lg:gap-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-[#F0FDFA] text-[#0F766E]'
                      : 'text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-[#0F766E]' : 'text-[#64748B]'}`} />
                  <span>{item.label}</span>
                  {item.id === 'candidates' && candidates.length > 0 && (
                    <span className="ml-auto font-mono text-[11px] text-[#64748B] tabular-nums">
                      {candidates.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Staff Profile Footer */}
          <div className="border-t border-[#E2E8F0] p-4 space-y-2.5 bg-[#FAFBFC]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#0F172A] truncate">{staffUser.name}</div>
                <div className="text-[11px] text-[#64748B] truncate font-mono">{staffUser.email}</div>
                <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-[#0F766E]">
                  {isAdmin ? <Shield className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {roleMeta.badgeLabel}
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                title="Sign out"
                className="rounded p-1.5 text-[#64748B] hover:bg-[#E2E8F0]/60 hover:text-[#DC2626] cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* Main Workspace */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top Utility Bar with Explicit Role Badge */}
          <header className="h-14 border-b border-[#E2E8F0] bg-white px-6 flex items-center justify-between gap-4">
            <div className="text-xs text-[#64748B] truncate">
              <span className="font-semibold text-[#0F172A]">
                {navItems.find((n) => n.id === activeTab)?.label}
              </span>
              <span className="mx-2 text-[#CBD5E1]">/</span>
              <span>Malaysian 15-Stage Recruitment Operations</span>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span
                className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] font-mono font-semibold whitespace-nowrap ${
                  isAdmin
                    ? 'border-[#0F766E]/30 bg-[#F0FDFA] text-[#0F766E]'
                    : 'border-[#CBD5E1] bg-[#F8FAFC] text-[#334155]'
                }`}
              >
                {isAdmin ? <Shield className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {roleMeta.badgeLabel}
              </span>

              <button
                type="button"
                onClick={() => void refreshWorkspace()}
                disabled={loadingWorkspace}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingWorkspace ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </header>

          {/* View Body */}
          <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">
            {activeTab === 'dashboard' && (
              <DashboardView
                candidates={candidates}
                slots={slots}
                role={staffUser.role}
                onOpenIntake={() => setShowIntakeModal(true)}
                onSelectCandidate={(c) => setSelectedCandidateId(c.id)}
                onNavigateToDatabase={handleNavigateToDatabase}
                onSendBatchDocReminders={handleBatchDocReminders}
                sendingBatchReminders={sendingBatchReminders}
              />
            )}

            {activeTab === 'candidates' && (
              <CandidateTableView
                candidates={candidates}
                filters={filters}
                onChangeFilters={setFilters}
                onResetFilters={() => setFilters(EMPTY_FILTERS)}
                onSelectCandidate={(c) => setSelectedCandidateId(c.id)}
                onExportCsv={handleExportCsv}
                exportingCsv={exportingCsv}
                role={staffUser.role}
              />
            )}

            {activeTab === 'interviews' && (
              <InterviewSchedulerView
                slots={slots}
                candidates={candidates}
                staffUser={staffUser}
                onRefresh={refreshWorkspace}
                onSelectCandidate={(c) => setSelectedCandidateId(c.id)}
                onNotify={notify}
              />
            )}

            {activeTab === 'portal' && (
              <CandidatePortalView
                candidates={candidates}
                initialCandidateId={portalPreviewCandidateId}
                readOnly={!isAdmin}
                onRefreshWorkspace={refreshWorkspace}
                onNotify={notify}
              />
            )}

            {activeTab === 'emails' && (
              <CommunicationsAndAuditView
                mode="emails"
                emailLogs={emailLogs}
                auditLogs={auditLogs}
                staffUsers={staffUsers}
                candidates={candidates}
                currentUser={staffUser}
                onRefresh={refreshWorkspace}
                onNotify={notify}
              />
            )}

            {activeTab === 'team' && isAdmin && (
              <CommunicationsAndAuditView
                mode="team"
                emailLogs={emailLogs}
                auditLogs={auditLogs}
                staffUsers={staffUsers}
                candidates={candidates}
                currentUser={staffUser}
                onRefresh={refreshWorkspace}
                onNotify={notify}
              />
            )}

            {activeTab === 'audit' && (
              <CommunicationsAndAuditView
                mode="audit"
                emailLogs={emailLogs}
                auditLogs={auditLogs}
                staffUsers={staffUsers}
                candidates={candidates}
                currentUser={staffUser}
                onRefresh={refreshWorkspace}
                onNotify={notify}
              />
            )}
          </main>
        </div>

        {/* Modals & Drawers */}
        {isAdmin && showIntakeModal && (
          <CandidateIntakeModal
            existingCandidates={candidates}
            onClose={() => setShowIntakeModal(false)}
            onRegistered={async (cand) => {
              setShowIntakeModal(false);
              await refreshWorkspace();
              setSelectedCandidateId(cand.id);
              notify(`Registered ${cand.full_name} (${cand.candidate_code}) in SQLite.`);
            }}
          />
        )}

        {selectedCandidate && (
          <CandidateDetailDrawer
            candidate={selectedCandidate}
            slots={slots}
            staffUser={staffUser}
            onClose={() => setSelectedCandidateId(null)}
            onUpdated={async () => {
              await refreshWorkspace();
            }}
            onNotify={notify}
            onOpenPortalPreview={(cand) => {
              setSelectedCandidateId(null);
              setPortalPreviewCandidateId(cand.id);
              setActiveTab('portal');
            }}
          />
        )}

        {/* Toast Notification */}
        {toast && (
          <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-md border border-[#0F766E]/30 bg-[#0F172A] px-4 py-2.5 text-xs font-medium text-white shadow-lg">
            <CheckCircle2 className="h-4 w-4 text-[#2DD4BF] shrink-0" />
            <span>{toast}</span>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
