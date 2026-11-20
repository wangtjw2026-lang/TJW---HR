import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  BellRing,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  FileText,
  GraduationCap,
  Link2,
  Mail,
  MapPin,
  Phone,
  Printer,
  Send,
  Star,
  Trash2,
  Upload,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  bookInterviewSlotAtomically,
  deleteCandidate,
  getProtectedFileUrl,
  sendDocReminder,
  sendEmploymentOffer,
  submitPostInterviewDecision,
  submitQualificationDecision,
  submitScreeningDecision,
  updateBookingStatus,
  updateCandidateDocsChecklist,
  updateOfferStatus,
  uploadCandidateDocument,
} from '../lib/apiService';
import { formatMYR, formatTimestamp, getDoc, getMissingMandatoryDocs } from '../lib/atsHelpers';
import {
  CandidateRecord,
  DocType,
  GOOGLE_APPS_SCRIPT_URLS,
  InterviewSlot,
  OfferStatus,
  PostInterviewDecision,
  QualificationStatus,
  ScreeningDecision,
  StaffUser,
  STATUS_META,
  WORKFLOW_STAGES,
} from '../types/ats';

interface CandidateDetailDrawerProps {
  candidate: CandidateRecord;
  slots: InterviewSlot[];
  staffUser: StaffUser;
  onClose: () => void;
  onUpdated: (updated?: CandidateRecord) => Promise<void> | void;
  onNotify: (message: string) => void;
  onOpenPortalPreview: (candidate: CandidateRecord) => void;
}

type DrawerTab = 'overview' | 'documents' | 'interview' | 'offer';

const DOC_META: Array<{
  type: DocType;
  label: string;
  requiredLabel: string;
  allowUpload: boolean;
  externalUrl?: string;
}> = [
  {
    type: 'APP_FORM',
    label: 'Employment Application Form',
    requiredLabel: 'Mandatory · Google Apps Script',
    allowUpload: false,
    externalUrl: GOOGLE_APPS_SCRIPT_URLS.employmentApplicationForm,
  },
  {
    type: 'DISC',
    label: 'DISC Personality Assessment',
    requiredLabel: 'Mandatory · Google Apps Script',
    allowUpload: false,
    externalUrl: GOOGLE_APPS_SCRIPT_URLS.discPersonalityAssessment,
  },
  {
    type: 'SPM',
    label: 'SPM Examination Results',
    requiredLabel: 'Mandatory Academic Doc',
    allowUpload: true,
  },
  {
    type: 'UEC',
    label: 'UEC Examination Results',
    requiredLabel: 'If Applicable (Independent Schools)',
    allowUpload: true,
  },
  {
    type: 'DEGREE',
    label: 'University Degree Certificate',
    requiredLabel: 'Mandatory Academic Doc',
    allowUpload: true,
  },
  {
    type: 'TRANSCRIPT',
    label: 'University Academic Transcript',
    requiredLabel: 'Mandatory Academic Doc',
    allowUpload: true,
  },
];

