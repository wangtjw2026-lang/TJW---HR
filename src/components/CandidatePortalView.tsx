import React, { useEffect, useState } from 'react';
import {
  CalendarCheck2,
  CheckCircle2,
  ExternalLink,
  FileUp,
  Handshake,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  CandidatePrivateCompensation,
  CandidateRecord,
  GOOGLE_APPS_SCRIPT_URLS,
  InterviewSlot,
  StaffUser,
  STATUS_META,
} from '../types/ats';
import { formatMYR, getStageTitle } from '../lib/atsHelpers';
import {
  bookInterviewSlotAtomically,
  fetchCandidateCompensation,
  updateCandidateDocsAndForms,
  updateOfferResponseStatus,
} from '../lib/firestoreService';

interface CandidatePortalViewProps {
  candidates: CandidateRecord[];
  slots: InterviewSlot[];
  initialCandidateId: string | null;
  actor: StaffUser;
  onNotify: (msg: string) => void;
}

export const CandidatePortalView: React.FC<CandidatePortalViewProps> = ({
  candidates,
  slots,
  initialCandidateId,
  actor,
  onNotify,
}) => {
  const portalEligible = candidates.filter((c) => c.currentStage >= 5);
  const [selectedId, setSelectedId] = useState<string>(
    initialCandidateId || portalEligible[0]?.id || candidates[0]?.id || ''
  );

  useEffect(() => {
    if (initialCandidateId) setSelectedId(initialCandidateId);
  }, [initialCandidateId]);

  const candidate = candidates.find((c) => c.id === selectedId) || portalEligible[0] || candidates[0];

  const [spmFile, setSpmFile] = useState('');
  const [uecFile, setUecFile] = useState('');
  const [degreeFile, setDegreeFile] = useState('');
  const [transcriptFile, setTranscriptFile] = useState('');
  const [comp, setComp] = useState<CandidatePrivateCompensation | null>(null);
  const [offerNote, setOfferNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadOffer() {
      if (!candidate || candidate.offerStatus === 'none' || actor.role !== 'hr_admin') {
        setComp(null);
        return;
      }
      try {
        const data = await fetchCandidateCompensation(candidate.id, actor, false);
        if (active) setComp(data);
      } catch {
        if (active) setComp(null);
      }
    }
    void loadOffer();
    return () => {
      active = false;
    };
  }, [candidate, actor]);

  if (!candidate) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-500">
        No candidates are currently registered in the workspace. Register a candidate or load the sample pipeline to preview the Candidate Self-Service Portal.
      </div>
    );
  }

  const availableSlots = slots.filter((s) => s.status === 'available');

  const handleCandidateSubmitDocs = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateCandidateDocsAndForms({
        actor,
        candidate,
        employmentFormCompleted: true,
        discFormCompleted: true,
        discProfile: candidate.discProfile || 'Submitted via Portal (Pending HR Review)',
        docSpmStatus: spmFile ? 'submitted' : candidate.docSpmStatus === 'missing' ? 'submitted' : candidate.docSpmStatus,
        docUecStatus:
          candidate.docUecStatus === 'not_applicable'
            ? uecFile
              ? 'submitted'
              : 'not_applicable'
            : uecFile || candidate.docUecStatus === 'missing'
              ? 'submitted'
              : candidate.docUecStatus,
        docDegreeStatus: degreeFile ? 'submitted' : candidate.docDegreeStatus === 'missing' ? 'submitted' : candidate.docDegreeStatus,
        docTranscriptStatus: transcriptFile
          ? 'submitted'
          : candidate.docTranscriptStatus === 'missing'
            ? 'submitted'
            : candidate.docTranscriptStatus,
        fileNames: {
          spmFileName: spmFile || `${candidate.candidateCode}_SPM.pdf`,
          uecFileName: uecFile || (candidate.docUecStatus !== 'not_applicable' ? `${candidate.candidateCode}_UEC.pdf` : ''),
          degreeFileName: degreeFile || `${candidate.candidateCode}_Degree.pdf`,
          transcriptFileName: transcriptFile || `${candidate.candidateCode}_Transcript.pdf`,
        },
      });
      onNotify(`Candidate ${candidate.fullName} submitted forms & Malaysian academic documents (Stage 6 -> Stage 7).`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Submission failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSelfBookSlot = async (slotId: string) => {
    setBusy(true);
    setError(null);
    try {
      const locked = await bookInterviewSlotAtomically({
        actor,
        candidate,
        slotId,
      });
      onNotify(
        `Slot ${locked.date} (${locked.startTime}) atomically locked for ${candidate.fullName}! Confirmation email logged.`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to lock slot.');
    } finally {
      setBusy(false);
    }
  };

  const handleCandidateOfferDecision = async (accepted: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await updateOfferResponseStatus({
        actor,
        candidate,
        offerStatus: accepted ? 'accepted' : 'rejected',
        responseNote:
          offerNote.trim() ||
          (accepted ? 'Candidate confirmed acceptance via Self-Service Portal.' : 'Candidate declined offer via Self-Service Portal.'),
      });
      onNotify(
        accepted
          ? `${candidate.fullName} accepted the Employment Offer! Stage 15 Final Status recorded.`
          : `${candidate.fullName} declined the Employment Offer. Stage 15 Final Status recorded.`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to record offer response.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Selector Bar to Preview Any Candidate's Live Portal Link */}
      <div className="bg-slate-900 text-white rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-teal-400 font-semibold">Candidate Self-Service Portal Preview</div>
          <p className="text-xs text-slate-300 mt-0.5">
            Select any candidate below to test Stage 6 Document Upload, Stage 10 Atomic Interview Booking, or Stage 15 Offer Acceptance.
          </p>
        </div>
        <select
          value={candidate.id}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setError(null);
          }}
          className="px-3 py-2 text-xs font-medium bg-slate-800 text-white border border-slate-700 rounded-md focus:outline-none focus:border-teal-500 min-w-[260px]"
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              S{String(c.currentStage).padStart(2, '0')} · {c.fullName} ({c.positionApplied})
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
          {error}
        </div>
      )}

      {/* Candidate Portal Main Card */}
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
        {/* Candidate Welcome Banner */}
        <div className="p-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500 font-mono tabular-nums">
              Application Ref: {candidate.candidateCode}
            </div>
            <h2 className="font-display text-xl font-bold text-slate-900 mt-1">
              Welcome, {candidate.fullName}
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Position: <strong>{candidate.positionApplied}</strong> · {candidate.department}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold text-teal-700">
              Stage {String(candidate.currentStage).padStart(2, '0')} · {getStageTitle(candidate.currentStage)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{STATUS_META[candidate.status].label}</div>
          </div>
        </div>

        {/* Section A: Stage 5-6 Forms & Malaysian Academic Document Submission */}
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <FileUp className="w-4 h-4 text-teal-700" />
            <h3 className="font-display text-sm font-bold text-slate-900">
              Step 1 · Official Google Apps Script Forms & Malaysian Academic Documents
            </h3>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <a
              href={GOOGLE_APPS_SCRIPT_URLS.employmentApplicationForm}
              target="_blank"
              rel="noopener noreferrer"
              className="p-3.5 border border-slate-200 hover:border-teal-600 rounded-md flex items-center justify-between transition-colors"
            >
              <div>
                <div className="font-semibold text-slate-900">A. Employment Application Form</div>
                <div className="text-slate-500 mt-0.5">
                  Status: {candidate.employmentFormCompleted ? 'Completed' : 'Action Required'}
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-teal-700 shrink-0" />
            </a>

            <a
              href={GOOGLE_APPS_SCRIPT_URLS.discPersonalityAssessment}
              target="_blank"
              rel="noopener noreferrer"
              className="p-3.5 border border-slate-200 hover:border-teal-600 rounded-md flex items-center justify-between transition-colors"
            >
              <div>
                <div className="font-semibold text-slate-900">B. DISC Personality Assessment</div>
                <div className="text-slate-500 mt-0.5">
                  Status: {candidate.discFormCompleted ? 'Completed' : 'Action Required'}
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-teal-700 shrink-0" />
            </a>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 text-xs pt-2">
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                SPM Examination Results (Mandatory) · <span className="text-slate-500">{candidate.docSpmStatus}</span>
              </label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setSpmFile(e.target.files?.[0]?.name || '')}
                className="block w-full text-xs text-slate-600 border border-slate-200 rounded p-1.5"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                UEC Examination Results (If Applicable) · <span className="text-slate-500">{candidate.docUecStatus}</span>
              </label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setUecFile(e.target.files?.[0]?.name || '')}
                className="block w-full text-xs text-slate-600 border border-slate-200 rounded p-1.5"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                University Degree Certificate (Mandatory) · <span className="text-slate-500">{candidate.docDegreeStatus}</span>
              </label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setDegreeFile(e.target.files?.[0]?.name || '')}
                className="block w-full text-xs text-slate-600 border border-slate-200 rounded p-1.5"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                University Academic Transcript (Mandatory) · <span className="text-slate-500">{candidate.docTranscriptStatus}</span>
              </label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setTranscriptFile(e.target.files?.[0]?.name || '')}
                className="block w-full text-xs text-slate-600 border border-slate-200 rounded p-1.5"
              />
            </div>
          </div>

          {candidate.currentStage >= 5 && candidate.currentStage <= 7 && (
            <button
              type="button"
              disabled={busy}
              onClick={handleCandidateSubmitDocs}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-md cursor-pointer"
            >
              {busy ? 'Submitting Documents...' : 'Confirm Forms & Submit Academic Documents'}
            </button>
          )}
        </div>

        {/* Section B: Stage 10 Self-Service Atomic Interview Slot Selection */}
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarCheck2 className="w-4 h-4 text-teal-700" />
              <h3 className="font-display text-sm font-bold text-slate-900">
                Step 2 · Self-Service Interview Slot Selection (Stage 10 Atomic Lock)
              </h3>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-700" />
              <span>Double-Booking Protected</span>
            </span>
          </div>

          {candidate.interviewSlotId ? (
            <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-md text-xs text-emerald-900 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
              <div>
                <div className="font-semibold">
                  Confirmed Interview: <span className="font-mono">{candidate.interviewDate} · {candidate.interviewTime} MYT</span>
                </div>
                <div className="text-emerald-800 mt-0.5">
                  {candidate.interviewMode} · Panelist: {candidate.interviewerName}
                </div>
              </div>
            </div>
          ) : candidate.qualificationDecision !== 'qualified' ? (
            <p className="text-xs text-slate-500">
              Self-service interview slot booking unlocks automatically once HR completes Stage 8 Qualification Verification.
            </p>
          ) : availableSlots.length === 0 ? (
            <p className="text-xs text-slate-500">
              All current slots are reserved. HR will publish additional interview slots shortly.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {availableSlots.map((slot) => (
                <div
                  key={slot.id}
                  className="p-4 border border-slate-200 rounded-md flex items-center justify-between gap-3 hover:border-teal-600 transition-colors"
                >
                  <div className="text-xs">
                    <div className="font-mono tabular-nums font-semibold text-slate-900">
                      {slot.date} · {slot.startTime}–{slot.endTime}
                    </div>
                    <div className="text-slate-600 mt-0.5">{slot.mode} · {slot.interviewerName}</div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleSelfBookSlot(slot.id)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Reserve Slot
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section C: Stage 14-15 Employment Offer Acceptance */}
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Handshake className="w-4 h-4 text-teal-700" />
            <h3 className="font-display text-sm font-bold text-slate-900">
              Step 3 · Official Employment Offer Response (Stage 15)
            </h3>
          </div>

          {candidate.offerStatus === 'none' ? (
            <p className="text-xs text-slate-500">
              No employment offer has been issued yet. Once approved after interview, your official MYR offer details will appear here.
            </p>
          ) : candidate.offerStatus === 'accepted' ? (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-900 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
              <div>
                <div className="font-semibold">Employment Offer Accepted (Stage 15 Completed)</div>
                <div className="mt-0.5">{candidate.finalDecisionNotes}</div>
              </div>
            </div>
          ) : candidate.offerStatus === 'rejected' || candidate.offerStatus === 'expired' ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md text-xs text-red-900 flex items-center gap-3">
              <XCircle className="w-5 h-5 text-red-700 shrink-0" />
              <div>
                <div className="font-semibold">Offer Status: {candidate.offerStatus.toUpperCase()}</div>
                <div className="mt-0.5">{candidate.finalDecisionNotes}</div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {comp && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-2 text-xs">
                  <div className="grid sm:grid-cols-3 gap-3 font-mono tabular-nums">
                    <div>
                      <span className="text-slate-500 block font-sans">Base Monthly Salary</span>
                      <strong className="text-slate-900 text-sm">{formatMYR(comp.monthlySalaryMYR)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-sans">Fixed Allowance</span>
                      <strong className="text-slate-900 text-sm">{formatMYR(comp.allowanceMYR)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block font-sans">Start Date / Deadline</span>
                      <strong className="text-slate-900">{comp.startDate}</strong>
                    </div>
                  </div>
                  <p className="text-slate-600 pt-2 border-t border-slate-200 leading-relaxed">
                    {comp.offerTermsSummary}
                  </p>
                </div>
              )}

              <input
                type="text"
                value={offerNote}
                onChange={(e) => setOfferNote(e.target.value)}
                placeholder="Optional message to HR (e.g. confirming start date or notice period)..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-teal-700"
              />

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleCandidateOfferDecision(true)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-md cursor-pointer"
                >
                  Accept Employment Offer
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleCandidateOfferDecision(false)}
                  className="px-4 py-2 text-xs font-semibold text-red-700 bg-white border border-red-300 hover:bg-red-50 disabled:opacity-50 rounded-md cursor-pointer"
                >
                  Decline Offer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
