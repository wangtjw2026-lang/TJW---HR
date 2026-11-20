import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  Eye,
  Globe,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Shield,
  Users,
  X,
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
  keepSessionAlive,
  logCsvExport,
  logPageVisit,
  logoutStaffSession,
  registerSessionExpiredHandler,
  requestMyTwoFaChange,
  sendBatchDocReminders,
  setCurrentAuditPage,
  setStoredToken,
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
  TwoFaRequestedAction,
} from './types/ats';

type NavTab = 'dashboard' | 'candidates' | 'interviews' | 'portal' | 'emails' | 'team' | 'audit';

const TAB_PAGE_NAMES: Record<NavTab, string> = {
  dashboard: 'Pipeline Dashboard',
  candidates: 'Candidate Database',
  interviews: 'Interview Calendar',
  portal: 'Candidate Self-Service Portal',
  emails: 'Email Automation & Audit Trail',
  team: 'Team & Access Management',
  audit: 'Email Automation & Audit Trail',
};

const IDLE_WARNING_MS = 9 * 60 * 1000; // 9 minutes -> show 60s countdown warning
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes -> automatic PDPA logout
const ACTIVITY_SYNC_INTERVAL_MS = 4 * 60 * 1000; // Sync server last_active_at every 4 min while user is actively interacting

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

function formatApprovalDateShort(ts?: string): string {
  const raw = String(ts || '').trim();
  if (!raw) return '—';
  const parenIdx = raw.indexOf(' (');
  return parenIdx > 0 ? raw.slice(0, parenIdx) : raw;
}