export const CandidateDetailDrawer: React.FC<CandidateDetailDrawerProps> = ({
  candidate,
  slots,
  staffUser,
  onClose,
  onUpdated,
  onNotify,
  onOpenPortalPreview,
}) => {
  const isHrAdmin = staffUser.role === 'HR_ADMIN';

  const [activeTab, setActiveTab] = useState<DrawerTab>(() => {
    if (candidate.stage >= 13) return 'offer';
    if (candidate.stage >= 9) return 'interview';
    if (candidate.stage >= 5) return 'documents';
    return 'overview';
  });

  const [busy, setBusy] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState<DocType | null>(null);
  const [error, setError] = useState('');
  const [copiedPortal, setCopiedPortal] = useState(false);

  // Stage 3-4 Screening
  const [screeningRemarks, setScreeningRemarks] = useState(candidate.screening_remarks || '');

  // Stage 5-8 Docs & Qualification
  const [discProfile, setDiscProfile] = useState(candidate.disc_profile || '');
  const [docFlags, setDocFlags] = useState<
    Record<DocType, { completed: boolean; verified: boolean; not_applicable: boolean }>
  >(() => buildDocFlags(candidate));
  const [qualRemarks, setQualRemarks] = useState(candidate.qualification_remarks || '');

  // Stage 9-12 Interview
  const [selectedSlotId, setSelectedSlotId] = useState<number | ''>('');
  const [interviewFeedback, setInterviewFeedback] = useState(candidate.interview_feedback || '');
  const [interviewRating, setInterviewRating] = useState<number>(candidate.interview_rating || 4);
  const [finalNotes, setFinalNotes] = useState(candidate.final_decision_notes || '');

  // Stage 13-15 Offer
  const [offerSalary, setOfferSalary] = useState<number>(candidate.offer?.salary_myr ?? 7500);
  const [offerAllowance, setOfferAllowance] = useState<number>(candidate.offer?.allowance_myr ?? 500);
  const [offerProbation, setOfferProbation] = useState<number>(candidate.offer?.probation_months ?? 3);
  const [offerStartDate, setOfferStartDate] = useState<string>(
    candidate.offer?.start_date || new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10)
  );
  const [offerDeadline, setOfferDeadline] = useState<string>(
    candidate.offer?.deadline_date || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  );
  const [offerTerms, setOfferTerms] = useState<string>(
    candidate.offer?.offer_terms_summary ||
      'EPF (13% employer), SOCSO & EIS statutory contributions, Outpatient & Hospitalization Medical Coverage, 14 Days Annual Leave.'
  );
  const [offerLetterFile, setOfferLetterFile] = useState<File | null>(null);
  const [offerResponseNote, setOfferResponseNote] = useState<string>(
    candidate.offer?.candidate_response_note || ''
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setScreeningRemarks(candidate.screening_remarks || '');
    setDiscProfile(candidate.disc_profile || '');
    setDocFlags(buildDocFlags(candidate));
    setQualRemarks(candidate.qualification_remarks || '');
    setInterviewFeedback(candidate.interview_feedback || '');
    setInterviewRating(candidate.interview_rating || 4);
    setFinalNotes(candidate.final_decision_notes || '');
    if (candidate.offer) {
      if (candidate.offer.salary_myr !== null) setOfferSalary(candidate.offer.salary_myr);
      if (candidate.offer.allowance_myr !== null) setOfferAllowance(candidate.offer.allowance_myr);
      setOfferProbation(candidate.offer.probation_months);
      setOfferStartDate(candidate.offer.start_date);
      setOfferDeadline(candidate.offer.deadline_date);
      setOfferTerms(candidate.offer.offer_terms_summary);
      setOfferResponseNote(candidate.offer.candidate_response_note || '');
    }
  }, [candidate]);

  const portalUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?portal=${candidate.portal_token}`
      : `/?portal=${candidate.portal_token}`;

  const resumeDoc = getDoc(candidate, 'RESUME');
  const missingDocs = getMissingMandatoryDocs(candidate);
  const availableSlots = slots.filter(
    (s) => s.status === 'ACTIVE' && s.booked_count < s.capacity
  );
  const statusMeta = STATUS_META[candidate.status] || { label: candidate.status, tone: 'neutral' };

  const copyPortalLink = async () => {
    try {
      await navigator.clipboard.writeText(portalUrl);
      setCopiedPortal(true);
      onNotify(`Copied candidate portal link for ${candidate.full_name}.`);
      setTimeout(() => setCopiedPortal(false), 2000);
    } catch {
      onNotify(`Portal URL: ${portalUrl}`);
    }
  };

  const handleScreening = async (decision: ScreeningDecision) => {
    setBusy(true);
    setError('');
    try {
      const updated = await submitScreeningDecision(candidate.id, decision, screeningRemarks);
      await onUpdated(updated);
      onNotify(
        decision === 'proceed'
          ? `Shortlisted ${candidate.full_name} — Forms & Academic Docs email dispatched.`
          : `Recorded screening rejection for ${candidate.full_name}.`
      );
      if (decision === 'proceed') setActiveTab('documents');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save screening decision.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveChecklist = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = DOC_META.map((m) => ({
        doc_type: m.type,
        completed: docFlags[m.type].completed,
        verified: docFlags[m.type].verified,
        not_applicable: docFlags[m.type].not_applicable,
      }));
      const updated = await updateCandidateDocsChecklist(candidate.id, payload, discProfile);
      await onUpdated(updated);
      onNotify(`Saved document & assessment verification checklist for ${candidate.full_name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save checklist.');
    } finally {
      setBusy(false);
    }
  };

  const handleFileUpload = async (docType: DocType, file: File) => {
    setUploadingDoc(docType);
    setError('');
    try {
      const updated = await uploadCandidateDocument(candidate.id, docType, file);
      await onUpdated(updated);
      onNotify(`Uploaded ${file.name} (${docType}) to secure local storage.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload document.');
    } finally {
      setUploadingDoc(null);
    }
  };

  const handleSendReminder = async () => {
    setBusy(true);
    setError('');
    try {
      const updated = await sendDocReminder(candidate.id);
      await onUpdated(updated);
      onNotify(`Dispatched document submission reminder email to ${candidate.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reminder email.');
    } finally {
      setBusy(false);
    }
  };

  const handleQualification = async (status: QualificationStatus) => {
    setBusy(true);
    setError('');
    try {
      const updated = await submitQualificationDecision(candidate.id, status, qualRemarks);
      await onUpdated(updated);
      onNotify(
        status === 'qualified'
          ? `${candidate.full_name} marked Qualified — Interview invitation sent with portal link.`
          : `${candidate.full_name} marked Not Qualified.`
      );
      if (status === 'qualified') setActiveTab('interview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save qualification decision.');
    } finally {
      setBusy(false);
    }
  };

  const handleBookSlot = async () => {
    if (!selectedSlotId) return;
    setBusy(true);
    setError('');
    try {
      const res = await bookInterviewSlotAtomically(Number(selectedSlotId), candidate.id);
      await onUpdated(res.candidate);
      setSelectedSlotId('');
      onNotify(`Atomically booked interview slot for ${candidate.full_name} — confirmation emailed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Slot could not be booked.');
    } finally {
      setBusy(false);
    }
  };

  const handleMarkInterviewStatus = async (status: 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED') => {
    if (!candidate.active_booking) return;
    setBusy(true);
    setError('');
    try {
      await updateBookingStatus(candidate.active_booking.id, status);
      await onUpdated();
      onNotify(`Interview booking updated to ${status}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update booking status.');
    } finally {
      setBusy(false);
    }
  };

  const handlePostInterview = async (decision: PostInterviewDecision) => {
    setBusy(true);
    setError('');
    try {
      const updated = await submitPostInterviewDecision(
        candidate.id,
        interviewFeedback,
        interviewRating,
        decision,
        finalNotes
      );
      await onUpdated(updated);
      onNotify(
        decision === 'offer'
          ? `Approved ${candidate.full_name} for employment offer.`
          : `Recorded post-interview rejection for ${candidate.full_name}.`
      );
      if (decision === 'offer') setActiveTab('offer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit interview evaluation.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const updated = await sendEmploymentOffer(candidate.id, {
        position: candidate.position,
        department: candidate.department,
        salary_myr: offerSalary,
        allowance_myr: offerAllowance,
        probation_months: offerProbation,
        start_date: offerStartDate,
        deadline_date: offerDeadline,
        offer_terms_summary: offerTerms,
        offerLetterFile,
      });
      setOfferLetterFile(null);
      await onUpdated(updated);
      onNotify(`Employment Offer (${formatMYR(offerSalary)}/mo) dispatched to ${candidate.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dispatch offer.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateOfferStatus = async (nextStatus: OfferStatus) => {
    setBusy(true);
    setError('');
    try {
      const updated = await updateOfferStatus(candidate.id, nextStatus, offerResponseNote);
      await onUpdated(updated);
      onNotify(`Offer status updated to "${nextStatus}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update offer status.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCandidate = async () => {
    setBusy(true);
    setError('');
    try {
      await deleteCandidate(candidate.id);
      await onUpdated();
      onNotify(`Deleted candidate record ${candidate.candidate_code}.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete candidate.');
      setBusy(false);
    }
  };

  const handlePrintOfferLetter = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#0F172A]/45 backdrop-blur-[2px]">
      <div className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl border-l border-[#E2E8F0]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] px-6 py-4 bg-[#FAFBFC]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748B]">
              <span className="font-mono font-semibold text-[#0F172A]">{candidate.candidate_code}</span>
              <span>·</span>
              <span>Stage {candidate.stage} of 15</span>
              <span>·</span>
              <span
                className={
                  statusMeta.tone === 'green'
                    ? 'font-semibold text-[#15803D]'
                    : statusMeta.tone === 'red'
                    ? 'font-semibold text-[#DC2626]'
                    : statusMeta.tone === 'amber'
                    ? 'font-semibold text-[#B45309]'
                    : statusMeta.tone === 'teal'
                    ? 'font-semibold text-[#0F766E]'
                    : 'font-semibold text-[#475569]'
                }
              >
                {statusMeta.label}
              </span>
            </div>
            <h2 className="mt-1 truncate text-xl font-bold text-[#0F172A]">{candidate.full_name}</h2>
            <p className="text-sm text-[#475569]">
              {candidate.position} <span className="text-[#94A3B8]">/</span> {candidate.department}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={copyPortalLink}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] transition-colors"
              title="Copy public candidate self-service portal URL"
            >
              {copiedPortal ? <Check className="h-3.5 w-3.5 text-[#15803D]" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedPortal ? 'Copied Link' : 'Portal Link'}
            </button>
            <button
              type="button"
              onClick={() => onOpenPortalPreview(candidate)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#0F766E]/30 bg-[#F0FDFA] px-2.5 py-1.5 text-xs font-semibold text-[#0F766E] hover:bg-[#CCFBF1] transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Portal View
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-[#64748B] hover:bg-[#E2E8F0]/60 hover:text-[#0F172A]"
              aria-label="Close drawer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 15-stage compact stepper bar */}
        <div className="border-b border-[#E2E8F0] bg-white px-6 py-2.5">
          <div className="flex items-center justify-between text-[11px] text-[#64748B] mb-1.5">
            <span className="font-semibold text-[#334155]">
              Current Milestone: {WORKFLOW_STAGES.find((s) => s.stage === candidate.stage)?.title}
            </span>
            <span className="font-mono tabular-nums">AI Fit {candidate.ai_score}%</span>
          </div>
          <div className="grid grid-cols-15 gap-1">
            {WORKFLOW_STAGES.map((st) => {
              const reached = candidate.stage >= st.stage;
              const current = candidate.stage === st.stage;
              return (
                <div
                  key={st.stage}
                  title={`Stage ${st.stage}: ${st.title}`}
                  className={`h-1.5 rounded-full transition-colors ${
                    current
                      ? 'bg-[#0F766E]'
                      : reached
                      ? 'bg-[#0F766E]/45'
                      : 'bg-[#E2E8F0]'
                  }`}
                />
              );
            })}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#E2E8F0] bg-[#FAFBFC] px-6">
          {(
            [
              { id: 'overview', label: '1. Profile & Screening' },
              { id: 'documents', label: `2. Docs & Qualify${missingDocs.length > 0 ? ` (${missingDocs.length})` : ''}` },
              { id: 'interview', label: '3. Interview & Panel' },
              { id: 'offer', label: '4. Employment Offer' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                activeTab === t.id
                  ? 'border-[#0F766E] text-[#0F766E] bg-white'
                  : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#B91C1C]">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* TAB 1: OVERVIEW & SCREENING */}
          {activeTab === 'overview' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2 border border-[#E2E8F0] rounded-lg p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                    Contact & Source
                  </div>
                  <div className="flex items-center gap-2 text-[#0F172A]">
                    <Mail className="h-4 w-4 text-[#64748B]" />
                    <span className="truncate">{candidate.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#0F172A]">
                    <Phone className="h-4 w-4 text-[#64748B]" />
                    <span className="font-mono text-xs">{candidate.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#475569]">
                    <MapPin className="h-4 w-4 text-[#64748B]" />
                    <span>{candidate.location || 'Malaysia'}</span>
                  </div>
                  <div className="pt-1 flex items-center justify-between text-xs text-[#64748B] border-t border-[#F1F5F9]">
                    <span>Source: <strong className="text-[#0F172A]">{candidate.source}</strong></span>
                    <span className="font-mono">Applied {candidate.applied_date}</span>
                  </div>
                </div>

                <div className="space-y-2 border border-[#E2E8F0] rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                      AI Resume Assessment
                    </span>
                    <span className="font-mono text-sm font-bold text-[#0F766E] tabular-nums">
                      {candidate.ai_score}% Fit
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-[#334155]">
                    {candidate.ai_summary || 'Resume registered and queued for HR screening.'}
                  </p>
                  {resumeDoc && (
                    <div className="pt-2 border-t border-[#F1F5F9] flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-[#334155] truncate">
                        <FileText className="h-3.5 w-3.5 text-[#0F766E] shrink-0" />
                        <span className="truncate">{resumeDoc.file_name || 'Resume file'}</span>
                      </span>
                      {resumeDoc.file_path ? (
                        <a
                          href={getProtectedFileUrl(resumeDoc.file_path)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-[#0F766E] hover:underline shrink-0 ml-2"
                        >
                          Download
                        </a>
                      ) : (
                        <label className="cursor-pointer font-semibold text-[#0F766E] hover:underline shrink-0 ml-2">
                          {uploadingDoc === 'RESUME' ? 'Uploading...' : 'Attach PDF'}
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx,.txt"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void handleFileUpload('RESUME', file);
                            }}
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div className="border border-[#E2E8F0] rounded-lg p-4">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#64748B] mb-2">
                    <GraduationCap className="h-4 w-4 text-[#0F766E]" />
                    Education Background
                  </div>
                  <p className="text-xs leading-relaxed text-[#334155]">
                    {candidate.education || 'Not extracted.'}
                  </p>
                </div>

                <div className="border border-[#E2E8F0] rounded-lg p-4">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#64748B] mb-2">
                    <Briefcase className="h-4 w-4 text-[#0F766E]" />
                    Experience ({candidate.years_experience} yrs)
                  </div>
                  <p className="text-xs leading-relaxed text-[#334155]">
                    {candidate.experience || 'Not extracted.'}
                  </p>
                </div>
              </div>

              {candidate.skills.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#64748B] mb-2">
                    Extracted Skills & Certifications
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {candidate.skills.map((skill) => (
                      <span
                        key={skill}
                        className="rounded border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#334155]"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Stage 3-4 Screening Decision */}
              <div className="border border-[#E2E8F0] rounded-lg p-4 bg-[#FAFBFC] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-[#0F172A]">Stage 3–4 · HR Screening Decision</h3>
                    <p className="text-xs text-[#64748B]">
                      Selecting &ldquo;Proceed to Next Stage&rdquo; automatically sends the Employment Application Form, DISC Assessment, and Academic Docs instructions via email.
                    </p>
                  </div>
                  <span className="font-mono text-xs font-semibold uppercase text-[#475569]">
                    Current: {candidate.screening_decision}
                  </span>
                </div>

                <textarea
                  value={screeningRemarks}
                  onChange={(e) => setScreeningRemarks(e.target.value)}
                  rows={3}
                  placeholder="Enter HR initial resume screening notes (e.g., relevant Malaysian statutory experience, technical fit, salary expectations)..."
                  className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
                />

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleScreening('proceed')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Proceed to Next Stage &amp; Auto-Send Forms
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleScreening('reject')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#FECACA] bg-white px-3.5 py-2 text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Reject at Screening
                  </button>
                </div>
              </div>

              {isHrAdmin && (
                <div className="border-t border-[#E2E8F0] pt-4 flex items-center justify-between">
                  <span className="text-xs text-[#64748B]">
                    Record created {formatTimestamp(candidate.created_at)}
                  </span>
                  {!confirmDelete ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#DC2626] hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Candidate Record
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[#DC2626]">Confirm permanent delete?</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleDeleteCandidate}
                        className="rounded bg-[#DC2626] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#B91C1C]"
                      >
                        Yes, Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="rounded border border-[#CBD5E1] px-2.5 py-1 text-xs text-[#475569]"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* TAB 2: DOCUMENTS, FORMS & QUALIFICATION */}
          {activeTab === 'documents' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border border-[#E2E8F0] rounded-lg p-4 bg-[#FAFBFC]">
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    Stage 5–7 · Forms, DISC &amp; Malaysian Academic Documents
                  </h3>
                  <p className="text-xs text-[#64748B]">
                    {missingDocs.length === 0
                      ? 'All mandatory forms and academic certificates are complete.'
                      : `${missingDocs.length} mandatory item(s) still pending: ${missingDocs.join(', ')}`}
                  </p>
                  {candidate.last_doc_reminder_at && (
                    <p className="mt-1 text-[11px] font-mono text-[#64748B]">
                      Last reminder emailed: {formatTimestamp(candidate.last_doc_reminder_at)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSendReminder}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#F59E0B] bg-[#FFFBEB] px-3 py-1.5 text-xs font-semibold text-[#B45309] hover:bg-[#FEF3C7] disabled:opacity-50"
                >
                  <BellRing className="h-3.5 w-3.5" />
                  Send Document Reminder Email
                </button>
              </div>

              {/* Checklist table */}
              <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B] uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="px-3.5 py-2.5 font-semibold">Requirement</th>
                      <th className="px-3 py-2.5 font-semibold text-center">Submitted</th>
                      <th className="px-3 py-2.5 font-semibold text-center">HR Verified</th>
                      <th className="px-3 py-2.5 font-semibold text-center">N/A</th>
                      <th className="px-3.5 py-2.5 font-semibold text-right">File / Link</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {DOC_META.map((item) => {
                      const doc = getDoc(candidate, item.type);
                      const flag = docFlags[item.type];
                      return (
                        <tr key={item.type} className="hover:bg-[#FAFBFC]">
                          <td className="px-3.5 py-3">
                            <div className="font-semibold text-[#0F172A]">{item.label}</div>
                            <div className="text-[11px] text-[#64748B]">{item.requiredLabel}</div>
                            {doc?.file_name && (
                              <div className="mt-0.5 font-mono text-[11px] text-[#0F766E] truncate max-w-[230px]">
                                {doc.file_name}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={flag.completed}
                              disabled={flag.not_applicable}
                              onChange={(e) =>
                                setDocFlags((prev) => ({
                                  ...prev,
                                  [item.type]: { ...prev[item.type], completed: e.target.checked },
                                }))
                              }
                              className="h-4 w-4 accent-[#0F766E]"
                            />
                          </td>
                          <td className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={flag.verified}
                              disabled={flag.not_applicable}
                              onChange={(e) =>
                                setDocFlags((prev) => ({
                                  ...prev,
                                  [item.type]: {
                                    ...prev[item.type],
                                    verified: e.target.checked,
                                    completed: e.target.checked ? true : prev[item.type].completed,
                                  },
                                }))
                              }
                              className="h-4 w-4 accent-[#15803D]"
                            />
                          </td>
                          <td className="px-3 py-3 text-center">
                            {item.type === 'UEC' ? (
                              <input
                                type="checkbox"
                                checked={flag.not_applicable}
                                onChange={(e) =>
                                  setDocFlags((prev) => ({
                                    ...prev,
                                    [item.type]: {
                                      completed: false,
                                      verified: false,
                                      not_applicable: e.target.checked,
                                    },
                                  }))
                                }
                                className="h-4 w-4 accent-[#64748B]"
                              />
                            ) : (
                              <span className="text-[#CBD5E1]">—</span>
                            )}
                          </td>
                          <td className="px-3.5 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              {item.externalUrl && (
                                <a
                                  href={item.externalUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F766E] hover:underline"
                                >
                                  <Link2 className="h-3 w-3" />
                                  Open Form
                                </a>
                              )}
                              {doc?.file_path && (
                                <a
                                  href={getProtectedFileUrl(doc.file_path)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F766E] hover:underline"
                                >
                                  View PDF
                                </a>
                              )}
                              {item.allowUpload && !flag.not_applicable && (
                                <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-medium text-[#334155] hover:bg-[#F8FAFC]">
                                  <Upload className="h-3 w-3" />
                                  {uploadingDoc === item.type ? 'Saving...' : 'Upload'}
                                  <input
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png"
                                    className="hidden"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) void handleFileUpload(item.type, f);
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-xs font-semibold text-[#334155] mb-1">
                    DISC Personality Profile Result
                  </label>
                  <input
                    type="text"
                    value={discProfile}
                    onChange={(e) => setDiscProfile(e.target.value)}
                    placeholder="e.g., High D / C — Analytical Driver"
                    className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSaveChecklist}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E293B] disabled:opacity-50"
                >
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  Save Checklist Verification
                </button>
              </div>

              {/* Stage 8 Qualification */}
              <div className="border border-[#E2E8F0] rounded-lg p-4 bg-[#FAFBFC] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-[#0F172A]">Stage 8 · Qualification Decision</h3>
                    <p className="text-xs text-[#64748B]">
                      Marking a candidate Qualified automatically dispatches the Interview Invitation email with their self-service slot booking link.
                    </p>
                  </div>
                  <span className="font-mono text-xs font-semibold uppercase text-[#475569]">
                    Status: {candidate.qualification_status}
                  </span>
                </div>

                <textarea
                  value={qualRemarks}
                  onChange={(e) => setQualRemarks(e.target.value)}
                  rows={2}
                  placeholder="Enter qualification review remarks (SPM/UEC/Degree verification, DISC team fit)..."
                  className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
                />

                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleQualification('qualified')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    Mark Qualified &amp; Send Interview Invite
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleQualification('not_qualified')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#FECACA] bg-white px-3.5 py-2 text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Mark Not Qualified
                  </button>
                </div>
              </div>
            </>
          )}

          {/* TAB 3: INTERVIEW & PANEL EVALUATION */}
          {activeTab === 'interview' && (
            <>
              <div className="border border-[#E2E8F0] rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-bold text-[#0F172A]">
                  Stage 9–10 · Interview Slot Booking
                </h3>

                {candidate.active_booking ? (
                  <div className="rounded-md border border-[#99F6E4] bg-[#F0FDFA] p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0F766E]">
                        <Calendar className="h-4 w-4" />
                        {candidate.active_booking.date} · {candidate.active_booking.start_time} – {candidate.active_booking.end_time}
                      </span>
                      <span className="font-mono text-xs font-semibold text-[#0F766E]">
                        {candidate.active_booking.status}
                      </span>
                    </div>
                    <div className="text-xs text-[#334155]">
                      Panelist: <strong>{candidate.active_booking.interviewer_name}</strong> ·{' '}
                      {candidate.active_booking.mode}
                    </div>
                    <div className="text-xs text-[#475569] break-all">
                      Location / Link: {candidate.active_booking.location_or_link}
                    </div>

                    <div className="pt-2 flex flex-wrap gap-2 border-t border-[#CCFBF1]">
                      {candidate.active_booking.status !== 'COMPLETED' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleMarkInterviewStatus('COMPLETED')}
                          className="rounded bg-[#0F766E] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#115E59]"
                        >
                          Mark Interview Conducted
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleMarkInterviewStatus('RESCHEDULED')}
                        className="rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC]"
                      >
                        Release Slot (Reschedule)
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleMarkInterviewStatus('CANCELLED')}
                        className="rounded border border-[#FECACA] bg-white px-2.5 py-1 text-xs font-medium text-[#DC2626] hover:bg-[#FEF2F2]"
                      >
                        Cancel Booking
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-[#64748B]">
                      No active booking yet. The candidate can book directly via their portal link, or HR can assign an open slot atomically below:
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={selectedSlotId}
                        onChange={(e) => setSelectedSlotId(e.target.value ? Number(e.target.value) : '')}
                        className="flex-1 min-w-[240px] rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
                      >
                        <option value="">Select available HR interview slot...</option>
                        {availableSlots.map((slot) => (
                          <option key={slot.id} value={slot.id}>
                            {slot.date} ({slot.start_time}–{slot.end_time}) · {slot.interviewer_name} ·{' '}
                            {slot.capacity - slot.booked_count} seat(s) left
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy || !selectedSlotId}
                        onClick={handleBookSlot}
                        className="rounded-md bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
                      >
                        Confirm Slot
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Stage 11-12 Post-Interview Evaluation */}
              <div className="border border-[#E2E8F0] rounded-lg p-4 bg-[#FAFBFC] space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    Stage 11–12 · Panel Evaluation &amp; Post-Interview Decision
                  </h3>
                  <span className="font-mono text-xs font-semibold uppercase text-[#475569]">
                    Decision: {candidate.post_interview_decision}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#334155] mb-1">
                    Panel Rating (1–5)
                  </label>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setInterviewRating(n)}
                        className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-semibold ${
                          interviewRating === n
                            ? 'border-[#0F766E] bg-[#0F766E] text-white'
                            : 'border-[#CBD5E1] bg-white text-[#475569]'
                        }`}
                      >
                        <Star className="h-3 w-3" />
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#334155] mb-1">
                    Interview Panel Feedback
                  </label>
                  <textarea
                    value={interviewFeedback}
                    onChange={(e) => setInterviewFeedback(e.target.value)}
                    rows={3}
                    placeholder="Document technical competency, leadership, communication, and cultural alignment..."
                    className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#334155] mb-1">
                    Final Hiring Panel Notes
                  </label>
                  <input
                    type="text"
                    value={finalNotes}
                    onChange={(e) => setFinalNotes(e.target.value)}
                    placeholder="Recommended band, notice period, or rejection summary..."
                    className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handlePostInterview('offer')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Approve for Employment Offer
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handlePostInterview('reject')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#FECACA] bg-white px-3.5 py-2 text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Reject Post-Interview
                  </button>
                </div>
              </div>
            </>
          )}

          {/* TAB 4: EMPLOYMENT OFFER */}
          {activeTab === 'offer' && (
            <>
              {!isHrAdmin ? (
                <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFBFC] p-5 space-y-2">
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    Confidential Compensation &amp; Offer Management
                  </h3>
                  <p className="text-xs text-[#475569]">
                    MYR salary packages, allowances, and offer letter issuance are restricted to{' '}
                    <strong>HR Admin</strong> accounts.
                  </p>
                  {candidate.offer ? (
                    <div className="pt-2 border-t border-[#E2E8F0] text-xs text-[#334155] space-y-1">
                      <div>
                        Offer Status: <strong>{candidate.offer.status}</strong>
                      </div>
                      <div>Start Date: {candidate.offer.start_date}</div>
                      <div>Response Deadline: {candidate.offer.deadline_date}</div>
                    </div>
                  ) : (
                    <p className="text-xs text-[#64748B]">No employment offer has been issued yet.</p>
                  )}
                </div>
              ) : (
                <>
                  {/* Offer Builder / Revision Form */}
                  <form
                    onSubmit={handleSendOffer}
                    className="border border-[#E2E8F0] rounded-lg p-4 space-y-4 bg-white"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-[#0F172A]">
                          Stage 13 · Malaysian Employment Offer Builder (MYR)
                        </h3>
                        <p className="text-xs text-[#64748B]">
                          Issuing an offer stores the record in SQLite, attaches the PDF to local storage, and emails the candidate portal link.
                        </p>
                      </div>
                      {candidate.offer && (
                        <button
                          type="button"
                          onClick={handlePrintOfferLetter}
                          className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC]"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          Print Offer
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#334155] mb-1">
                          Monthly Basic Salary (RM)
                        </label>
                        <input
                          type="number"
                          required
                          min={1500}
                          step={100}
                          value={offerSalary}
                          onChange={(e) => setOfferSalary(Number(e.target.value))}
                          className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs font-mono text-[#0F172A]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#334155] mb-1">
                          Monthly Allowance (RM)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={50}
                          value={offerAllowance}
                          onChange={(e) => setOfferAllowance(Number(e.target.value))}
                          className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs font-mono text-[#0F172A]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#334155] mb-1">
                          Probation (Months)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={offerProbation}
                          onChange={(e) => setOfferProbation(Number(e.target.value))}
                          className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs font-mono text-[#0F172A]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#334155] mb-1">
                          Commencement Date
                        </label>
                        <input
                          type="date"
                          required
                          value={offerStartDate}
                          onChange={(e) => setOfferStartDate(e.target.value)}
                          className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs text-[#0F172A]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#334155] mb-1">
                          Offer Acceptance Deadline
                        </label>
                        <input
                          type="date"
                          required
                          value={offerDeadline}
                          onChange={(e) => setOfferDeadline(e.target.value)}
                          className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs text-[#0F172A]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#334155] mb-1">
                        Statutory &amp; Benefits Terms Summary
                      </label>
                      <textarea
                        rows={2}
                        value={offerTerms}
                        onChange={(e) => setOfferTerms(e.target.value)}
                        className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs text-[#0F172A]"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 text-xs font-medium text-[#334155] hover:bg-[#F1F5F9]">
                        <Upload className="h-3.5 w-3.5 text-[#0F766E]" />
                        {offerLetterFile
                          ? `Attached: ${offerLetterFile.name}`
                          : candidate.offer?.offer_letter_path
                          ? 'Replace Offer Letter PDF'
                          : 'Attach Official Offer Letter (PDF)'}
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx"
                          className="hidden"
                          onChange={(e) => setOfferLetterFile(e.target.files?.[0] || null)}
                        />
                      </label>

                      <button
                        type="submit"
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#0F766E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {candidate.offer ? 'Update & Re-Send Offer' : 'Issue Employment Offer'}
                      </button>
                    </div>
                  </form>

                  {/* Stage 14-15 Offer Tracking */}
                  {candidate.offer && (
                    <div className="border border-[#E2E8F0] rounded-lg p-4 bg-[#FAFBFC] space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-bold text-[#0F172A]">
                            Stage 14–15 · Offer Response Tracking
                          </h3>
                          <p className="text-xs text-[#64748B]">
                            Package: <strong className="text-[#0F172A]">{formatMYR(candidate.offer.salary_myr)}</strong> basic +{' '}
                            {formatMYR(candidate.offer.allowance_myr)} allowance · Start {candidate.offer.start_date}
                          </p>
                        </div>
                        <span className="font-mono text-xs font-bold text-[#0F766E]">
                          {candidate.offer.status}
                        </span>
                      </div>

                      {candidate.offer.offer_letter_path && (
                        <div className="text-xs">
                          <a
                            href={getProtectedFileUrl(candidate.offer.offer_letter_path)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 font-semibold text-[#0F766E] hover:underline"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Download Attached Offer Letter
                          </a>
                        </div>
                      )}

                      <input
                        type="text"
                        value={offerResponseNote}
                        onChange={(e) => setOfferResponseNote(e.target.value)}
                        placeholder="Candidate response note (e.g., Signed offer received, notice period buyout)..."
                        className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A]"
                      />

                      <div className="flex flex-wrap gap-2">
                        {(
                          ['Pending Response', 'Accepted', 'Rejected', 'Expired'] as OfferStatus[]
                        ).map((st) => (
                          <button
                            key={st}
                            type="button"
                            disabled={busy}
                            onClick={() => handleUpdateOfferStatus(st)}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold border transition-colors ${
                              candidate.offer?.status === st
                                ? 'border-[#0F766E] bg-[#0F766E] text-white'
                                : st === 'Accepted'
                                ? 'border-[#BBF7D0] bg-white text-[#15803D] hover:bg-[#F0FDF4]'
                                : st === 'Rejected' || st === 'Expired'
                                ? 'border-[#FECACA] bg-white text-[#DC2626] hover:bg-[#FEF2F2]'
                                : 'border-[#CBD5E1] bg-white text-[#334155] hover:bg-[#F8FAFC]'
                            }`}
                          >
                            Mark {st}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

function buildDocFlags(
  candidate: CandidateRecord
): Record<DocType, { completed: boolean; verified: boolean; not_applicable: boolean }> {
  const types: DocType[] = ['RESUME', 'APP_FORM', 'DISC', 'SPM', 'UEC', 'DEGREE', 'TRANSCRIPT'];
  const result = {} as Record<
    DocType,
    { completed: boolean; verified: boolean; not_applicable: boolean }
  >;
  for (const t of types) {
    const found = candidate.documents.find((d) => d.doc_type === t);
    result[t] = {
      completed: Boolean(found?.completed),
      verified: Boolean(found?.verified),
      not_applicable: Boolean(found?.not_applicable),
    };
  }
  return result;
}
