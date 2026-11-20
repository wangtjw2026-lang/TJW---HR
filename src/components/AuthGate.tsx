import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Clock,
  FileCheck2,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { DEPARTMENTS, ROLE_META, StaffRole, StaffUser } from '../types/ats';
import {
  fetchAuthSetupStatus,
  loginStaff,
  requestStaffAccess,
  setupInitialHrAdmin,
} from '../lib/apiService';

interface AuthGateProps {
  onAuthenticated: (user: StaffUser) => void;
  sessionNotice?: string | null;
  onDismissNotice?: () => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  onAuthenticated,
  sessionNotice,
  onDismissNotice,
}) => {
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'request'>('login');

  // Initial Setup & Access Request fields
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState<string>('Human Resources');
  const [requestedRole, setRequestedRole] = useState<StaffRole>('manager');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Shared email/password fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestSubmittedMsg, setRequestSubmittedMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchAuthSetupStatus()
      .then((res) => {
        if (active) setNeedsSetup(Boolean(res.needsSetup));
      })
      .catch(() => {
        if (active) setNeedsSetup(false);
      })
      .finally(() => {
        if (active) setCheckingSetup(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    onDismissNotice?.();
    try {
      const { user } = await loginStaff(email, password);
      onAuthenticated(user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleInitialSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { user } = await setupInitialHrAdmin({
        name: fullName,
        email,
        password,
        department,
      });
      onAuthenticated(user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create initial Administrator account.';
      setError(msg);
      if (msg.toLowerCase().includes('already exists')) {
        setNeedsSetup(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAccessRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setRequestSubmittedMsg(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await requestStaffAccess({
        name: fullName,
        email,
        password,
        role: requestedRole,
        department,
      });
      setRequestSubmittedMsg(
        res.message ||
          'Your staff access request has been submitted and is pending approval by a System Administrator.'
      );
      setFullName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setRequestedRole('manager');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit access request.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: 'login' | 'request') => {
    setAuthMode(next);
    setError(null);
    setRequestSubmittedMsg(null);
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Enterprise Overview Column */}
      <div className="lg:w-7/12 bg-slate-900 text-slate-100 p-8 sm:p-12 lg:p-16 flex flex-col justify-between">
        <div>
          <div className="font-display text-xl font-bold tracking-tight text-white">
            TalentFlow MY
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Enterprise Recruitment Management System · Self-Hosted Express + SQLite
          </p>

          <h1 className="font-display text-3xl sm:text-4xl font-bold text-white mt-12 max-w-xl leading-tight [text-wrap:balance]">
            Complete 15-stage hiring lifecycle built for Malaysian HR teams.
          </h1>
          <p className="text-slate-300 text-base mt-4 max-w-xl leading-relaxed">
            Manage JobStreet and Email candidate intake, server-side Gemini AI resume scoring,
            automated Google Apps Script assessments, SPM/UEC/Degree verification, atomic SQLite
            interview booking, and MYR offers with local protected disk storage.
          </p>

          <div className="grid sm:grid-cols-2 gap-6 mt-12 pt-8 border-t border-slate-800 max-w-2xl">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles className="w-4 h-4 text-teal-400 shrink-0" />
                <span>AI Resume Parsing &amp; Duplicate Guard</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Extracts Malaysian qualifications (SPM, UEC, CGPA), experience, skills, and 0–100% job-fit match scores via backend Gemini API.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <FileCheck2 className="w-4 h-4 text-teal-400 shrink-0" />
                <span>Forms, DISC &amp; Protected File Storage</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Auto-dispatches official Google Apps Script Employment &amp; DISC links and stores uploaded academic PDFs securely on disk.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <CalendarCheck2 className="w-4 h-4 text-teal-400 shrink-0" />
                <span>Atomic SQLite Slot Transactions</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                WAL-mode SQLite transactions enforce slot capacity limits atomically to guarantee zero double-booking.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0" />
                <span>Admin-Approved RBAC, 2FA Lock &amp; PDPA Session Timeout</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Administrator-approved staff onboarding, locked 2FA governance (admin approval required to change), 10-minute idle auto-logout, and immutable SQLite audit trails.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-10 mt-10 border-t border-slate-800 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
          <span>SQLite WAL Persistence</span>
          <span aria-hidden="true">·</span>
          <span>2FA Governance Lock</span>
          <span aria-hidden="true">·</span>
          <span>10-Min Idle PDPA Timeout</span>
          <span aria-hidden="true">·</span>
          <span>Tamper-Proof Audit Ledger</span>
        </div>
      </div>

      {/* Right Authentication / First-Run Setup / Staff Access Request Column */}
      <div className="lg:w-5/12 flex items-center justify-center p-8 sm:p-12">
        <div className="w-full max-w-sm space-y-6">
          {checkingSetup ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin text-teal-700" />
              <span>Checking workspace initialization...</span>
            </div>
          ) : needsSetup ? (
            <>
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 mb-2">
                  <UserCheck className="w-4 h-4" />
                  <span>First-Time Workspace Setup</span>
                </div>
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  Create Initial Administrator Account
                </h2>
                <p className="text-sm text-slate-600 mt-1.5">
                  No staff accounts exist yet. Register your primary System Administrator account to unlock the recruitment workspace and approve incoming staff access requests.
                </p>
              </div>

              {error && (
                <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
                  {error}
                </div>
              )}

              <form onSubmit={handleInitialSetupSubmit} className="space-y-4">
                <div>
                  <label htmlFor="setup-name" className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name
                  </label>
                  <input
                    id="setup-name"
                    type="text"
                    required
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                    className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                  />
                </div>

                <div>
                  <label htmlFor="setup-email" className="block text-xs font-semibold text-slate-700 mb-1">
                    Work Email
                  </label>
                  <input
                    id="setup-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@yourcompany.com"
                    className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                  />
                </div>

                <div>
                  <label htmlFor="setup-department" className="block text-xs font-semibold text-slate-700 mb-1">
                    Department
                  </label>
                  <select
                    id="setup-department"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                  >
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="setup-password" className="block text-xs font-semibold text-slate-700 mb-1">
                    Password (min. 8 characters)
                  </label>
                  <input
                    id="setup-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a strong password"
                    className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                  />
                </div>

                <div>
                  <label htmlFor="setup-confirm-password" className="block text-xs font-semibold text-slate-700 mb-1">
                    Confirm Password
                  </label>
                  <input
                    id="setup-confirm-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-md transition-colors cursor-pointer"
                >
                  <span>{loading ? 'Creating Administrator Account...' : 'Create Initial Administrator Account'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </>
          ) : authMode === 'request' ? (
            <>
              <div>
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 mb-3 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign In</span>
                </button>
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 mb-1.5 block">
                  <UserPlus className="w-4 h-4" />
                  <span>New Staff Onboarding</span>
                </div>
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  Request Staff Access
                </h2>
                <p className="text-sm text-slate-600 mt-1.5">
                  Submit your details for System Administrator review. Pending accounts cannot sign in until explicitly approved.
                </p>
              </div>

              {requestSubmittedMsg && (
                <div className="p-3.5 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md space-y-2">
                  <div className="flex items-start gap-2 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <span>{requestSubmittedMsg}</span>
                  </div>
                  <p className="text-emerald-800 pl-6">
                    Once approved by an Administrator, you will be able to sign in with the email and password you submitted.
                  </p>
                  <div className="pl-6 pt-1">
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="text-xs font-semibold text-teal-800 hover:underline cursor-pointer"
                    >
                      Return to Sign In
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
                  {error}
                </div>
              )}

              <form onSubmit={handleAccessRequestSubmit} className="space-y-3.5">
                <div>
                  <label htmlFor="req-name" className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name
                  </label>
                  <input
                    id="req-name"
                    type="text"
                    required
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                  />
                </div>

                <div>
                  <label htmlFor="req-email" className="block text-xs font-semibold text-slate-700 mb-1">
                    Work Email
                  </label>
                  <input
                    id="req-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@yourcompany.com"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="req-department" className="block text-xs font-semibold text-slate-700 mb-1">
                      Department
                    </label>
                    <select
                      id="req-department"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                    >
                      {DEPARTMENTS.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="req-role" className="block text-xs font-semibold text-slate-700 mb-1">
                      Requested Role
                    </label>
                    <select
                      id="req-role"
                      value={requestedRole}
                      onChange={(e) => setRequestedRole(e.target.value as StaffRole)}
                      className="w-full px-2.5 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                    >
                      <option value="manager">Hiring Manager (View Only)</option>
                      <option value="administrator">System Administrator</option>
                    </select>
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600 leading-relaxed space-y-1">
                  <div>
                    <span className="font-semibold text-slate-800">{ROLE_META[requestedRole].title}:</span>{' '}
                    {ROLE_META[requestedRole].accessLimits}.
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-500 pt-1 border-t border-slate-100">
                    <Lock className="w-3 h-3 text-teal-700 shrink-0" />
                    <span>2FA (EMAIL_OTP) is enabled &amp; locked by default; only a System Administrator can approve changes.</span>
                  </div>
                </div>

                <div>
                  <label htmlFor="req-password" className="block text-xs font-semibold text-slate-700 mb-1">
                    Password (min. 8 characters)
                  </label>
                  <input
                    id="req-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a secure password"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                  />
                </div>

                <div>
                  <label htmlFor="req-confirm-password" className="block text-xs font-semibold text-slate-700 mb-1">
                    Confirm Password
                  </label>
                  <input
                    id="req-confirm-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-md transition-colors cursor-pointer"
                >
                  <span>{loading ? 'Submitting Request...' : 'Submit Access Request'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </>
          ) : (
            <>
              <div>
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  Sign in to HR Workspace
                </h2>
                <p className="text-sm text-slate-600 mt-1.5">
                  Authenticate with your approved staff credentials to access candidate pipelines and PDPA-protected documents.
                </p>
              </div>

              {sessionNotice && (
                <div className="flex items-start gap-2.5 p-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md">
                  <Clock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>{sessionNotice}</span>
                </div>
              )}

              {error && (
                <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
                  {error}
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1">
                    Work Email
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@yourcompany.com"
                    className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                  />
                </div>

                <div>
                  <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700 mb-1">
                    Password
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-700/20 focus:border-teal-700"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-md transition-colors cursor-pointer"
                >
                  <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="pt-4 border-t border-slate-200 space-y-3 text-xs">
                <div className="flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
                  <Lock className="w-3.5 h-3.5 text-teal-700 shrink-0 mt-0.5" />
                  <span>
                    All staff accounts have 2FA locked by policy. Any 2FA reset or change requires formal System Administrator approval.
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">New HR or Hiring Manager staff?</span>
                  <button
                    type="button"
                    onClick={() => switchMode('request')}
                    className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Request Staff Access</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
