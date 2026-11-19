import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import {
  Calendar,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  CandidateFilters,
  CandidatePrivateCompensation,
  CandidatePrivatePii,
  CandidateRecord,
  EmailLogRecord,
  InterviewSlot,
  PdpaAuditLogRecord,
  ROLE_META,
  StaffRole,
  StaffUser,
} from './types/ats';
import { exportCandidatesToExcelCsv } from './lib/atsHelpers';
import { auth } from './lib/firebase';
import {
  ensureStaffUserProfile,
  fetchCandidateCompensation,
  fetchCandidatePrivatePii,
  recordPdpaAudit,
  seedMalaysianSampleWorkspace,
  sendMissingDocsReminder,
  subscribeAuditLogs,
  subscribeCandidates,
  subscribeEmailLogs,
  subscribeInterviewSlots,
  subscribeStaffUsers,
} from './lib/firestoreService';
import { AuthGate } from './components/AuthGate';
import { DashboardView } from './components/DashboardView';
import { CandidateTableView } from './components/CandidateTableView';
import { CandidateIntakeModal } from './components/CandidateIntakeModal';
import { CandidateDetailDrawer } from './components/CandidateDetailDrawer';
import { InterviewSchedulerView } from './components/InterviewSchedulerView';
import { CandidatePortalView } from './components/CandidatePortalView';
import { CommunicationsAndAuditView } from './components/CommunicationsAndAuditView';

type NavView = 'dashboard' | 'database' | 'interviews' | 'portal' | 'compliance';