export default function App() {
  const publicPortalToken = useMemo(() => getPublicPortalTokenFromUrl(), []);

  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [authChecking, setAuthChecking] = useState(!publicPortalToken);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // User Profile 2FA Change Request state (for non-admin & staff users under 2FA Lock)
  const [showTwoFaRequestForm, setShowTwoFaRequestForm] = useState(false);
  const [twoFaReqAction, setTwoFaReqAction] = useState<TwoFaRequestedAction>('RESET_2FA');
  const [twoFaReqReason, setTwoFaReqReason] = useState('');
  const [submittingTwoFaReq, setSubmittingTwoFaReq] = useState(false);
  const [twoFaReqFeedback, setTwoFaReqFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // 10-minute PDPA inactivity auto-logout state
  const [idleWarningSecondsLeft, setIdleWarningSecondsLeft] = useState<number | null>(null);
  const [keepingAlive, setKeepingAlive] = useState(false);

  const lastTabVisitKeyRef = useRef<string>('');
  const lastModalVisitKeyRef = useRef<string>('');
  const lastDrawerVisitKeyRef = useRef<string>('');
  const lastActivityAtRef = useRef<number>(Date.now());
  const lastServerKeepAliveRef = useRef<number>(Date.now());
  const idleWarningOpenRef = useRef<boolean>(false);
  const idleLogoutInFlightRef = useRef<boolean>(false);
  const activeTabRef = useRef<NavTab>('dashboard');
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  const isAdmin = staffUser?.role === 'administrator';
  const pendingApprovalCount = useMemo(
    () =>
      isAdmin
        ? staffUsers.filter(
            (u) => u.status === 'pending' || u.two_fa_change_status === 'pending_admin_approval'
          ).length
        : 0,
    [isAdmin, staffUsers]
  );

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => {
      setToast((prev) => (prev === message ? null : prev));
    }, 4500);
  }, []);

  const clearWorkspaceState = useCallback(() => {
    setStaffUser(null);
    setCandidates([]);
    setSlots([]);
    setEmailLogs([]);
    setAuditLogs([]);
    setStaffUsers([]);
    setSelectedCandidateId(null);
    setShowIntakeModal(false);
    setProfileMenuOpen(false);
    setIdleWarningSecondsLeft(null);
    idleWarningOpenRef.current = false;
    setActiveTab('dashboard');
  }, []);

  const performLogout = useCallback(
    async (reason: 'manual' | 'idle_timeout', notice?: string) => {
      const pageVisited = TAB_PAGE_NAMES[activeTabRef.current] || 'Pipeline Dashboard';
      await logoutStaffSession({ reason, page_visited: pageVisited });
      clearWorkspaceState();
      if (notice) {
        setSessionNotice(notice);
      }
    },
    [clearWorkspaceState]
  );

  const handleForceGlobalLogout = useCallback(
    (notice: string) => {
      setStoredToken(null);
      clearWorkspaceState();
      setSessionNotice(notice);
    },
    [clearWorkspaceState]
  );

  // Sync active page name for backend audit headers
  useEffect(() => {
    activeTabRef.current = activeTab;
    setCurrentAuditPage(TAB_PAGE_NAMES[activeTab]);
  }, [activeTab]);

  // Global listener for backend 401 / IDLE_TIMEOUT enforcement
  useEffect(() => {
    if (publicPortalToken) return;
    registerSessionExpiredHandler(({ code, message }) => {
      if (idleLogoutInFlightRef.current) return;
      const isIdle = code === 'IDLE_TIMEOUT' || /10 minutes of inactivity/i.test(message);
      clearWorkspaceState();
      if (isIdle) {
        setSessionNotice('Session expired after 10 minutes of inactivity.');
      } else if (message) {
        setSessionNotice(message);
      }
    });
    return () => {
      registerSessionExpiredHandler(null);
    };
  }, [publicPortalToken, clearWorkspaceState]);

  // Close user profile popover on outside click or Escape
  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [profileMenuOpen]);

  // Frontend 10-minute inactivity tracker (9-min warning + 10-min auto-logout + active keep-alive sync)
  useEffect(() => {
    if (!staffUser || publicPortalToken) {
      idleWarningOpenRef.current = false;
      idleLogoutInFlightRef.current = false;
      setIdleWarningSecondsLeft(null);
      return;
    }

    const now = Date.now();
    lastActivityAtRef.current = now;
    lastServerKeepAliveRef.current = now;
    idleWarningOpenRef.current = false;
    idleLogoutInFlightRef.current = false;
    setIdleWarningSecondsLeft(null);

    const recordLocalActivity = () => {
      // Once the 9-minute PDPA warning is visible, user must click "Stay Signed In" explicitly
      if (idleWarningOpenRef.current) return;
      lastActivityAtRef.current = Date.now();
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ];

    for (const evt of activityEvents) {
      window.addEventListener(evt, recordLocalActivity, { passive: true });
    }

    const intervalId = window.setInterval(() => {
      const currentNow = Date.now();
      const idleMs = currentNow - lastActivityAtRef.current;

      if (idleMs >= IDLE_TIMEOUT_MS) {
        if (!idleLogoutInFlightRef.current) {
          idleLogoutInFlightRef.current = true;
          void performLogout(
            'idle_timeout',
            'Session expired after 10 minutes of inactivity.'
          ).finally(() => {
            idleLogoutInFlightRef.current = false;
          });
        }
        return;
      }

      if (idleMs >= IDLE_WARNING_MS) {
        idleWarningOpenRef.current = true;
        const remainingSec = Math.max(1, Math.ceil((IDLE_TIMEOUT_MS - idleMs) / 1000));
        setIdleWarningSecondsLeft(remainingSec);
        return;
      }

      // While genuinely active (not idle), periodically refresh server-side last_active_at
      if (
        currentNow - lastServerKeepAliveRef.current >= ACTIVITY_SYNC_INTERVAL_MS &&
        lastActivityAtRef.current > lastServerKeepAliveRef.current
      ) {
        lastServerKeepAliveRef.current = currentNow;
        void keepSessionAlive().catch(() => {
          // 401 handled globally by registerSessionExpiredHandler
        });
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
      for (const evt of activityEvents) {
        window.removeEventListener(evt, recordLocalActivity);
      }
    };
  }, [staffUser, publicPortalToken, performLogout]);

  const handleStaySignedIn = async () => {
    setKeepingAlive(true);
    try {
      await keepSessionAlive();
      const now = Date.now();
      lastActivityAtRef.current = now;
      lastServerKeepAliveRef.current = now;
      idleWarningOpenRef.current = false;
      setIdleWarningSecondsLeft(null);
      notify('Session extended. Inactivity timer reset to 10 minutes.');
    } catch {
      // If server already expired the session, global 401 handler will redirect to Login Gate
    } finally {
      setKeepingAlive(false);
    }
  };

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
      if (users.length > 0) {
        const refreshedSelf = users.find((u) => u.id === staffUser.id);
        if (refreshedSelf) {
          setStaffUser((prev) =>
            prev
              ? {
                  ...prev,
                  two_fa_enabled: refreshedSelf.two_fa_enabled,
                  two_fa_method: refreshedSelf.two_fa_method,
                  two_fa_change_status: refreshedSelf.two_fa_change_status,
                  two_fa_requested_state: refreshedSelf.two_fa_requested_state,
                  two_fa_approved_by: refreshedSelf.two_fa_approved_by,
                }
              : prev
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load workspace data.';
      if (msg.toLowerCase().includes('inactivity')) {
        clearWorkspaceState();
        setSessionNotice('Session expired after 10 minutes of inactivity.');
      } else if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('unauthorized')) {
        clearWorkspaceState();
      } else {
        notify(msg);
      }
    } finally {
      setLoadingWorkspace(false);
    }
  }, [staffUser, notify, clearWorkspaceState]);

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

  // Automatic page-view audit logging when authenticated staff navigates views
  useEffect(() => {
    if (!staffUser || publicPortalToken) {
      lastTabVisitKeyRef.current = '';
      return;
    }
    if (staffUser.role !== 'administrator' && activeTab === 'team') return;

    const visitKey = `${staffUser.id}:${activeTab}`;
    if (lastTabVisitKeyRef.current === visitKey) return;
    lastTabVisitKeyRef.current = visitKey;

    const pageVisited = TAB_PAGE_NAMES[activeTab];
    const subView =
      activeTab === 'emails'
        ? 'Email Automation Log'
        : activeTab === 'audit'
          ? 'User Activity Audit Trail'
          : pageVisited;

    void logPageVisit({
      page_visited: pageVisited,
      target_entity: subView,
      details: `Navigated to ${subView}.`,
    });
  }, [staffUser, publicPortalToken, activeTab]);

  // Automatic audit logging when Candidate Intake Modal is opened
  useEffect(() => {
    if (!staffUser || !showIntakeModal) {
      lastModalVisitKeyRef.current = '';
      return;
    }
    const key = `${staffUser.id}:intake-open`;
    if (lastModalVisitKeyRef.current === key) return;
    lastModalVisitKeyRef.current = key;

    void logPageVisit({
      page_visited: 'Candidate Intake Modal',
      target_entity: 'New Candidate Intake',
      details: 'Opened Candidate Intake Modal for resume screening and registration.',
    });
  }, [staffUser, showIntakeModal]);

  // Automatic audit logging when a Candidate Detail Drawer is opened
  useEffect(() => {
    if (!staffUser || selectedCandidateId === null) {
      lastDrawerVisitKeyRef.current = '';
      return;
    }
    const cand = candidates.find((c) => c.id === selectedCandidateId);
    if (!cand) return;

    const key = `${staffUser.id}:candidate:${cand.id}`;
    if (lastDrawerVisitKeyRef.current === key) return;
    lastDrawerVisitKeyRef.current = key;

    void logPageVisit({
      page_visited: 'Candidate Detail Drawer',
      target_entity: `${cand.full_name} (${cand.candidate_code})`,
      details: `Viewed candidate profile for ${cand.full_name} (${cand.candidate_code}, Stage ${cand.stage}).`,
    });
  }, [staffUser, selectedCandidateId, candidates]);

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
        <AuthGate
          sessionNotice={sessionNotice}
          onDismissNotice={() => setSessionNotice(null)}
          onAuthenticated={(user) => {
            setSessionNotice(null);
            setStaffUser(user);
          }}
        />
      </ErrorBoundary>
    );
  }

  const selectedCandidate =
    selectedCandidateId !== null
      ? candidates.find((c) => c.id === selectedCandidateId) || null
      : null;

  const handleLogout = () => {
    void performLogout('manual');
  };

  const handleSubmitTwoFaRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setTwoFaReqFeedback(null);
    if (twoFaReqReason.trim().length < 5) {
      setTwoFaReqFeedback({
        ok: false,
        text: 'Please provide at least 5 characters explaining why you need a 2FA change.',
      });
      return;
    }
    setSubmittingTwoFaReq(true);
    try {
      const res = await requestMyTwoFaChange({
        requested_action: twoFaReqAction,
        reason: twoFaReqReason.trim(),
      });
      setStaffUser(res.user);
      setTwoFaReqReason('');
      setShowTwoFaRequestForm(false);
      setTwoFaReqFeedback({ ok: true, text: res.message });
      notify('Submitted 2FA change request for System Administrator approval.');
      await refreshWorkspace();
    } catch (err) {
      setTwoFaReqFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to submit 2FA change request.',
      });
    } finally {
      setSubmittingTwoFaReq(false);
    }
  };

  const handleBatchDocReminders = async (targets: CandidateRecord[]) => {
    if (!isAdmin || targets.length === 0) return;
    setSendingBatchReminders(true);
    try {
      const result = await sendBatchDocReminders(targets.map((c) => c.id));
      await refreshWorkspace();
      if (result.failedCount > 0) {
        notify(
          `Batch reminders: ${result.deliveredCount} sent via SMTP, ${result.failedCount} failed.${
            result.lastError ? ` ${result.lastError}` : ''
          }`
        );
      } else {
        notify(`Dispatched ${result.deliveredCount} document reminder email(s) via SMTP.`);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to send batch reminders.');
    } finally {
      setSendingBatchReminders(false);
    }
  };

  const handleExportCsv = async (filtered: CandidateRecord[]) => {
    if (!isAdmin) {
      notify('Excel report exports require System Administrator privileges.');
      return;
    }
    setExportingCsv(true);
    try {
      exportCandidatesToExcelCsv(filtered, staffUser.role);
      const activeFilters = [
        filters.search ? `search="${filters.search}"` : '',
        filters.department ? `dept=${filters.department}` : '',
        filters.position ? `position=${filters.position}` : '',
        filters.source ? `source=${filters.source}` : '',
        filters.stage ? `stage=${filters.stage}` : '',
        filters.status ? `status=${filters.status}` : '',
        filters.offerStatus ? `offer=${filters.offerStatus}` : '',
        filters.dateFrom ? `from=${filters.dateFrom}` : '',
        filters.dateTo ? `to=${filters.dateTo}` : '',
      ].filter(Boolean);
      await logCsvExport(filtered.length, activeFilters.join(', '));
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
                  {item.id === 'team' && pendingApprovalCount > 0 && (
                    <span
                      title={`${pendingApprovalCount} pending staff access request(s)`}
                      className="ml-auto font-mono text-[11px] font-bold text-[#B45309] tabular-nums"
                    >
                      {pendingApprovalCount} pending
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Staff Profile Footer */}
          <div className="border-t border-[#E2E8F0] p-4 space-y-2.5 bg-[#FAFBFC]">
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => setProfileMenuOpen(true)}
                className="min-w-0 text-left group cursor-pointer"
                title="View Role Definition & Access Permissions"
              >
                <div className="text-xs font-bold text-[#0F172A] truncate group-hover:text-[#0F766E] transition-colors">
                  {staffUser.name}
                </div>
                <div className="text-[11px] text-[#64748B] truncate font-mono">{staffUser.email}</div>
                <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-[#0F766E]">
                  {isAdmin ? <Shield className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  <span>{roleMeta.badgeLabel}</span>
                </div>
              </button>
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
          {/* Top Utility Bar with Interactive Role Permissions Profile Menu */}
          <header className="h-14 border-b border-[#E2E8F0] bg-white px-6 flex items-center justify-between gap-4 relative">
            <div className="text-xs text-[#64748B] truncate">
              <span className="font-semibold text-[#0F172A]">
                {navItems.find((n) => n.id === activeTab)?.label}
              </span>
              <span className="mx-2 text-[#CBD5E1]">/</span>
              <span>Malaysian 15-Stage Recruitment Operations</span>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {/* Interactive User Profile & Role Permissions Menu */}
              <div className="relative" ref={profileMenuRef}>
                <button
                  type="button"
                  onClick={() => setProfileMenuOpen((prev) => !prev)}
                  aria-expanded={profileMenuOpen}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    isAdmin
                      ? 'border-[#0F766E]/30 bg-[#F0FDFA] text-[#0F766E] hover:bg-[#CCFBF1]/60'
                      : 'border-[#CBD5E1] bg-[#F8FAFC] text-[#334155] hover:bg-[#F1F5F9]'
                  }`}
                >
                  {isAdmin ? <Shield className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  <span>{roleMeta.badgeLabel}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {profileMenuOpen && (
                  <div className="absolute right-0 mt-2 w-[360px] max-w-[calc(100vw-2rem)] rounded-lg border border-[#E2E8F0] bg-white shadow-lg z-40 overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#0F172A] truncate">{staffUser.name}</div>
                        <div className="text-[11px] font-mono text-[#475569] truncate">
                          {staffUser.email}
                        </div>
                        <div className="text-[11px] text-[#64748B] mt-0.5">
                          {staffUser.department}
                          {staffUser.approved_by && (
                            <>
                              {' '}
                              · Approved by{' '}
                              <span className="text-[#334155] font-medium">
                                {staffUser.approved_by}
                              </span>
                            </>
                          )}
                        </div>
                        {staffUser.approved_at && (
                          <div className="text-[10px] font-mono text-[#64748B] mt-0.5 tabular-nums">
                            Approved: {formatApprovalDateShort(staffUser.approved_at)}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setProfileMenuOpen(false)}
                        className="rounded p-1 text-[#64748B] hover:bg-[#E2E8F0]/60 cursor-pointer"
                        aria-label="Close profile menu"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Role Definition & Access Permissions Reference Card */}
                    <div className="p-4 space-y-3 max-h-[65vh] overflow-y-auto">
                      <div>
                        <div className="text-[11px] font-bold text-[#0F172A]">
                          Role Definition &amp; Access Permissions
                        </div>
                        <div className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F766E]">
                          {isAdmin ? <Shield className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          <span>{roleMeta.title}</span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold text-[#15803D]">
                          Permitted Actions
                        </div>
                        <ul className="space-y-1 text-[11px] text-[#334155] leading-snug">
                          {roleMeta.allowed.map((item) => (
                            <li key={item} className="flex items-start gap-1.5">
                              <Check className="h-3 w-3 text-[#15803D] shrink-0 mt-0.5" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="space-y-1 pt-2 border-t border-[#F1F5F9]">
                        <div className="text-[11px] font-semibold text-[#B91C1C]">
                          Access Restrictions
                        </div>
                        <ul className="space-y-1 text-[11px] text-[#475569] leading-snug">
                          {roleMeta.restricted.map((item) => (
                            <li key={item} className="flex items-start gap-1.5">
                              <Lock className="h-3 w-3 text-[#B91C1C] shrink-0 mt-0.5" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* 2FA Authentication Lock Status & Formal Change Request */}
                      <div className="pt-2.5 border-t border-[#E2E8F0] space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#0F172A]">
                            <KeyRound className="h-3.5 w-3.5 text-[#0F766E]" />
                            <span>2FA Authentication Lock</span>
                          </div>
                          <span className="font-mono text-[10px] font-semibold text-[#0F766E]">
                            {staffUser.two_fa_enabled
                              ? `Enabled · ${staffUser.two_fa_method || 'EMAIL_OTP'}`
                              : 'Disabled'}
                          </span>
                        </div>

                        <div className="text-[11px] text-[#475569] leading-snug">
                          {staffUser.two_fa_change_status === 'pending_admin_approval' ? (
                            <span className="font-semibold text-[#B45309]">
                              Pending System Administrator approval. Current 2FA lock remains enforced.
                            </span>
                          ) : (
                            <span>
                              Locked by security policy — cannot be disabled or modified without System Administrator approval.
                            </span>
                          )}
                        </div>

                        {staffUser.two_fa_approved_by && (
                          <div className="text-[10px] text-[#64748B]">
                            Last 2FA approval: <span className="font-medium text-[#334155]">{staffUser.two_fa_approved_by}</span>
                          </div>
                        )}

                        {twoFaReqFeedback && (
                          <div
                            className={`rounded border px-2.5 py-1.5 text-[11px] ${
                              twoFaReqFeedback.ok
                                ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]'
                                : 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]'
                            }`}
                          >
                            {twoFaReqFeedback.text}
                          </div>
                        )}

                        {!showTwoFaRequestForm ? (
                          <button
                            type="button"
                            onClick={() => {
                              setTwoFaReqFeedback(null);
                              setShowTwoFaRequestForm(true);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F766E] hover:underline cursor-pointer"
                          >
                            <Lock className="h-3 w-3" />
                            <span>
                              {staffUser.two_fa_change_status === 'pending_admin_approval'
                                ? 'Update Pending 2FA Change Request'
                                : 'Request 2FA Change / Reset'}
                            </span>
                          </button>
                        ) : (
                          <form onSubmit={handleSubmitTwoFaRequest} className="space-y-2 pt-1">
                            <select
                              value={twoFaReqAction}
                              onChange={(e) => setTwoFaReqAction(e.target.value as TwoFaRequestedAction)}
                              className="w-full rounded border border-[#CBD5E1] bg-white px-2 py-1.5 text-[11px] text-[#0F172A]"
                            >
                              <option value="RESET_2FA">Reset 2FA Enrollment (Email OTP)</option>
                              <option value="SWITCH_TO_AUTHENTICATOR_APP">Switch to Authenticator App</option>
                              <option value="SWITCH_TO_EMAIL_OTP">Switch to Email OTP</option>
                              <option value="DISABLE_2FA">Request Temporary 2FA Disable</option>
                              <option value="ENABLE_2FA">Enable 2FA Protection</option>
                            </select>
                            <textarea
                              rows={2}
                              required
                              minLength={5}
                              value={twoFaReqReason}
                              onChange={(e) => setTwoFaReqReason(e.target.value)}
                              placeholder="Reason for 2FA change (reviewed by System Administrator)..."
                              className="w-full rounded border border-[#CBD5E1] bg-white px-2 py-1.5 text-[11px] text-[#0F172A]"
                            />
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setShowTwoFaRequestForm(false)}
                                className="rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] text-[#475569] cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                disabled={submittingTwoFaReq}
                                className="inline-flex items-center gap-1 rounded bg-[#0F766E] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#115E59] disabled:opacity-50 cursor-pointer"
                              >
                                {submittingTwoFaReq && <Loader2 className="h-3 w-3 animate-spin" />}
                                <span>Submit to Admin</span>
                              </button>
                            </div>
                          </form>
                        )}
                      </div>

                      <div className="pt-2 border-t border-[#F1F5F9] flex items-center gap-1.5 text-[11px] text-[#64748B]">
                        <Clock className="h-3.5 w-3.5 text-[#0F766E] shrink-0" />
                        <span>PDPA session lock: auto-logout after 10 minutes of inactivity.</span>
                      </div>
                    </div>

                    <div className="px-4 py-2.5 border-t border-[#E2E8F0] bg-[#FAFBFC] flex items-center justify-between gap-2">
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            setActiveTab('team');
                          }}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F766E] hover:underline cursor-pointer"
                        >
                          <Users className="h-3.5 w-3.5" />
                          <span>Manage Team &amp; Approvals</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-[#64748B]">View &amp; Review Only</span>
                      )}

                      <button
                        type="button"
                        onClick={handleLogout}
                        className="inline-flex items-center gap-1.5 rounded border border-[#FECACA] bg-white px-2.5 py-1 text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] cursor-pointer"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => void refreshWorkspace()}
                disabled={loadingWorkspace}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-50 cursor-pointer whitespace-nowrap"
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
                onNotify={notify}
                onWhatsAppLogged={() => void refreshWorkspace()}
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
                onForceGlobalLogout={handleForceGlobalLogout}
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

        {/* 9-Minute PDPA Inactivity Auto-Logout Countdown Warning Modal */}
        {idleWarningSecondsLeft !== null && (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="idle-warning-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/60 p-4"
          >
            <div className="w-full max-w-md rounded-lg border border-[#FDE68A] bg-white shadow-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#FEF3C7] bg-[#FFFBEB] flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="h-5 w-5 text-[#D97706] shrink-0" />
                  <h2 id="idle-warning-title" className="text-sm font-bold text-[#92400E]">
                    Inactivity Timeout Warning
                  </h2>
                </div>
                <span className="font-mono text-sm font-bold text-[#B91C1C] tabular-nums">
                  {idleWarningSecondsLeft}s
                </span>
              </div>

              <div className="p-5 space-y-4">
                <p className="text-xs leading-relaxed text-[#334155]">
                  You have been idle for 9 minutes. You will be automatically logged out in{' '}
                  <strong className="font-mono text-[#B91C1C] tabular-nums">
                    {idleWarningSecondsLeft} second{idleWarningSecondsLeft === 1 ? '' : 's'}
                  </strong>{' '}
                  for PDPA data security unless you click <strong>Stay Signed In</strong>.
                </p>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3.5 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC] cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Sign Out Now</span>
                  </button>
                  <button
                    type="button"
                    disabled={keepingAlive}
                    onClick={() => void handleStaySignedIn()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-60 cursor-pointer"
                  >
                    {keepingAlive ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Shield className="h-3.5 w-3.5" />
                    )}
                    <span>{keepingAlive ? 'Extending Session...' : 'Stay Signed In'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
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
