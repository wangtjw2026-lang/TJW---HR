import React, { useEffect, useState } from 'react';
import {
  BellRing,
  Calendar,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  Lock,
  Printer,
  Send,
  UserCheck,
  X,
} from 'lucide-react';
import {
  CandidatePrivateCompensation,
  CandidatePrivatePii,
  CandidateRecord,
  DocStatus,
  GOOGLE_APPS_SCRIPT_URLS,
  InterviewSlot,
  OfferStatus,
  PostInterviewDecision,
  QualificationDecision,
  ROLE_META,
  ScreeningDecision,
  StaffRole,
  StaffUser,
  STATUS_META,
  UecDocStatus,
  WORKFLOW_STAGES,
} from '../types/ats';
import { formatMYR, getMissingMandatoryDocs, getStageTitle } from '../lib/atsHelpers';
import {
  bookInterviewSlotAtomically,
  fetchCandidateCompensation,
  fetchCandidatePrivatePii,
  markInterviewCompleted,
  sendEmploymentOffer,
  sendMissingDocsReminder,
  submitPostInterviewEvaluation,
  submitQualificationDecision,
  submitScreeningDecision,
  updateCandidateDocsAndForms,
  updateOfferResponseStatus,
} from '../lib/firestoreService';

interface CandidateDetailDrawerProps {
  candidate: CandidateRecord;
  slots: InterviewSlot[];
  actor: StaffUser;
  effectiveRole: StaffRole;
  onClose: () => void;
  onOpenCandidatePortal: (candidateId: string) => void;
  onNotify: (msg: string) => void;
}

type PhaseTab = 'screening' | 'docs' | 'interview' | 'offer';

