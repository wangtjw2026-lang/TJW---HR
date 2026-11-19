import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { ShieldCheck, FileCheck2, CalendarCheck2, Sparkles, ArrowRight } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';

export const AuthGate: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.';
      setError(msg);
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
            Enterprise Recruitment Management System · Malaysia
          </p>

          <h1 className="font-display text-3xl sm:text-4xl font-bold text-white mt-12 max-w-xl leading-tight [text-wrap:balance]">
            Complete 15-stage hiring lifecycle built for Malaysian HR teams.
          </h1>
          <p className="text-slate-300 text-base mt-4 max-w-xl leading-relaxed">
            Manage JobStreet and Email candidate intake, AI resume scoring, automated Google Apps Script
            assessments, SPM/UEC/Degree credential verification, atomic interview booking, and MYR offers
            with PDPA 2010 audit governance.
          </p>

          <div className="grid sm:grid-cols-2 gap-6 mt-12 pt-8 border-t border-slate-800 max-w-2xl">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles className="w-4 h-4 text-teal-400 shrink-0" />
                <span>AI Resume Parsing & Duplicate Guard</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Extracts Malaysian qualifications (SPM, UEC, CGPA), experience, skills, and 0–100% job-fit match scores automatically.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <FileCheck2 className="w-4 h-4 text-teal-400 shrink-0" />
                <span>Forms, DISC & Credential Verification</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Auto-dispatches official Google Apps Script Employment & DISC links with 48-hour missing document reminders.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <CalendarCheck2 className="w-4 h-4 text-teal-400 shrink-0" />
                <span>Atomic Interview Slot Locking</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Firestore transactions lock candidate self-scheduled interview slots instantaneously with zero double-booking.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0" />
                <span>RBAC & Malaysian PDPA Audit Trail</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Split-collection PII and MYR salary isolation across HR Admin, Recruiter, and Hiring Manager roles.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-10 mt-10 border-t border-slate-800 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
          <span>PDPA 2010 Compliant Architecture</span>
          <span aria-hidden="true">·</span>
          <span>Cloud Firestore Real-Time Sync</span>
          <span aria-hidden="true">·</span>
          <span>15-Stage Executive Analytics</span>
        </div>
      </div>

      {/* Right Sign-In Column */}
      <div className="lg:w-5/12 flex items-center justify-center p-8 sm:p-12">
        <div className="w-full max-w-sm space-y-6">
          <div>
            <h2 className="font-display text-2xl font-bold text-slate-900">
              Sign in to HR Workspace
            </h2>
            <p className="text-sm text-slate-600 mt-1.5">
              Authenticate with your corporate Google account to access candidate pipelines and PDPA-protected records.
            </p>
          </div>

          {error && (
            <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-md transition-colors cursor-pointer"
          >
            <span>{loading ? 'Signing in...' : 'Continue with Google'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <div className="pt-4 border-t border-slate-200 space-y-2 text-xs text-slate-500">
            <p className="font-medium text-slate-700">Role-Based Access Control (RBAC)</p>
            <p>
              All access to candidate contact information, academic transcripts, and MYR compensation packages is
              strictly enforced and recorded in the immutable PDPA Security Audit Log.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
