import React, { useMemo } from 'react';
import {
  ArrowRight,
  BellRing,
  Calendar,
  FileWarning,
  UserPlus,
} from 'lucide-react';
import {
  CandidateRecord,
  InterviewSlot,
  StaffRole,
  STATUS_META,
  WORKFLOW_STAGES,
} from '../types/ats';
import { computeDashboardKPIs, getMissingMandatoryDocs, hasPendingDocs } from '../lib/atsHelpers';

interface DashboardViewProps {
  candidates: CandidateRecord[];
  slots: InterviewSlot[];
  role: StaffRole;
  onOpenIntake: () => void;
  onSelectCandidate: (candidate: CandidateRecord) => void;
  onNavigateToDatabase: (presetFilter?: { stage?: number; status?: string }) => void;
  onSendBatchDocReminders: (targets: CandidateRecord[]) => Promise<void>;
  sendingBatchReminders: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  candidates,
  slots,
  role,
  onOpenIntake,
  onSelectCandidate,
  onNavigateToDatabase,
  onSendBatchDocReminders,
  sendingBatchReminders,
}) => {
  const isAdmin = role === 'administrator';
  const kpis = useMemo(() => computeDashboardKPIs(candidates), [candidates]);

  const kpiItems = [
    { label: 'Total Applications Received', value: kpis.totalApplications, group: 'Intake', tone: 'text-slate-900' },
    { label: 'New Candidates', value: kpis.newCandidates, group: 'Intake', tone: 'text-slate-900' },
    { label: 'Pending Resume Screening', value: kpis.pendingResumeScreening, group: 'Screening', tone: kpis.pendingResumeScreening > 0 ? 'text-amber-700' : 'text-slate-900' },
    { label: 'Shortlisted Candidates', value: kpis.shortlistedCandidates, group: 'Screening', tone: 'text-teal-700' },
    { label: 'Rejected Candidates', value: kpis.rejectedCandidates, group: 'Screening', tone: kpis.rejectedCandidates > 0 ? 'text-red-700' : 'text-slate-900' },
    { label: 'Pending Documents', value: kpis.pendingDocuments, group: 'Verification', tone: kpis.pendingDocuments > 0 ? 'text-amber-700' : 'text-slate-900' },
    { label: 'Qualified Candidates', value: kpis.qualifiedCandidates, group: 'Verification', tone: 'text-emerald-700' },
    { label: 'Not Qualified Candidates', value: kpis.notQualifiedCandidates, group: 'Verification', tone: kpis.notQualifiedCandidates > 0 ? 'text-red-700' : 'text-slate-900' },
    { label: 'Interview Invitations Sent', value: kpis.interviewInvitationsSent, group: 'Interview', tone: 'text-teal-700' },
    { label: 'Confirmed Interviews', value: kpis.confirmedInterviews, group: 'Interview', tone: 'text-teal-700' },
    { label: 'Pending Interview Evaluations', value: kpis.pendingInterviewEvaluations, group: 'Interview', tone: kpis.pendingInterviewEvaluations > 0 ? 'text-amber-700' : 'text-slate-900' },
    { label: 'Employment Offers Sent', value: kpis.employmentOffersSent, group: 'Offer', tone: 'text-teal-700' },
    { label: 'Offers Accepted', value: kpis.offersAccepted, group: 'Offer', tone: 'text-emerald-700' },
    { label: 'Offers Rejected', value: kpis.offersRejected, group: 'Offer', tone: kpis.offersRejected > 0 ? 'text-red-700' : 'text-slate-900' },
    { label: 'Pending Offer Responses', value: kpis.pendingOfferResponses, group: 'Offer', tone: kpis.pendingOfferResponses > 0 ? 'text-amber-700' : 'text-slate-900' },
  ];

  const stageCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of candidates) {
      map.set(c.stage, (map.get(c.stage) ?? 0) + 1);
    }
    return WORKFLOW_STAGES.map((s) => ({
      ...s,
      count: map.get(s.stage) ?? 0,
    }));
  }, [candidates]);

  const maxStageCount = Math.max(1, ...stageCounts.map((s) => s.count));

  const pendingScreeningQueue = useMemo(
    () => candidates.filter((c) => c.status === 'new' || c.status === 'pending_screening'),
    [candidates]
  );

  const pendingDocsQueue = useMemo(
    () => candidates.filter((c) => hasPendingDocs(c)),
    [candidates]
  );

  const upcomingBookedSlots = useMemo(
    () => slots.filter((s) => s.booked_count > 0 && s.status === 'ACTIVE').slice(0, 5),
    [slots]
  );

  if (candidates.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-10 max-w-3xl mx-auto mt-6">
        <h2 className="font-display text-2xl font-bold text-slate-900 [text-wrap:balance]">
          Ready to launch your Malaysian hiring pipeline
        </h2>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed max-w-2xl">
          Your self-contained Express + SQLite database is initialized with zero pre-populated records and local protected document storage.
          Register your first candidate to begin screening, document verification, interview scheduling, and MYR offer management.
        </p>

        {isAdmin ? (
          <div className="flex flex-wrap items-center gap-3 mt-7">
            <button
              type="button"
              onClick={onOpenIntake}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              Register First Candidate
            </button>
          </div>
        ) : (
          <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            You are signed in with <strong>Manager (View Only)</strong> access. Once an Administrator registers candidates, live KPIs, pipeline milestones, and reports will appear here automatically.
          </div>
        )}

        <div className="grid sm:grid-cols-3 gap-6 mt-8 pt-6 border-t border-slate-200 text-xs text-slate-600">
          <div>
            <p className="font-semibold text-slate-900">Stages 1–4 · Intake & AI Screen</p>
            <p className="mt-1">JobStreet & Email intake, Gemini AI 0–100% match score, duplicate email/phone guard.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Stages 5–8 · Forms, Assessments &amp; Docs</p>
            <p className="mt-1">Online Employment Application Form &amp; DISC links plus direct portal uploads for SPM/UEC/Degree/Transcript with Gemini AI verification.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Stages 9–15 · Interview & MYR Offer</p>
            <p className="mt-1">Atomic SQLite slot transactions, panel scorecards, MYR offer builder & candidate portal.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* All 15 Real-Time Executive KPIs */}
      <section className="bg-white border border-slate-200 rounded-lg">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Executive Recruitment KPIs
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Real-time metrics across all 15 recruitment milestones stored in SQLite
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateToDatabase()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>Open Full Candidate Database</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y divide-slate-200">
          {kpiItems.map((item) => (
            <div key={item.label} className="p-4 hover:bg-slate-50/70 transition-colors">
              <div className="text-xs text-slate-500 truncate" title={item.label}>
                {item.label}
              </div>
              <div className={`font-mono tabular-nums text-2xl font-semibold mt-1.5 ${item.tone}`}>
                {item.value}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">{item.group}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Main Split: 15-Stage Pipeline Distribution + Operational Action Queues */}
      <div className="grid lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                15-Stage Lifecycle Distribution
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Click any stage row to filter candidates at that milestone
              </p>
            </div>
            <span className="font-mono tabular-nums text-xs text-slate-500">
              {candidates.length} total
            </span>
          </div>

          <div className="divide-y divide-slate-100 px-6 py-2">
            {stageCounts.map((s) => {
              const pct = Math.round((s.count / maxStageCount) * 100);
              return (
                <button
                  key={s.stage}
                  type="button"
                  onClick={() => onNavigateToDatabase({ stage: s.stage })}
                  className="w-full py-2.5 flex items-center gap-4 text-left hover:bg-slate-50 -mx-2 px-2 rounded transition-colors cursor-pointer"
                >
                  <span className="font-mono tabular-nums text-xs font-medium text-slate-400 w-6 shrink-0">
                    {String(s.stage).padStart(2, '0')}
                  </span>
                  <div className="w-44 sm:w-52 shrink-0">
                    <div className="text-xs font-medium text-slate-800 truncate">{s.title}</div>
                    <div className="text-[11px] text-slate-400">{s.phase}</div>
                  </div>
                  <div className="flex-1 h-2 bg-slate-100 rounded-sm overflow-hidden">
                    <div
                      className="h-full bg-teal-700 transition-all duration-300"
                      style={{ width: s.count > 0 ? `${Math.max(8, pct)}%` : '0%' }}
                    />
                  </div>
                  <span className="font-mono tabular-nums text-xs font-semibold text-slate-900 w-8 text-right shrink-0">
                    {s.count}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="lg:col-span-5 space-y-6">
          {/* Pending Academic Docs & 48h Reminder Queue */}
          <section className="bg-white border border-slate-200 rounded-lg">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <FileWarning className="w-4 h-4 text-amber-700 shrink-0" />
                <h3 className="font-display text-sm font-bold text-slate-900 truncate">
                  Stage 5–6 · Pending Forms & Academic Docs
                </h3>
              </div>
              {isAdmin && pendingDocsQueue.length > 0 && (
                <button
                  type="button"
                  disabled={sendingBatchReminders}
                  onClick={() => onSendBatchDocReminders(pendingDocsQueue)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 disabled:opacity-50 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <BellRing className="w-3.5 h-3.5" />
                  <span>{sendingBatchReminders ? 'Sending...' : 'Send Reminders'}</span>
                </button>
              )}
            </div>

            {pendingDocsQueue.length === 0 ? (
              <div className="px-5 py-6 text-xs text-slate-500">
                No shortlisted candidates currently have outstanding online forms (Application Form, DISC) or academic document uploads.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {pendingDocsQueue.map((c) => {
                  const missing = getMissingMandatoryDocs(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onSelectCandidate(c)}
                      className="w-full px-5 py-3.5 text-left hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900 truncate">{c.full_name}</span>
                        <span className="font-mono tabular-nums text-xs text-amber-700 shrink-0">
                          {missing.length} missing
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">
                        {c.position} · {missing.slice(0, 3).join(', ')}
                        {missing.length > 3 ? ` +${missing.length - 3}` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Pending Resume Screening Queue */}
          <section className="bg-white border border-slate-200 rounded-lg">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Stage 3–4 · Pending Initial Screening
              </h3>
              <span className="font-mono tabular-nums text-xs text-slate-500">
                {pendingScreeningQueue.length}
              </span>
            </div>
            {pendingScreeningQueue.length === 0 ? (
              <div className="px-5 py-6 text-xs text-slate-500">
                All received resumes have been screened.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {pendingScreeningQueue.slice(0, 5).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelectCandidate(c)}
                    className="w-full px-5 py-3.5 text-left hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{c.full_name}</div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">
                        {c.position} · {c.source} · {c.applied_date}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono tabular-nums text-sm font-semibold text-teal-700">
                        {c.ai_score}%
                      </div>
                      <div className="text-[11px] text-slate-400">AI Fit</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Upcoming Confirmed Interviews */}
          <section className="bg-white border border-slate-200 rounded-lg">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-teal-700 shrink-0" />
                <h3 className="font-display text-sm font-bold text-slate-900">
                  Stage 10–11 · Confirmed Interviews
                </h3>
              </div>
              <span className="font-mono tabular-nums text-xs text-slate-500">
                {upcomingBookedSlots.length} slot(s)
              </span>
            </div>
            {upcomingBookedSlots.length === 0 ? (
              <div className="px-5 py-6 text-xs text-slate-500">
                No confirmed interview slots booked yet. Qualified candidates can reserve available slots in the Candidate Portal.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {upcomingBookedSlots.map((slot) => {
                  const activeBooking = slot.bookings.find((b) => b.status === 'CONFIRMED' || b.status === 'COMPLETED');
                  const cand = activeBooking ? candidates.find((c) => c.id === activeBooking.candidate_id) : undefined;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => cand && onSelectCandidate(cand)}
                      className="w-full px-5 py-3.5 text-left hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900 truncate">
                          {activeBooking?.candidate_name || `${slot.booked_count}/${slot.capacity} Booked`}
                        </span>
                        <span className="font-mono tabular-nums text-xs font-medium text-teal-700 shrink-0">
                          {slot.date} · {slot.start_time}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">
                        {slot.mode} · {slot.interviewer_name}
                        {cand ? ` · ${STATUS_META[cand.status].label}` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
