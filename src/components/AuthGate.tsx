import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck2,
  FileCheck2,
  Loader2,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { DEPARTMENTS, StaffUser } from '../types/ats';
import { fetchAuthSetupStatus, loginStaff, setupInitialHrAdmin } from '../lib/apiService';

interface AuthGateProps {
  onAuthenticated: (user: StaffUser) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onAuthenticated }) => {
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  // Initial HR Admin Setup fields
  const [adminName, setAdminName] = useState('');
  const [adminDepartment, setAdminDepartment] = useState<string>('Human Resources');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Shared email/password fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        name: adminName,
        email,
        password,
        department: adminDepartment,
      });
      onAuthenticated(user);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create initial HR Admin account.';
      setError(msg);
      if (msg.toLowerCase().includes('already exists')) {
        setNeedsSetup(false);
      }
    } finally {
      setLoading(false);
    }
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
                <span>AI Resume Parsing & Duplicate Guard</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Extracts Malaysian qualifications (SPM, UEC, CGPA), experience, skills, and 0–100% job-fit match scores via backend Gemini API.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <FileCheck2 className="w-4 h-4 text-teal-400 shrink-0" />
                <span>Forms, DISC & Protected File Storage</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Auto-dispatches official Google Apps Script Employment & DISC links and stores uploaded academic PDFs securely on disk.
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
                <span>JWT RBAC & PDPA Audit Trail</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Role-based access control between Administrator and Manager (View Only) accounts with immutable SQLite security audit logs.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-10 mt-10 border-t border-slate-800 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
          <span>SQLite WAL Persistence</span>
          <span aria-hidden="true">·</span>
          <span>Authenticated Local File Vault</span>
          <span aria-hidden="true">·</span>
          <span>Nodemailer Automation</span>
        </div>
      </div>

      {/* Right Authentication / First-Run Setup Column */}
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
                  No staff accounts exist yet. Register your primary Administrator account to unlock the recruitment workspace and manage Manager access.
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
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
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
                    value={adminDepartment}
                    onChange={(e) => setAdminDepartment(e.target.value)}
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
          ) : (
            <>
              <div>
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  Sign in to HR Workspace
                </h2>
                <p className="text-sm text-slate-600 mt-1.5">
                  Authenticate with your HR staff credentials to access candidate pipelines and PDPA-protected documents.
                </p>
              </div>

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
            </>
          )}
        </div>
      </div>
    </div>
  );
};