const INITIAL_FILTERS: CandidateFilters = {
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

const VIEW_LABELS: Record<NavView, string> = {
  dashboard: 'Executive Dashboard',
  database: 'Candidate Database',
  interviews: 'Interview Calendar',
  portal: 'Candidate Self-Service Portal',
  compliance: 'Email Automation & PDPA Audit',
};

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [rolePreview, setRolePreview] = useState<StaffRole | null>(null);

  const [activeView, setActiveView] = useState<NavView>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [slots, setSlots] = useState<InterviewSlot[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLogRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<PdpaAuditLogRecord[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const [filters, setFilters] = useState<CandidateFilters>(INITIAL_FILTERS);
  const [showIntakeModal, setShowIntakeModal] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [portalCandidateId, setPortalCandidateId] = useState<string | null>(null);

  const [seeding, setSeeding] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [sendingBatchReminders, setSendingBatchReminders] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const profile = await ensureStaffUserProfile(user);
          setStaffUser(profile);
          setRolePreview(null);
        } catch (err) {
          console.error('Failed to initialize staff user profile:', err);
        }
      } else {
        setStaffUser(null);
        setRolePreview(null);
        setCandidates([]);
        setSlots([]);
        setEmailLogs([]);
        setAuditLogs([]);
        setStaffUsers([]);
        setDataLoaded(false);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !firebaseUser || !staffUser) return;

    const unsubCandidates = subscribeCandidates(firebaseUser, (list) => {
      setCandidates(list);
      setDataLoaded(true);
    });
    const unsubSlots = subscribeInterviewSlots(firebaseUser, setSlots);
    const unsubEmails = subscribeEmailLogs(firebaseUser, setEmailLogs);
    const unsubAudits = subscribeAuditLogs(firebaseUser, setAuditLogs);
    const unsubStaff = subscribeStaffUsers(firebaseUser, setStaffUsers);

    return () => {
      unsubCandidates();
      unsubSlots();
      unsubEmails();
      unsubAudits();
      unsubStaff();
    };
  }, [authReady, firebaseUser, staffUser]);

  const effectiveRole: StaffRole = useMemo(() => {
    if (!staffUser) return 'recruiter';
    if (staffUser.role === 'hr_admin' && rolePreview) {
      return rolePreview;
    }
    return staffUser.role;
  }, [staffUser, rolePreview]);

  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.id === selectedCandidateId) || null,
    [candidates, selectedCandidateId]
  );

  const handleSeedSample = async () => {
    if (!staffUser) return;
    setSeeding(true);
    try {
      await seedMalaysianSampleWorkspace(staffUser);
      notify('Loaded 8 Malaysian candidates across Stages 3–15 and 6 interview slots into Firestore.');
    } finally {
      setSeeding(false);
    }
  };

  const handleSendBatchReminders = async (targets: CandidateRecord[]) => {
    if (!staffUser || targets.length === 0) return;
    setSendingBatchReminders(true);
    try {
      for (const c of targets) {
        await sendMissingDocsReminder({ actor: { ...staffUser, role: effectiveRole }, candidate: c });
      }
      notify(`Dispatched 48-hour missing document reminders to ${targets.length} shortlisted candidate(s).`);
    } finally {
      setSendingBatchReminders(false);
    }
  };

  const handleExportCsv = async (filteredList: CandidateRecord[]) => {
    if (!staffUser || effectiveRole !== 'hr_admin') return;
    setExportingCsv(true);
    try {
      const piiMap: Record<string, CandidatePrivatePii | undefined> = {};
      const compMap: Record<string, CandidatePrivateCompensation | undefined> = {};

      await Promise.all(
        filteredList.map(async (c) => {
          try {
            const pii = await fetchCandidatePrivatePii(c.id, staffUser, false);
            if (pii) piiMap[c.id] = pii;
          } catch {
            // ignore missing pii
          }
          if (c.offerStatus !== 'none') {
            try {
              const comp = await fetchCandidateCompensation(c.id, staffUser, false);
              if (comp) compMap[c.id] = comp;
            } catch {
              // ignore missing comp
            }
          }
        })
      );

      exportCandidatesToExcelCsv({
        candidates: filteredList,
        piiMap,
        compMap,
        role: effectiveRole,
      });

      await recordPdpaAudit({
        actor: staffUser,
        action: 'EXCEL_CSV_EXPORTED',
        targetType: 'export',
        targetId: `csv_${filteredList.length}`,
        details: `Exported Excel-compatible CSV report covering ${filteredList.length} filtered candidate record(s).`,
      });
      notify(`Exported ${filteredList.length} candidate(s) to Excel-compatible CSV (logged to PDPA Audit Trail).`);
    } finally {
      setExportingCsv(false);
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm text-slate-500 font-medium">Loading TalentFlow MY workspace...</div>
      </div>
    );
  }

  if (!firebaseUser || !staffUser) {
    return <AuthGate />;
  }

  const navItems: { id: NavView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'dashboard', label: 'Executive Dashboard', icon: LayoutDashboard },
    { id: 'database', label: 'Candidate Database', icon: Users },
    { id: 'interviews', label: 'Interview Calendar', icon: Calendar },
    { id: 'portal', label: 'Candidate Portal', icon: ExternalLink },
    { id: 'compliance', label: 'Email & PDPA Audit', icon: ShieldCheck },
  ];

  const handleOpenCandidatePortal = (candidateId: string) => {
    setSelectedCandidateId(null);
    setPortalCandidateId(candidateId);
    setActiveView('portal');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar Navigation (260px) */}
      <aside className="hidden lg:flex lg:flex-col w-[260px] shrink-0 bg-slate-900 text-slate-200 border-r border-slate-800">
        <div className="h-16 px-6 flex items-center border-b border-slate-800">
          <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
            TalentFlow MY
          </span>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-teal-400' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
          <div className="px-2">
            <div className="text-xs font-semibold text-white truncate">{staffUser.displayName}</div>
            <div className="text-[11px] text-slate-400 truncate mt-0.5">{staffUser.email}</div>
            <div className="text-[11px] text-teal-400 font-medium mt-1">
              {ROLE_META[staffUser.role].label}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut(auth)}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/70 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 bg-slate-900 text-slate-200 flex flex-col h-full">
            <div className="h-14 px-5 flex items-center justify-between border-b border-slate-800">
              <span className="font-display text-base font-bold text-white">TalentFlow MY</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveView(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-md ${
                      active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => void signOut(auth)}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-800 rounded-md"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
          <div className="flex-1 bg-slate-900/50" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb on Left, Single Primary Action on Right */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-6 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline whitespace-nowrap">TalentFlow MY</span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <h1 className="font-display font-bold text-slate-900 truncate">
                {VIEW_LABELS[activeView]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {effectiveRole !== 'hiring_manager' && (
              <button
                type="button"
                onClick={() => setShowIntakeModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-4 h-4" />
                <span>Register Candidate</span>
              </button>
            )}
          </div>
        </header>

        {/* Workspace Content Viewport */}
        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto space-y-5">
          {/* Workspace RBAC Perspective Switcher for HR Admins (kept in workspace toolbar, never in Top Bar) */}
          {staffUser.role === 'hr_admin' && (
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 text-xs">
              <div className="text-slate-500">
                PDPA Role Perspective:{' '}
                <strong className="text-slate-800">{ROLE_META[effectiveRole].label}</strong>
                <span className="hidden md:inline text-slate-400 ml-2">
                  — {ROLE_META[effectiveRole].summary}
                </span>
              </div>
              <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-md shrink-0">
                {(['hr_admin', 'recruiter', 'hiring_manager'] as StaffRole[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRolePreview(r === staffUser.role ? null : r)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                      effectiveRole === r
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {ROLE_META[r].label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Toast Feedback Banner */}
          {toast && (
            <div className="p-3.5 bg-slate-900 text-white text-xs rounded-md flex items-center justify-between gap-4">
              <span>{toast}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {!dataLoaded ? (
            <div className="bg-white border border-slate-200 rounded-lg p-8 space-y-3">
              <div className="h-4 w-48 bg-slate-200 rounded" />
              <div className="h-3 w-80 bg-slate-100 rounded" />
              <div className="grid grid-cols-5 gap-4 pt-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-20 bg-slate-100 rounded" />
                ))}
              </div>
            </div>
          ) : (
            <>
              {activeView === 'dashboard' && (
                <DashboardView
                  candidates={candidates}
                  slots={slots}
                  effectiveRole={effectiveRole}
                  seeding={seeding}
                  onSeedSampleData={handleSeedSample}
                  onOpenIntake={() => setShowIntakeModal(true)}
                  onSelectCandidate={(c) => setSelectedCandidateId(c.id)}
                  onNavigateToDatabase={(preset) => {
                    if (preset?.stage) {
                      setFilters({ ...INITIAL_FILTERS, stage: preset.stage });
                    } else {
                      setFilters(INITIAL_FILTERS);
                    }
                    setActiveView('database');
                  }}
                  onSendBatchDocReminders={handleSendBatchReminders}
                  sendingBatchReminders={sendingBatchReminders}
                />
              )}

              {activeView === 'database' && (
                <CandidateTableView
                  candidates={candidates}
                  filters={filters}
                  onChangeFilters={setFilters}
                  onResetFilters={() => setFilters(INITIAL_FILTERS)}
                  onSelectCandidate={(c) => setSelectedCandidateId(c.id)}
                  onExportCsv={handleExportCsv}
                  exportingCsv={exportingCsv}
                  effectiveRole={effectiveRole}
                />
              )}

              {activeView === 'interviews' && (
                <InterviewSchedulerView
                  slots={slots}
                  candidates={candidates}
                  actor={staffUser}
                  effectiveRole={effectiveRole}
                  onSelectCandidate={(c) => setSelectedCandidateId(c.id)}
                  onNotify={notify}
                />
              )}

              {activeView === 'portal' && (
                <CandidatePortalView
                  candidates={candidates}
                  slots={slots}
                  initialCandidateId={portalCandidateId}
                  actor={staffUser}
                  onNotify={notify}
                />
              )}

              {activeView === 'compliance' && (
                <CommunicationsAndAuditView
                  initialSection="emails"
                  emailLogs={emailLogs}
                  auditLogs={auditLogs}
                  staffUsers={staffUsers}
                  candidates={candidates}
                  actor={staffUser}
                  effectiveRole={effectiveRole}
                  onSendBatchDocReminders={handleSendBatchReminders}
                  sendingBatchReminders={sendingBatchReminders}
                  onNotify={notify}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Stage 1-2 AI Resume Intake Modal */}
      {showIntakeModal && (
        <CandidateIntakeModal
          actor={{ ...staffUser, role: effectiveRole }}
          existingCandidates={candidates}
          onClose={() => setShowIntakeModal(false)}
          onRegistered={(newId) => {
            setShowIntakeModal(false);
            setSelectedCandidateId(newId);
            notify('Candidate registered in Firestore and ready for Stage 3–4 Initial Screening.');
          }}
        />
      )}

      {/* Full 15-Stage Candidate Dossier Drawer */}
      {selectedCandidate && (
        <CandidateDetailDrawer
          candidate={selectedCandidate}
          slots={slots}
          actor={staffUser}
          effectiveRole={effectiveRole}
          onClose={() => setSelectedCandidateId(null)}
          onOpenCandidatePortal={handleOpenCandidatePortal}
          onNotify={notify}
        />
      )}
    </div>
  );
}