export const CandidateDetailDrawer: React.FC<CandidateDetailDrawerProps> = ({
  candidate,
  slots,
  actor,
  effectiveRole,
  onClose,
  onOpenCandidatePortal,
  onNotify,
}) => {
  const defaultTab: PhaseTab =
    candidate.currentStage <= 4
      ? 'screening'
      : candidate.currentStage <= 8
        ? 'docs'
        : candidate.currentStage <= 12
          ? 'interview'
          : 'offer';

  const [activeTab, setActiveTab] = useState<PhaseTab>(defaultTab);
  const [pii, setPii] = useState<CandidatePrivatePii | null>(null);
  const [comp, setComp] = useState<CandidatePrivateCompensation | null>(null);
  const [loadingPrivate, setLoadingPrivate] = useState(false);

  // Stage 4 Screening state
  const [screeningDecision, setScreeningDecision] = useState<ScreeningDecision>(candidate.screeningDecision);
  const [rejectionReason, setRejectionReason] = useState(candidate.screeningRejectionReason);

  // Stage 5-8 Docs & Qualification state
  const [empFormDone, setEmpFormDone] = useState(candidate.employmentFormCompleted);
  const [discFormDone, setDiscFormDone] = useState(candidate.discFormCompleted);
  const [discProfile, setDiscProfile] = useState(candidate.discProfile);
  const [docSpm, setDocSpm] = useState<DocStatus>(candidate.docSpmStatus);
  const [docUec, setDocUec] = useState<UecDocStatus>(candidate.docUecStatus);
  const [docDegree, setDocDegree] = useState<DocStatus>(candidate.docDegreeStatus);
  const [docTranscript, setDocTranscript] = useState<DocStatus>(candidate.docTranscriptStatus);
  const [qualDecision, setQualDecision] = useState<QualificationDecision>(candidate.qualificationDecision);
  const [qualRemarks, setQualRemarks] = useState(candidate.qualificationRemarks);

  // Stage 9-12 Interview & Evaluation state
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [interviewFeedback, setInterviewFeedback] = useState(candidate.interviewFeedback);
  const [interviewRating, setInterviewRating] = useState<number>(candidate.interviewRating || 4);
  const [postDecision, setPostDecision] = useState<PostInterviewDecision>(candidate.postInterviewDecision);
  const [finalNotes, setFinalNotes] = useState(candidate.finalDecisionNotes);

  // Stage 13-15 Offer Builder state (MYR)
  const [positionOffered, setPositionOffered] = useState(candidate.positionApplied);
  const [departmentOffered, setDepartmentOffered] = useState(candidate.department);
  const [monthlySalaryMYR, setMonthlySalaryMYR] = useState<number>(7500);
  const [allowanceMYR, setAllowanceMYR] = useState<number>(500);
  const [probationMonths, setProbationMonths] = useState<number>(3);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [offerDeadline, setOfferDeadline] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [offerTermsSummary, setOfferTermsSummary] = useState(
    'Full-time permanent appointment under Malaysian Employment Act 1955. Includes statutory EPF, SOCSO & EIS contributions, outpatient & hospitalization medical coverage, and 16 days annual leave.'
  );
  const [offerStatusInput, setOfferStatusInput] = useState<OfferStatus>(
    candidate.offerStatus === 'none' ? 'offer_sent' : candidate.offerStatus
  );
  const [offerResponseNote, setOfferResponseNote] = useState('');
  const [showOfferLetterPreview, setShowOfferLetterPreview] = useState(false);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const canViewPii = ROLE_META[effectiveRole].canViewPii;
  const canViewSalary = ROLE_META[effectiveRole].canViewSalary;
  const isTrueAdmin = actor.role === 'hr_admin';

  useEffect(() => {
    setScreeningDecision(candidate.screeningDecision);
    setRejectionReason(candidate.screeningRejectionReason);
    setEmpFormDone(candidate.employmentFormCompleted);
    setDiscFormDone(candidate.discFormCompleted);
    setDiscProfile(candidate.discProfile);
    setDocSpm(candidate.docSpmStatus);
    setDocUec(candidate.docUecStatus);
    setDocDegree(candidate.docDegreeStatus);
    setDocTranscript(candidate.docTranscriptStatus);
    setQualDecision(candidate.qualificationDecision);
    setQualRemarks(candidate.qualificationRemarks);
    setInterviewFeedback(candidate.interviewFeedback);
    setInterviewRating(candidate.interviewRating || 4);
    setPostDecision(candidate.postInterviewDecision);
    setFinalNotes(candidate.finalDecisionNotes);
    setOfferStatusInput(candidate.offerStatus === 'none' ? 'offer_sent' : candidate.offerStatus);
  }, [candidate]);

  useEffect(() => {
    let active = true;
    async function loadSplitPrivateDocs() {
      setLoadingPrivate(true);
      try {
        if (canViewPii && (actor.role === 'hr_admin' || actor.role === 'recruiter')) {
          const piiData = await fetchCandidatePrivatePii(candidate.id, { ...actor, role: effectiveRole }, true);
          if (active) setPii(piiData);
        } else if (active) {
          setPii(null);
        }

        if (canViewSalary && isTrueAdmin) {
          const compData = await fetchCandidateCompensation(candidate.id, { ...actor, role: effectiveRole }, true);
          if (active) {
            setComp(compData);
            if (compData) {
              setPositionOffered(compData.positionOffered || candidate.positionApplied);
              setDepartmentOffered(compData.departmentOffered || candidate.department);
              setMonthlySalaryMYR(compData.monthlySalaryMYR || 7500);
              setAllowanceMYR(compData.allowanceMYR || 0);
              setProbationMonths(compData.probationMonths || 3);
              if (compData.startDate) setStartDate(compData.startDate);
              if (compData.offerDeadline) setOfferDeadline(compData.offerDeadline);
              if (compData.offerTermsSummary) setOfferTermsSummary(compData.offerTermsSummary);
              if (compData.candidateResponseNote) setOfferResponseNote(compData.candidateResponseNote);
            }
          }
        } else if (active) {
          setComp(null);
        }
      } catch (err) {
        console.error('Private subcollection fetch error:', err);
      } finally {
        if (active) setLoadingPrivate(false);
      }
    }
    void loadSplitPrivateDocs();
    return () => {
      active = false;
    };
  }, [candidate.id, canViewPii, canViewSalary, effectiveRole, actor, isTrueAdmin, candidate.positionApplied, candidate.department]);

  const availableSlots = slots.filter((s) => s.status === 'available');
  const missingDocs = getMissingMandatoryDocs(candidate);

  const handleSaveScreening = async () => {
    if (screeningDecision === 'reject' && !rejectionReason.trim()) {
      setActionError('A mandatory rejection reason is required when rejecting a candidate at Stage 4.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await submitScreeningDecision({
        actor: { ...actor, role: effectiveRole },
        candidate,
        decision: screeningDecision,
        rejectionReason,
      });
      onNotify(
        screeningDecision === 'proceed'
          ? `Shortlisted ${candidate.fullName} (Stage 5) & auto-sent Employment Form + DISC Assessment links.`
          : screeningDecision === 'reject'
            ? `Rejected ${candidate.fullName} with reason logged.`
            : 'Updated screening decision to Pending Review.'
      );
      if (screeningDecision === 'proceed') setActiveTab('docs');
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to save screening decision.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDocsChecklist = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await updateCandidateDocsAndForms({
        actor: { ...actor, role: effectiveRole },
        candidate,
        employmentFormCompleted: empFormDone,
        discFormCompleted: discFormDone,
        discProfile,
        docSpmStatus: docSpm,
        docUecStatus: docUec,
        docDegreeStatus: docDegree,
        docTranscriptStatus: docTranscript,
      });
      onNotify(`Saved Stage 6–7 forms & academic credential verification for ${candidate.fullName}.`);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to update documents checklist.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendDocReminder = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await sendMissingDocsReminder({
        actor: { ...actor, role: effectiveRole },
        candidate,
      });
      onNotify(`Automated missing-document reminder dispatched to ${candidate.fullName}.`);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to dispatch reminder.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveQualification = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await submitQualificationDecision({
        actor: { ...actor, role: effectiveRole },
        candidate,
        decision: qualDecision,
        remarks: qualRemarks,
      });
      onNotify(
        qualDecision === 'qualified'
          ? `${candidate.fullName} qualified (Stage 9) — interview self-scheduling invite dispatched.`
          : `Qualification decision updated to ${qualDecision}.`
      );
      if (qualDecision === 'qualified') setActiveTab('interview');
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to submit qualification decision.');
    } finally {
      setBusy(false);
    }
  };

  const handleAtomicBookSlot = async () => {
    if (!selectedSlotId) {
      setActionError('Select an available interview slot first.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const slot = await bookInterviewSlotAtomically({
        actor: { ...actor, role: effectiveRole },
        candidate,
        slotId: selectedSlotId,
      });
      onNotify(`Atomically locked ${slot.date} (${slot.startTime}) for ${candidate.fullName} & sent confirmation.`);
      setSelectedSlotId('');
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Slot reservation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleMarkInterviewDone = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await markInterviewCompleted({
        actor: { ...actor, role: effectiveRole },
        candidate,
      });
      onNotify(`Marked Stage 11 interview completed for ${candidate.fullName}.`);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to mark interview completed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSavePostInterview = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await submitPostInterviewEvaluation({
        actor: { ...actor, role: effectiveRole },
        candidate,
        feedback: interviewFeedback,
        rating: interviewRating,
        decision: postDecision,
        notes: finalNotes,
      });
      onNotify(
        postDecision === 'offer'
          ? `Panel approved ${candidate.fullName} for Employment Offer (ready for Stage 13).`
          : `Saved post-interview evaluation (${postDecision}).`
      );
      if (postDecision === 'offer' && canViewSalary) setActiveTab('offer');
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to save panel evaluation.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendOffer = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await sendEmploymentOffer({
        actor: { ...actor, role: effectiveRole },
        candidate,
        positionOffered,
        departmentOffered,
        monthlySalaryMYR,
        allowanceMYR,
        probationMonths,
        startDate,
        offerDeadline,
        offerTermsSummary,
      });
      const updatedComp = await fetchCandidateCompensation(candidate.id, actor, false);
      setComp(updatedComp);
      onNotify(`Employment Offer dispatched to ${candidate.fullName} (${formatMYR(monthlySalaryMYR)}/mo).`);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to send employment offer.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateOfferResponse = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await updateOfferResponseStatus({
        actor: { ...actor, role: effectiveRole },
        candidate,
        offerStatus: offerStatusInput,
        responseNote: offerResponseNote,
      });
      onNotify(`Offer status updated to "${offerStatusInput.replace('_', ' ')}".`);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to update offer response.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex justify-end">
      <div className="bg-white w-full max-w-4xl h-full flex flex-col border-l border-slate-200 overflow-hidden">
        {/* Top Candidate Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4 no-print">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="font-display text-lg font-bold text-slate-900 truncate">
                {candidate.fullName}
              </h2>
              <span className="font-mono tabular-nums text-xs text-slate-500">
                {candidate.candidateCode}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium text-slate-700">{candidate.positionApplied}</span>
              <span aria-hidden="true">·</span>
              <span>{candidate.department}</span>
              <span aria-hidden="true">·</span>
              <span>{candidate.source}</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-teal-700">
                Stage {String(candidate.currentStage).padStart(2, '0')}: {getStageTitle(candidate.currentStage)}
              </span>
              <span aria-hidden="true">·</span>
              <span>{STATUS_META[candidate.status].label}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onOpenCandidatePortal(candidate.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-md transition-colors cursor-pointer whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Candidate Portal</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dossier"
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 15-Stage Compact Progress Bar */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 no-print">
          <div className="grid grid-cols-15 gap-1">
            {WORKFLOW_STAGES.map((s) => {
              const reached = candidate.currentStage >= s.stage;
              const current = candidate.currentStage === s.stage;
              return (
                <div key={s.stage} title={`Stage ${s.stage}: ${s.title}`} className="space-y-1">
                  <div
                    className={`h-1.5 rounded-sm ${
                      current ? 'bg-teal-700' : reached ? 'bg-teal-500/70' : 'bg-slate-200'
                    }`}
                  />
                  <div
                    className={`font-mono tabular-nums text-[10px] text-center ${
                      current ? 'font-bold text-teal-800' : 'text-slate-400'
                    }`}
                  >
                    {s.stage}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Phase Navigation Tabs */}
        <div className="px-6 py-2.5 border-b border-slate-200 flex items-center gap-1 overflow-x-auto no-print">
          {(
            [
              { id: 'screening', label: '01. Screening (S1–S4)' },
              { id: 'docs', label: '02. Forms & Docs (S5–S8)' },
              { id: 'interview', label: '03. Interview & Panel (S9–S12)' },
              { id: 'offer', label: '04. MYR Offer & Final (S13–S15)' },
            ] as { id: PhaseTab; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setActionError(null);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {actionError && (
            <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md no-print">
              {actionError}
            </div>
          )}

          {/* PDPA Contact & Profile Bar */}
          <section className="pb-5 border-b border-slate-200 grid sm:grid-cols-3 gap-4 text-xs no-print">
            <div>
              <div className="text-slate-400">Contact Email</div>
              <div className="font-mono text-slate-900 mt-0.5 break-all">
                {canViewPii ? (loadingPrivate ? 'Loading...' : pii?.email || candidate.maskedEmail) : `${candidate.maskedEmail} (Masked — PDPA)`}
              </div>
            </div>
            <div>
              <div className="text-slate-400">Phone Number</div>
              <div className="font-mono text-slate-900 mt-0.5">
                {canViewPii ? (loadingPrivate ? 'Loading...' : pii?.phone || candidate.maskedPhone) : `${candidate.maskedPhone} (Masked — PDPA)`}
              </div>
            </div>
            <div>
              <div className="text-slate-400">Location · Experience · AI Fit</div>
              <div className="text-slate-900 mt-0.5 font-medium">
                {canViewPii ? pii?.location || 'Malaysia' : 'Malaysia'} ·{' '}
                <span className="font-mono tabular-nums">{candidate.yearsExperience} yrs</span> ·{' '}
                <span className="font-mono tabular-nums font-bold text-teal-700">{candidate.aiMatchScore}% fit</span>
              </div>
            </div>
          </section>

          {/* TAB 1: STAGES 1-4 RESUME SCREENING */}
          {activeTab === 'screening' && (
            <div className="space-y-6">
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold text-slate-500">Gemini AI Screening Scorecard</h3>
                  <p className="text-sm text-slate-800 mt-1 leading-relaxed">{candidate.aiSummary}</p>
                </div>

                <div className="grid sm:grid-cols-2 gap-6 pt-3 border-t border-slate-100 text-xs">
                  <div>
                    <div className="font-semibold text-slate-700">Education (SPM / UEC / Degree)</div>
                    <p className="text-slate-600 mt-1 leading-relaxed">{candidate.educationSummary}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-700">Relevant Work Experience</div>
                    <p className="text-slate-600 mt-1 leading-relaxed">{candidate.experienceSummary}</p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100">
                  <div className="text-xs font-semibold text-slate-700">Extracted Competencies</div>
                  <div className="text-xs text-slate-600 mt-1">
                    {candidate.skills.length > 0 ? candidate.skills.join(' · ') : 'No skills extracted'}
                  </div>
                </div>
              </div>

              {/* Stage 4 Decision Controls */}
              <div className="pt-5 border-t border-slate-200 space-y-4">
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    Stage 4 · HR Initial Screening Decision
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Selecting <strong>Proceed to Next Stage</strong> automatically advances the candidate to Stage 5 and
                    dispatches the official Employment Application Form and DISC Personality Assessment links.
                  </p>
                </div>

                {effectiveRole === 'hiring_manager' ? (
                  <div className="p-3 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md flex items-center gap-2">
                    <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                    <span>Initial screening decisions are restricted to HR Admin and Recruiter roles.</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { value: 'proceed', label: 'Proceed to Next Stage (Auto-Send Forms)' },
                          { value: 'pending', label: 'Pending Review' },
                          { value: 'reject', label: 'Reject Candidate' },
                        ] as { value: ScreeningDecision; label: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setScreeningDecision(opt.value)}
                          className={`px-3.5 py-2 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                            screeningDecision === opt.value
                              ? opt.value === 'reject'
                                ? 'bg-red-700 text-white border-red-700'
                                : 'bg-teal-700 text-white border-teal-700'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {screeningDecision === 'reject' && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Mandatory Rejection Reason *
                        </label>
                        <textarea
                          rows={2}
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          placeholder="Provide objective screening rejection reason for audit compliance..."
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                        />
                      </div>
                    )}

                    <div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleSaveScreening}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md transition-colors cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{busy ? 'Saving Decision...' : 'Confirm Screening Decision'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: STAGES 5-8 GOOGLE APPS SCRIPT FORMS, ACADEMIC DOCS & QUALIFICATION */}
          {activeTab === 'docs' && (
            <div className="space-y-6">
              {/* Official Google Apps Script Links */}
              <div className="pb-5 border-b border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Stage 5 · Integrated Google Apps Script Assessment Forms
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Automatically dispatched upon shortlisting. Verify completion and record candidate DISC profile.
                    </p>
                  </div>
                  {missingDocs.length > 0 && effectiveRole !== 'hiring_manager' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSendDocReminder}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md cursor-pointer whitespace-nowrap"
                    >
                      <BellRing className="w-3.5 h-3.5" />
                      <span>Send 48h Missing-Docs Reminder ({missingDocs.length})</span>
                    </button>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-4 pt-1 text-xs">
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">A. Employment Application Form</span>
                      <a
                        href={GOOGLE_APPS_SCRIPT_URLS.employmentApplicationForm}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-800 font-medium"
                      >
                        <span>Open Link</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={effectiveRole === 'hiring_manager'}
                        checked={empFormDone}
                        onChange={(e) => setEmpFormDone(e.target.checked)}
                        className="rounded border-slate-300 text-teal-700"
                      />
                      <span>Verified Completed by HR</span>
                    </label>
                  </div>

                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">B. DISC Personality Assessment</span>
                      <a
                        href={GOOGLE_APPS_SCRIPT_URLS.discPersonalityAssessment}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-800 font-medium"
                      >
                        <span>Open Link</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          disabled={effectiveRole === 'hiring_manager'}
                          checked={discFormDone}
                          onChange={(e) => setDiscFormDone(e.target.checked)}
                          className="rounded border-slate-300 text-teal-700"
                        />
                        <span>DISC Completed</span>
                      </label>
                      <input
                        type="text"
                        disabled={effectiveRole === 'hiring_manager'}
                        value={discProfile}
                        onChange={(e) => setDiscProfile(e.target.value)}
                        placeholder="DISC Profile (e.g. D/I, C/S)"
                        className="flex-1 min-w-[140px] px-2 py-1 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:border-teal-700"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Stage 6-7 Malaysian Academic Document Checklist */}
              <div className="pb-5 border-b border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Stages 6–7 · Malaysian Academic Document Verification
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Mandatory SPM, University Degree Certificate, Academic Transcript, and UEC (if applicable).
                    </p>
                  </div>
                  {candidate.lastDocReminderAt && (
                    <span className="font-mono tabular-nums text-[11px] text-slate-500">
                      Last reminder: {candidate.lastDocReminderAt.slice(0, 10)}
                    </span>
                  )}
                </div>

                {!canViewPii ? (
                  <div className="p-4 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md flex items-center gap-2">
                    <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                    <span>
                      Raw academic certificates and transcript filenames are masked for Hiring Managers per Malaysian PDPA policy.
                      Checklist summary: SPM ({candidate.docSpmStatus}) · UEC ({candidate.docUecStatus}) · Degree ({candidate.docDegreeStatus}) · Transcript ({candidate.docTranscriptStatus}).
                    </span>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-md text-xs">
                    {[
                      {
                        label: '1. SPM Examination Results (Mandatory)',
                        file: pii?.spmFileName,
                        value: docSpm,
                        onChange: (v: string) => setDocSpm(v as DocStatus),
                        options: ['missing', 'submitted', 'verified'],
                      },
                      {
                        label: '2. UEC Examination Results (If Applicable)',
                        file: pii?.uecFileName,
                        value: docUec,
                        onChange: (v: string) => setDocUec(v as UecDocStatus),
                        options: ['not_applicable', 'missing', 'submitted', 'verified'],
                      },
                      {
                        label: '3. University Degree Certificate (Mandatory)',
                        file: pii?.degreeFileName,
                        value: docDegree,
                        onChange: (v: string) => setDocDegree(v as DocStatus),
                        options: ['missing', 'submitted', 'verified'],
                      },
                      {
                        label: '4. University Academic Transcript (Mandatory)',
                        file: pii?.transcriptFileName,
                        value: docTranscript,
                        onChange: (v: string) => setDocTranscript(v as DocStatus),
                        options: ['missing', 'submitted', 'verified'],
                      },
                    ].map((row) => (
                      <div key={row.label} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-slate-900">{row.label}</div>
                          <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                            {row.file ? `Uploaded PDF: ${row.file}` : 'No document file uploaded yet'}
                          </div>
                        </div>
                        <select
                          value={row.value}
                          onChange={(e) => row.onChange(e.target.value)}
                          className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded focus:outline-none focus:border-teal-700"
                        >
                          {row.options.map((o) => (
                            <option key={o} value={o}>
                              {o.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}

                {effectiveRole !== 'hiring_manager' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSaveDocsChecklist}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md cursor-pointer"
                  >
                    <FileCheck2 className="w-3.5 h-3.5" />
                    <span>{busy ? 'Saving...' : 'Save Forms & Document Verification'}</span>
                  </button>
                )}
              </div>

              {/* Stage 8 Qualification Decision */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    Stage 8–9 · Qualification Decision & Interview Invite Dispatch
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Marking a candidate as <strong>Qualified</strong> automatically sends the Stage 9 self-scheduling interview invitation.
                  </p>
                </div>

                {effectiveRole === 'hiring_manager' ? (
                  <div className="text-xs text-slate-600">
                    Current Qualification: <strong>{candidate.qualificationDecision}</strong>
                    {candidate.qualificationRemarks ? ` — ${candidate.qualificationRemarks}` : ''}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { v: 'qualified', l: 'Qualified (Auto-Send Interview Invite)' },
                          { v: 'pending', l: 'Pending Review' },
                          { v: 'not_qualified', l: 'Not Qualified' },
                        ] as { v: QualificationDecision; l: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => setQualDecision(opt.v)}
                          className={`px-3.5 py-2 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                            qualDecision === opt.v
                              ? opt.v === 'not_qualified'
                                ? 'bg-red-700 text-white border-red-700'
                                : 'bg-teal-700 text-white border-teal-700'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {opt.l}
                        </button>
                      ))}
                    </div>

                    <textarea
                      rows={2}
                      value={qualRemarks}
                      onChange={(e) => setQualRemarks(e.target.value)}
                      placeholder="Evaluation remarks on DISC profile, CGPA, SPM/UEC results..."
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                    />

                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSaveQualification}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-md cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>{busy ? 'Submitting...' : 'Save Qualification Decision'}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: STAGES 9-12 INTERVIEW BOOKING & PANEL EVALUATION */}
          {activeTab === 'interview' && (
            <div className="space-y-6">
              {/* Confirmed Slot or Atomic Booking */}
              <div className="pb-5 border-b border-slate-200 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Stages 9–11 · Interview Slot & Attendance
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Firestore atomic transactions lock interview slots on reservation to prevent double-booking.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenCandidatePortal(candidate.id)}
                    className="text-xs font-semibold text-teal-700 hover:text-teal-800 underline cursor-pointer"
                  >
                    Open Self-Service Slot Picker
                  </button>
                </div>

                {candidate.interviewSlotId ? (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-md flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1 text-xs">
                      <div className="font-semibold text-slate-900 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-teal-700" />
                        <span className="font-mono tabular-nums">
                          {candidate.interviewDate} · {candidate.interviewTime}
                        </span>
                      </div>
                      <div className="text-slate-600">
                        {candidate.interviewMode} · Panelist: <strong>{candidate.interviewerName}</strong>
                      </div>
                    </div>

                    {candidate.status === 'interview_confirmed' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleMarkInterviewDone}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Mark Interview Conducted (Stage 11)</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {availableSlots.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No open interview slots available. Add available slots in the Interview Calendar view.
                      </p>
                    ) : effectiveRole !== 'hiring_manager' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={selectedSlotId}
                          onChange={(e) => setSelectedSlotId(e.target.value)}
                          className="flex-1 min-w-[260px] px-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                        >
                          <option value="">Assign available interview slot (atomic lock)...</option>
                          {availableSlots.map((slot) => (
                            <option key={slot.id} value={slot.id}>
                              {slot.date} ({slot.startTime}–{slot.endTime}) · {slot.mode} · {slot.interviewerName}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={busy || !selectedSlotId}
                          onClick={handleAtomicBookSlot}
                          className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap"
                        >
                          Lock Slot Atomically
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Candidate has not booked an interview slot yet.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Stage 12 Panel Feedback & Post-Interview Decision (Accessible by Hiring Manager, Recruiter, HR Admin) */}
              <div className="space-y-4">
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    Stage 12 · Post-Interview Panel Evaluation & Decision
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Hiring Managers and HR panelists record interview scores, competency feedback, and hiring recommendations.
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Interview Panel Rating (1–5)
                    </label>
                    <div className="flex items-center gap-1.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setInterviewRating(star)}
                          className={`w-9 h-9 font-mono tabular-nums text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                            interviewRating === star
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {star}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Post-Interview Decision
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          { v: 'offer', l: 'Offer Employment' },
                          { v: 'pending', l: 'Pending Decision' },
                          { v: 'reject', l: 'Reject Candidate' },
                        ] as { v: PostInterviewDecision; l: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => setPostDecision(opt.v)}
                          className={`px-3 py-2 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                            postDecision === opt.v
                              ? opt.v === 'reject'
                                ? 'bg-red-700 text-white border-red-700'
                                : 'bg-teal-700 text-white border-teal-700'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {opt.l}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Panel Evaluation Feedback
                  </label>
                  <textarea
                    rows={3}
                    value={interviewFeedback}
                    onChange={(e) => setInterviewFeedback(e.target.value)}
                    placeholder="Technical depth, cultural alignment, salary expectations, notice period..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Decision Remarks / Handover Notes
                  </label>
                  <input
                    type="text"
                    value={finalNotes}
                    onChange={(e) => setFinalNotes(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                  />
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSavePostInterview}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md cursor-pointer"
                >
                  {busy ? 'Saving Evaluation...' : 'Record Post-Interview Decision'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: STAGES 13-15 EMPLOYMENT OFFER & FINAL RESPONSE */}
          {activeTab === 'offer' && (
            <div className="space-y-6">
              {!canViewSalary ? (
                <div className="p-6 bg-slate-50 border border-slate-200 rounded-md space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Lock className="w-4 h-4 text-amber-700" />
                    <span>Confidential MYR Compensation Masked (RBAC & PDPA Policy)</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Salary packages in MYR, allowances, and employment offer letters are strictly isolated in
                    <code className="font-mono mx-1">/candidates/{candidate.id}/private/compensation</code>
                    and restricted exclusively to <strong>HR Admin</strong> personnel.
                  </p>
                  <div className="pt-2 text-xs text-slate-700">
                    Current Offer Pipeline Status:{' '}
                    <strong className="uppercase font-mono">{candidate.offerStatus.replace('_', ' ')}</strong>
                  </div>
                </div>
              ) : (
                <>
                  {/* Stage 13 MYR Offer Builder */}
                  <div className="pb-5 border-b border-slate-200 space-y-4 no-print">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">
                          Stage 13 · Generate & Send Employment Offer (MYR)
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Compensation is stored in a PDPA-isolated Firestore subcollection accessible only to HR Admins.
                        </p>
                      </div>
                      {comp && (
                        <button
                          type="button"
                          onClick={() => setShowOfferLetterPreview((v) => !v)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>{showOfferLetterPreview ? 'Hide Offer Letter' : 'Preview / Print Offer Letter PDF'}</span>
                        </button>
                      )}
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Offered Position</label>
                        <input
                          type="text"
                          value={positionOffered}
                          onChange={(e) => setPositionOffered(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Department</label>
                        <input
                          type="text"
                          value={departmentOffered}
                          onChange={(e) => setDepartmentOffered(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Monthly Base Salary (MYR)</label>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          value={monthlySalaryMYR}
                          onChange={(e) => setMonthlySalaryMYR(Number(e.target.value))}
                          className="w-full px-3 py-2 font-mono border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Monthly Fixed Allowance (MYR)</label>
                        <input
                          type="number"
                          min={0}
                          step={50}
                          value={allowanceMYR}
                          onChange={(e) => setAllowanceMYR(Number(e.target.value))}
                          className="w-full px-3 py-2 font-mono border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Proposed Start Date</label>
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-full px-3 py-2 font-mono border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Offer Response Deadline</label>
                        <input
                          type="date"
                          value={offerDeadline}
                          onChange={(e) => setOfferDeadline(e.target.value)}
                          className="w-full px-3 py-2 font-mono border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Probation Period (Months)</label>
                        <input
                          type="number"
                          min={0}
                          max={24}
                          value={probationMonths}
                          onChange={(e) => setProbationMonths(Number(e.target.value))}
                          className="w-full px-3 py-2 font-mono border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                        />
                      </div>
                      <div className="flex items-end pb-2">
                        <div className="text-xs text-slate-600">
                          Total Monthly Package:{' '}
                          <strong className="font-mono tabular-nums text-slate-900 text-sm">
                            {formatMYR(monthlySalaryMYR + allowanceMYR)}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Offer Terms & Statutory Malaysian Benefits (EPF / SOCSO / EIS)
                      </label>
                      <textarea
                        rows={2}
                        value={offerTermsSummary}
                        onChange={(e) => setOfferTermsSummary(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSendOffer}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-md cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{busy ? 'Dispatching Offer...' : comp ? 'Update & Re-Send Employment Offer' : 'Generate & Send Employment Offer'}</span>
                    </button>
                  </div>

                  {/* Printable Official Offer Letter Preview */}
                  {showOfferLetterPreview && comp && (
                    <div className="p-8 bg-white border border-slate-300 rounded-md space-y-4 text-xs text-slate-800">
                      <div className="flex items-start justify-between border-b border-slate-200 pb-4">
                        <div>
                          <div className="font-display text-lg font-bold text-slate-900">TalentFlow MY Sdn Bhd</div>
                          <div className="text-slate-500">Private & Confidential — Letter of Employment Offer</div>
                        </div>
                        <div className="text-right font-mono tabular-nums text-slate-500">
                          <div>Ref: {comp.offerLetterRef}</div>
                          <div>Deadline: {comp.offerDeadline}</div>
                        </div>
                      </div>
                      <p>Dear <strong>{candidate.fullName}</strong>,</p>
                      <p className="leading-relaxed">
                        We are pleased to offer you the position of <strong>{comp.positionOffered}</strong> in the{' '}
                        <strong>{comp.departmentOffered}</strong> department, commencing on{' '}
                        <strong className="font-mono">{comp.startDate}</strong>.
                      </p>
                      <div className="grid grid-cols-2 gap-3 py-3 border-y border-slate-200 font-mono tabular-nums">
                        <div>Basic Monthly Salary: <strong>{formatMYR(comp.monthlySalaryMYR)}</strong></div>
                        <div>Fixed Allowance: <strong>{formatMYR(comp.allowanceMYR)}</strong></div>
                        <div>Total Monthly Package: <strong>{formatMYR(comp.monthlySalaryMYR + comp.allowanceMYR)}</strong></div>
                        <div>Probation Period: <strong>{comp.probationMonths} months</strong></div>
                      </div>
                      <p className="leading-relaxed">{comp.offerTermsSummary}</p>
                      <div className="pt-2 flex justify-end no-print">
                        <button
                          type="button"
                          onClick={() => window.print()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Print / Save as PDF</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Stage 14-15 Track Offer Response & Final Status */}
                  <div className="space-y-3 no-print">
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Stages 14–15 · Track Offer Response & Record Final Status
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { v: 'offer_sent', l: 'Offer Sent' },
                          { v: 'pending_response', l: 'Pending Response' },
                          { v: 'accepted', l: 'Accepted (Stage 15)' },
                          { v: 'rejected', l: 'Rejected (Stage 15)' },
                          { v: 'expired', l: 'Expired (Stage 15)' },
                        ] as { v: OfferStatus; l: string }[]
                      ).map((st) => (
                        <button
                          key={st.v}
                          type="button"
                          onClick={() => setOfferStatusInput(st.v)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                            offerStatusInput === st.v
                              ? st.v === 'accepted'
                                ? 'bg-emerald-700 text-white border-emerald-700'
                                : st.v === 'rejected' || st.v === 'expired'
                                  ? 'bg-red-700 text-white border-red-700'
                                  : 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {st.l}
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      value={offerResponseNote}
                      onChange={(e) => setOfferResponseNote(e.target.value)}
                      placeholder="Candidate response remarks / final onboarding notes..."
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
                    />

                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleUpdateOfferResponse}
                      className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md cursor-pointer"
                    >
                      {busy ? 'Updating Status...' : 'Record Offer Status'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
