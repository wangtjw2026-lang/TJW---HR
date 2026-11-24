import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BellRing,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Eye,
  ExternalLink,
  FileText,
  GraduationCap,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Printer,
  RefreshCw,
  Send,
  Sparkles,
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
  logWhatsAppOutreach,
  reanalyzeDocumentWithAi,
  resendEmailLog,
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
import {
  buildWhatsAppMessage,
  formatMalaysiaWhatsAppUrl,
  formatMYR,
  formatTimestamp,
  getDefaultWhatsAppTemplateKey,
  getDoc,
  getMissingMandatoryDocs,
  getWhatsAppTemplateLabel,
  normalizeMalaysiaMobile,
  openExternalWhatsAppUrl,
  resolveCandidatePortalUrl,
  WHATSAPP_TEMPLATES,
  WhatsAppTemplateKey,
} from '../lib/atsHelpers';
import {
  CandidateDocument,
  CandidateRecord,
  DocType,
  EmailLogRecord,
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
}> = [
  {
    type: 'APPLICATION_FORM',
    label: 'Employment Application Form',
    requiredLabel: 'Mandatory · Direct File Upload',
    allowUpload: true,
  },
  {
    type: 'DISC',
    label: 'DISC Assessment Report / Sheet',
    requiredLabel: 'Mandatory · Direct File Upload',
    allowUpload: true,
  },
  {
    type: 'VAKAD',
    label: 'VAKAD Assessment Report / Sheet',
    requiredLabel: 'Mandatory · Direct File Upload',
    allowUpload: true,
  },
  {
    type: 'SPM',
    label: 'SPM Examination Results',
    requiredLabel: 'Mandatory · Academic Document',
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
    requiredLabel: 'Mandatory · Academic Document',
    allowUpload: true,
  },
  {
    type: 'TRANSCRIPT',
    label: 'University Academic Transcript',
    requiredLabel: 'Mandatory · Academic Document',
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
  const isAdmin = staffUser.role === 'administrator';

  const [activeTab, setActiveTab] = useState<DrawerTab>(() => {
    if (candidate.stage >= 13) return 'offer';
    if (candidate.stage >= 9) return 'interview';
    if (candidate.stage >= 5) return 'documents';
    return 'overview';
  });

  const [busy, setBusy] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState<DocType | null>(null);
  const [analyzingDocId, setAnalyzingDocId] = useState<number | null>(null);
  const [resendingEmailId, setResendingEmailId] = useState<number | null>(null);
  const [emailBanner, setEmailBanner] = useState<{
    status: 'SENT_SMTP' | 'SMTP_FAILED';
    subject: string;
    recipient: string;
    error?: string;
    messageId?: string;
  } | null>(null);
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

  // WhatsApp Outreach state
  const [whatsAppTemplate, setWhatsAppTemplate] = useState<WhatsAppTemplateKey>(() =>
    getDefaultWhatsAppTemplateKey(candidate.stage)
  );
  const [whatsAppMessage, setWhatsAppMessage] = useState<string>(() =>
    buildWhatsAppMessage(candidate, getDefaultWhatsAppTemplateKey(candidate.stage))
  );
  const [whatsAppPopoverOpen, setWhatsAppPopoverOpen] = useState(false);

  useEffect(() => {
    setScreeningRemarks(candidate.screening_remarks || '');
    setDiscProfile(candidate.disc_profile || '');
    setDocFlags(buildDocFlags(candidate));
    setQualRemarks(candidate.qualification_remarks || '');
    setInterviewFeedback(candidate.interview_feedback || '');
    setInterviewRating(candidate.interview_rating || 4);
    setFinalNotes(candidate.final_decision_notes || '');
    const defaultTpl = getDefaultWhatsAppTemplateKey(candidate.stage);
    setWhatsAppTemplate(defaultTpl);
    setWhatsAppMessage(buildWhatsAppMessage(candidate, defaultTpl));
    setWhatsAppPopoverOpen(false);
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

  const normalizedWhatsAppPhone = normalizeMalaysiaMobile(candidate.phone);
  const whatsAppDisabledReason = normalizedWhatsAppPhone
    ? ''
    : 'Valid Malaysian mobile number required (e.g., 011-31832623 or +6012-3456789).';

  const handleSelectWhatsAppTemplate = (nextKey: WhatsAppTemplateKey) => {
    setWhatsAppTemplate(nextKey);
    setWhatsAppMessage(buildWhatsAppMessage(candidate, nextKey));
  };

  const handleLaunchWhatsApp = (options?: {
    templateKey?: WhatsAppTemplateKey;
    useStageDefault?: boolean;
    closePopover?: boolean;
  }) => {
    if (!isAdmin) return;
    const chosenKey = options?.templateKey
      ? options.templateKey
      : options?.useStageDefault
        ? getDefaultWhatsAppTemplateKey(candidate.stage)
        : whatsAppTemplate;

    const finalMessage =
      options?.templateKey || options?.useStageDefault
        ? buildWhatsAppMessage(candidate, chosenKey)
        : whatsAppMessage.trim() || buildWhatsAppMessage(candidate, chosenKey);

    const waUrl = formatMalaysiaWhatsAppUrl(candidate.phone, finalMessage);
    const normalized = normalizeMalaysiaMobile(candidate.phone);
    if (!waUrl || !normalized) {
      onNotify(`Cannot open WhatsApp: ${candidate.full_name} does not have a valid Malaysian mobile number.`);
      return;
    }

    openExternalWhatsAppUrl(waUrl);
    if (options?.closePopover) {
      setWhatsAppPopoverOpen(false);
    }

    const templateLabel = getWhatsAppTemplateLabel(chosenKey);
    onNotify(`Opened WhatsApp for ${candidate.full_name} (+${normalized}) · ${templateLabel}`);

    void logWhatsAppOutreach(candidate.id, {
      phone: candidate.phone,
      normalizedPhone: normalized,
      templateName: templateLabel,
      pageVisited: 'Candidate Detail Drawer',
    })
      .then(() => onUpdated())
      .catch(() => {
        // Non-blocking: WhatsApp tab already opened
      });
  };

  const portalUrl = resolveCandidatePortalUrl(candidate);

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

  const reportLatestEmailOutcome = (updated: CandidateRecord, actionLabel: string) => {
    const latest = updated.recent_emails?.[0];
    if (!latest) {
      onNotify(actionLabel);
      return;
    }
    const isSent = latest.delivery_status === 'SENT_SMTP';
    setEmailBanner({
      status: isSent ? 'SENT_SMTP' : 'SMTP_FAILED',
      subject: latest.subject,
      recipient: latest.recipient_email,
      error: latest.smtp_error || undefined,
      messageId: latest.message_id || undefined,
    });
    if (isSent) {
      onNotify(`${actionLabel} — Sent via SMTP to ${latest.recipient_email}.`);
    } else {
      onNotify(
        `${actionLabel} — SMTP Failed (${latest.recipient_email}): ${
          latest.smtp_error || 'Check Gmail SMTP settings.'
        }`
      );
    }
  };

  const handleResendCandidateEmail = async (log: EmailLogRecord) => {
    if (!isAdmin) return;
    setResendingEmailId(log.id);
    setError('');
    try {
      const res = await resendEmailLog(log.id, 'Candidate Detail Drawer');
      await onUpdated(res.candidate ?? undefined);
      const isSent = res.emailDelivery.delivery_status === 'SENT_SMTP';
      setEmailBanner({
        status: isSent ? 'SENT_SMTP' : 'SMTP_FAILED',
        subject: res.emailDelivery.subject,
        recipient: res.emailDelivery.recipient_email,
        error: res.emailDelivery.smtp_error || undefined,
        messageId: res.emailDelivery.message_id || undefined,
      });
      if (isSent) {
        onNotify(`Resent email via SMTP to ${res.emailDelivery.recipient_email}.`);
      } else {
        onNotify(
          `SMTP resend failed (${res.emailDelivery.recipient_email}): ${
            res.emailDelivery.smtp_error || 'Check Gmail SMTP settings.'
          }`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend email.');
    } finally {
      setResendingEmailId(null);
    }
  };

  const handleScreening = async (decision: ScreeningDecision) => {
    if (!isAdmin) return;
    setBusy(true);
    setError('');
    try {
      const updated = await submitScreeningDecision(candidate.id, decision, screeningRemarks);
      await onUpdated(updated);
      reportLatestEmailOutcome(
        updated,
        decision === 'proceed'
          ? `Shortlisted ${candidate.full_name}`
          : `Recorded screening rejection for ${candidate.full_name}`
      );
      if (decision === 'proceed') setActiveTab('documents');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save screening decision.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveChecklist = async () => {
    if (!isAdmin) return;
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
    if (!isAdmin) return;
    setUploadingDoc(docType);
    setError('');
    try {
      const updated = await uploadCandidateDocument(candidate.id, docType, file);
      await onUpdated(updated);
      const scannedDoc = updated.documents.find((d) => d.doc_type === docType);
      if (scannedDoc?.ai_verified_status === 'AI_FAILED') {
        onNotify(`Saved ${file.name} (${docType}), but Gemini AI scan failed — use Re-Analyze to retry.`);
      } else if (scannedDoc?.ai_verified_status === 'NAME_MISMATCH') {
        onNotify(`Uploaded ${file.name} (${docType}) — Gemini AI flagged a candidate name mismatch.`);
      } else {
        onNotify(`Uploaded ${file.name} (${docType}) and completed Gemini AI document extraction.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload document.');
    } finally {
      setUploadingDoc(null);
    }
  };

  const handleReanalyzeDoc = async (doc: CandidateDocument) => {
    if (!isAdmin || !doc.id) return;
    setAnalyzingDocId(doc.id);
    setError('');
    try {
      const updated = await reanalyzeDocumentWithAi(doc.id);
      await onUpdated(updated);
      const refreshedDoc = updated.documents.find((d) => d.id === doc.id);
      if (refreshedDoc?.ai_verified_status === 'AI_FAILED') {
        onNotify(`Gemini AI re-analysis failed for ${doc.doc_type}. Please review the warning note.`);
      } else if (refreshedDoc?.ai_verified_status === 'NAME_MISMATCH') {
        onNotify(`Gemini AI re-analysis flagged a name mismatch on ${doc.doc_type}.`);
      } else {
        onNotify(`Gemini AI re-analysis completed for ${doc.doc_type}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-analyze document with Gemini AI.');
    } finally {
      setAnalyzingDocId(null);
    }
  };

  const handleSendReminder = async () => {
    if (!isAdmin) return;
    setBusy(true);
    setError('');
    try {
      const updated = await sendDocReminder(candidate.id);
      await onUpdated(updated);
      reportLatestEmailOutcome(updated, `Document reminder for ${candidate.full_name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reminder email.');
    } finally {
      setBusy(false);
    }
  };

  const handleQualification = async (status: QualificationStatus) => {
    if (!isAdmin) return;
    setBusy(true);
    setError('');
    try {
      const updated = await submitQualificationDecision(candidate.id, status, qualRemarks);
      await onUpdated(updated);
      reportLatestEmailOutcome(
        updated,
        status === 'qualified'
          ? `${candidate.full_name} marked Qualified`
          : `${candidate.full_name} marked Not Qualified`
      );
      if (status === 'qualified') setActiveTab('interview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save qualification decision.');
    } finally {
      setBusy(false);
    }
  };

  const handleBookSlot = async () => {
    if (!isAdmin || !selectedSlotId) return;
    setBusy(true);
    setError('');
    try {
      const res = await bookInterviewSlotAtomically(Number(selectedSlotId), candidate.id);
      await onUpdated(res.candidate);
      setSelectedSlotId('');
      reportLatestEmailOutcome(res.candidate, `Booked interview slot for ${candidate.full_name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Slot could not be booked.');
    } finally {
      setBusy(false);
    }
  };

  const handleMarkInterviewStatus = async (status: 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED') => {
    if (!isAdmin || !candidate.active_booking) return;
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
    if (!isAdmin) return;
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
      if (decision === 'reject') {
        reportLatestEmailOutcome(updated, `Recorded post-interview rejection for ${candidate.full_name}`);
      } else {
        onNotify(`Approved ${candidate.full_name} for employment offer.`);
        setActiveTab('offer');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit interview evaluation.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
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
      reportLatestEmailOutcome(updated, `Employment Offer (${formatMYR(offerSalary)}/mo)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dispatch offer.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateOfferStatus = async (nextStatus: OfferStatus) => {
    if (!isAdmin) return;
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
    if (!isAdmin) return;
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

          <div className="relative flex items-center gap-2 shrink-0">
            {isAdmin && (
              <button
                type="button"
                disabled={!normalizedWhatsAppPhone}
                onClick={() => setWhatsAppPopoverOpen((prev) => !prev)}
                title={
                  normalizedWhatsAppPhone
                    ? `Send WhatsApp message to +${normalizedWhatsAppPhone}`
                    : whatsAppDisabledReason
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-[#16A34A] border border-[#15803D] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#15803D] disabled:bg-[#E2E8F0] disabled:border-[#CBD5E1] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <MessageCircle className="h-3.5 w-3.5 text-[#DCFCE7]" />
                WhatsApp Candidate
              </button>
            )}
            <button
              type="button"
              onClick={copyPortalLink}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] transition-colors whitespace-nowrap shrink-0"
              title="Copy public candidate self-service portal URL"
            >
              {copiedPortal ? <Check className="h-3.5 w-3.5 text-[#15803D]" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedPortal ? 'Copied Link' : 'Portal Link'}
            </button>
            <button
              type="button"
              onClick={() => onOpenPortalPreview(candidate)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#0F766E]/30 bg-[#F0FDFA] px-2.5 py-1.5 text-xs font-semibold text-[#0F766E] hover:bg-[#CCFBF1] transition-colors whitespace-nowrap shrink-0"
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

            {isAdmin && whatsAppPopoverOpen && normalizedWhatsAppPhone && (
              <div className="absolute right-0 top-full mt-2 z-30 w-[380px] max-w-[90vw] rounded-lg border border-[#CBD5E1] bg-white shadow-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#25D366]" />
                    <span className="text-xs font-bold text-[#0F172A]">WhatsApp Quick Outreach</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-[#15803D] font-semibold">
                      +{normalizedWhatsAppPhone}
                    </span>
                    <button
                      type="button"
                      onClick={() => setWhatsAppPopoverOpen(false)}
                      className="rounded p-0.5 text-[#64748B] hover:text-[#0F172A]"
                      aria-label="Close WhatsApp popover"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                    Message Template
                  </label>
                  <select
                    value={whatsAppTemplate}
                    onChange={(e) => handleSelectWhatsAppTemplate(e.target.value as WhatsAppTemplateKey)}
                    className="w-full rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs text-[#0F172A] focus:border-[#16A34A] focus:outline-none"
                  >
                    {WHATSAPP_TEMPLATES.map((tpl) => (
                      <option key={tpl.key} value={tpl.key}>
                        {tpl.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-[#475569]">
                      Pre-filled Message (Editable)
                    </label>
                    <button
                      type="button"
                      onClick={() => setWhatsAppMessage(buildWhatsAppMessage(candidate, whatsAppTemplate))}
                      className="text-[11px] font-medium text-[#0F766E] hover:underline"
                    >
                      Reset Template
                    </button>
                  </div>
                  <textarea
                    rows={4}
                    value={whatsAppMessage}
                    onChange={(e) => setWhatsAppMessage(e.target.value)}
                    className="w-full rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-2 text-xs text-[#0F172A] focus:bg-white focus:border-[#16A34A] focus:outline-none leading-relaxed"
                  />
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-[#64748B]">
                    Opens wa.me &amp; logs in Audit Trail
                  </span>
                  <button
                    type="button"
                    onClick={() => handleLaunchWhatsApp({ closePopover: true })}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#16A34A] hover:bg-[#15803D] px-3 py-1.5 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    Send Instant WhatsApp
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Read-only notice for Manager */}
        {!isAdmin && (
          <div className="flex items-center gap-2 border-b border-[#E2E8F0] bg-[#F8FAFC] px-6 py-2 text-xs text-[#475569]">
            <Eye className="h-3.5 w-3.5 text-[#0F766E] shrink-0" />
            <span>
              <strong>Manager (View Only):</strong> All candidate records, uploaded resumes, academic documents, interview details, and offer terms are viewable in read-only mode.
            </span>
          </div>
        )}

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

        {/* Real SMTP Email Delivery Status Banner */}
        {emailBanner && (
          <div
            className={`mx-6 mt-3 flex items-start justify-between gap-2 rounded-md border px-3.5 py-2.5 text-xs ${
              emailBanner.status === 'SENT_SMTP'
                ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                : 'border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]'
            }`}
          >
            <div className="flex items-start gap-2 min-w-0">
              {emailBanner.status === 'SENT_SMTP' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="font-semibold">
                  {emailBanner.status === 'SENT_SMTP'
                    ? `Email Sent via SMTP to ${emailBanner.recipient}`
                    : `SMTP Email Failed to ${emailBanner.recipient}`}
                </div>
                <div className="text-[11px] opacity-90 truncate">{emailBanner.subject}</div>
                {emailBanner.error && (
                  <div className="mt-1 font-mono text-[11px] break-words">{emailBanner.error}</div>
                )}
                {emailBanner.messageId && (
                  <div className="mt-0.5 font-mono text-[10px] opacity-80">
                    Message-ID: {emailBanner.messageId}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEmailBanner(null)}
              className="rounded p-0.5 opacity-70 hover:opacity-100 shrink-0"
              aria-label="Dismiss email delivery notice"
            >
              <X className="h-3.5 w-3.5" />
            </button>
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
                  <div className="flex items-center justify-between gap-2 text-[#0F172A]">
                    <div className="flex items-center gap-2 min-w-0">
                      <Phone className="h-4 w-4 text-[#64748B] shrink-0" />
                      <span className="font-mono text-xs truncate">{candidate.phone || 'Not provided'}</span>
                    </div>
                    {isAdmin && (
                      <button
                        type="button"
                        disabled={!normalizedWhatsAppPhone}
                        onClick={() => handleLaunchWhatsApp({ useStageDefault: true })}
                        title={
                          normalizedWhatsAppPhone
                            ? `Instant WhatsApp (+${normalizedWhatsAppPhone}) using stage-appropriate template`
                            : whatsAppDisabledReason
                        }
                        className="inline-flex items-center gap-1 rounded border border-[#25D366] bg-[#F0FDF4] px-2 py-0.5 text-[11px] font-semibold text-[#15803D] hover:bg-[#DCFCE7] disabled:border-[#E2E8F0] disabled:bg-[#F8FAFC] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <MessageCircle className="h-3 w-3" />
                        WhatsApp
                      </button>
                    )}
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
                    <div className="pt-2 border-t border-[#F1F5F9] space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[#334155] truncate">
                          <FileText className="h-3.5 w-3.5 text-[#0F766E] shrink-0" />
                          <span className="truncate">{resumeDoc.file_name || 'Resume file'}</span>
                        </span>
                        <div className="flex items-center gap-2.5 shrink-0">
                          {resumeDoc.file_path && (
                            <a
                              href={getProtectedFileUrl(resumeDoc.file_path)}
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold text-[#0F766E] hover:underline"
                            >
                              Download
                            </a>
                          )}
                          {isAdmin && resumeDoc.file_path && (
                            <button
                              type="button"
                              disabled={analyzingDocId === resumeDoc.id}
                              onClick={() => void handleReanalyzeDoc(resumeDoc)}
                              className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-50"
                            >
                              {analyzingDocId === resumeDoc.id ? (
                                <Loader2 className="h-3 w-3 animate-spin text-[#0F766E]" />
                              ) : (
                                <RefreshCw className="h-3 w-3 text-[#0F766E]" />
                              )}
                              {analyzingDocId === resumeDoc.id ? 'Scanning...' : 'Re-Analyze with Gemini AI'}
                            </button>
                          )}
                          {!resumeDoc.file_path &&
                            (isAdmin ? (
                              <label className="cursor-pointer font-semibold text-[#0F766E] hover:underline">
                                {uploadingDoc === 'RESUME' ? 'Uploading & Scanning...' : 'Attach PDF / Image'}
                                <input
                                  type="file"
                                  accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) void handleFileUpload('RESUME', file);
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                            ) : (
                              <span className="text-[#94A3B8]">No file attached</span>
                            ))}
                        </div>
                      </div>
                      {resumeDoc.ai_verified_status === 'AI_FAILED' && (
                        <div className="flex items-start gap-1.5 rounded border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-1.5 text-[11px] text-[#92400E]">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[#D97706]" />
                          <span>
                            {resumeDoc.ai_extracted?.error ||
                              'Gemini AI scan did not complete for this resume. Click Re-Analyze to retry.'}
                          </span>
                        </div>
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
                      {isAdmin
                        ? 'Selecting "Proceed to Next Stage" automatically emails the Candidate Self-Service Portal upload link for Application Form, DISC, VAKAD, and academic certificates.'
                        : 'Recorded screening decision and HR reviewer notes.'}
                    </p>
                  </div>
                  <span className="font-mono text-xs font-semibold uppercase text-[#475569]">
                    Current: {candidate.screening_decision}
                  </span>
                </div>

                {isAdmin ? (
                  <>
                    <textarea
                      value={screeningRemarks}
                      onChange={(e) => setScreeningRemarks(e.target.value)}
                      rows={3}
                      placeholder="Enter HR initial resume screening notes (e.g., relevant statutory experience, technical fit, salary expectations)..."
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
                        Proceed &amp; Send Portal Upload Request
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
                  </>
                ) : (
                  <p className="text-xs text-[#334155] bg-white border border-[#E2E8F0] rounded-md px-3 py-2.5">
                    {candidate.screening_remarks || 'No screening remarks recorded yet.'}
                  </p>
                )}
              </div>

              {/* Direct WhatsApp Candidate Outreach Section (Administrator Only) */}
              {isAdmin && (
                <div className="border border-[#BBF7D0] rounded-lg p-4 bg-[#F0FDF4]/60 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                        <MessageCircle className="h-4 w-4 text-[#16A34A]" />
                        WhatsApp Candidate Outreach
                      </h3>
                      <p className="text-xs text-[#475569]">
                        Send an instant stage-matched WhatsApp follow-up via Malaysian mobile routing. Automatically recorded in the immutable Audit Trail.
                      </p>
                    </div>
                    {normalizedWhatsAppPhone ? (
                      <span className="font-mono text-xs font-semibold text-[#15803D]">
                        MY Mobile: +{normalizedWhatsAppPhone}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-[#B45309]">
                        Invalid / Missing MY Mobile
                      </span>
                    )}
                  </div>

                  {normalizedWhatsAppPhone ? (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {WHATSAPP_TEMPLATES.map((tpl) => {
                          const active = whatsAppTemplate === tpl.key;
                          return (
                            <button
                              key={tpl.key}
                              type="button"
                              onClick={() => handleSelectWhatsAppTemplate(tpl.key)}
                              className={`text-left rounded-md border px-2.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
                                active
                                  ? 'border-[#16A34A] bg-white text-[#15803D] font-semibold'
                                  : 'border-[#E2E8F0] bg-white/80 text-[#475569] hover:border-[#86EFAC]'
                              }`}
                            >
                              {tpl.shortLabel}
                            </button>
                          );
                        })}
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[11px] font-semibold uppercase tracking-wider text-[#475569]">
                            Message Preview ({getWhatsAppTemplateLabel(whatsAppTemplate)})
                          </label>
                          <button
                            type="button"
                            onClick={() => setWhatsAppMessage(buildWhatsAppMessage(candidate, whatsAppTemplate))}
                            className="text-[11px] font-medium text-[#15803D] hover:underline"
                          >
                            Reset to Default Copy
                          </button>
                        </div>
                        <textarea
                          rows={3}
                          value={whatsAppMessage}
                          onChange={(e) => setWhatsAppMessage(e.target.value)}
                          className="w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] focus:border-[#16A34A] focus:outline-none leading-relaxed"
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] text-[#475569]">
                          Opens <span className="font-mono">wa.me/{normalizedWhatsAppPhone}</span> in a new browser tab.
                        </span>
                        <button
                          type="button"
                          onClick={() => handleLaunchWhatsApp()}
                          className="inline-flex items-center gap-1.5 rounded-md bg-[#16A34A] hover:bg-[#15803D] px-3.5 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          Send Instant WhatsApp
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
                      Cannot launch WhatsApp: <span className="font-mono">{candidate.phone || 'empty'}</span> is not a valid 11–12 digit Malaysian mobile number (e.g., <span className="font-mono">011-31832623</span> or <span className="font-mono">+6012-3456789</span>).
                    </div>
                  )}
                </div>
              )}

              {/* Candidate Email Dispatch & Real SMTP Delivery Status */}
              {candidate.recent_emails && candidate.recent_emails.length > 0 && (
                <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F172A]">
                      <Mail className="h-3.5 w-3.5 text-[#0F766E]" />
                      Email Delivery History ({candidate.recent_emails.length})
                    </span>
                    <span className="text-[11px] text-[#64748B]">Live SMTP status per dispatch</span>
                  </div>
                  <div className="divide-y divide-[#E2E8F0] bg-white max-h-64 overflow-y-auto">
                    {candidate.recent_emails.map((log) => {
                      const isSent = log.delivery_status === 'SENT_SMTP';
                      const isFailed =
                        log.delivery_status === 'SMTP_FAILED' || log.delivery_status === 'SMTP_FAILED_LOGGED';
                      return (
                        <div key={log.id} className="px-4 py-2.5 space-y-1 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-semibold text-[#0F172A]">{log.subject}</span>
                              <span className="ml-2 font-mono text-[10px] text-[#64748B]">
                                {formatTimestamp(log.created_at)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span
                                className={`inline-flex items-center gap-1 font-mono text-[10px] font-semibold ${
                                  isSent
                                    ? 'text-[#15803D]'
                                    : isFailed
                                      ? 'text-[#DC2626]'
                                      : 'text-[#B45309]'
                                }`}
                              >
                                {isSent ? (
                                  <CheckCircle2 className="h-3 w-3" />
                                ) : (
                                  <AlertTriangle className="h-3 w-3" />
                                )}
                                {isSent ? 'Sent via SMTP' : isFailed ? 'SMTP Failed' : log.delivery_status}
                              </span>
                              {isAdmin && (
                                <button
                                  type="button"
                                  disabled={resendingEmailId === log.id}
                                  onClick={() => void handleResendCandidateEmail(log)}
                                  className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-50"
                                >
                                  {resendingEmailId === log.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin text-[#0F766E]" />
                                  ) : (
                                    <RefreshCw className="h-3 w-3 text-[#0F766E]" />
                                  )}
                                  {resendingEmailId === log.id ? 'Resending...' : 'Resend'}
                                </button>
                              )}
                            </div>
                          </div>
                          {log.smtp_error && (
                            <div className="rounded border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1 font-mono text-[10px] text-[#B91C1C] break-words">
                              {log.smtp_error}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="border-t border-[#E2E8F0] pt-4 flex items-center justify-between">
                <span className="text-xs text-[#64748B]">
                  Record created {formatTimestamp(candidate.created_at)}
                </span>
                {isAdmin && (
                  !confirmDelete ? (
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
                  )
                )}
              </div>
            </>
          )}

          {/* TAB 2: DOCUMENTS, FORMS & QUALIFICATION */}
          {activeTab === 'documents' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border border-[#E2E8F0] rounded-lg p-4 bg-[#FAFBFC]">
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    Stage 5–7 · Application Form, DISC, VAKAD &amp; Academic Documents
                  </h3>
                  <p className="text-xs text-[#64748B]">
                    {missingDocs.length === 0
                      ? 'All mandatory forms, assessments, and academic certificates are complete.'
                      : `${missingDocs.length} mandatory item(s) still pending: ${missingDocs.join(', ')}`}
                  </p>
                  {candidate.last_doc_reminder_at && (
                    <p className="mt-1 text-[11px] font-mono text-[#64748B]">
                      Last reminder emailed: {formatTimestamp(candidate.last_doc_reminder_at)}
                    </p>
                  )}
                </div>
                {isAdmin && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!normalizedWhatsAppPhone}
                      onClick={() => handleLaunchWhatsApp({ templateKey: 'shortlisted_docs' })}
                      title={
                        normalizedWhatsAppPhone
                          ? `WhatsApp document & form reminder to +${normalizedWhatsAppPhone}`
                          : whatsAppDisabledReason
                      }
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#16A34A] hover:bg-[#15803D] px-3 py-1.5 text-xs font-semibold text-white disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      WhatsApp Docs Reminder
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSendReminder}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#F59E0B] bg-[#FFFBEB] px-3 py-1.5 text-xs font-semibold text-[#B45309] hover:bg-[#FEF3C7] disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <BellRing className="h-3.5 w-3.5" />
                      Send Document Reminder Email
                    </button>
                  </div>
                )}
              </div>

              {/* Checklist table */}
              <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B] uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="px-3.5 py-2.5 font-semibold">Requirement</th>
                      <th className="px-3.5 py-2.5 font-semibold text-center">Submitted</th>
                      <th className="px-3.5 py-2.5 font-semibold text-center">HR Verified</th>
                      <th className="px-3.5 py-2.5 font-semibold text-center">N/A</th>
                      <th className="px-3.5 py-2.5 font-semibold text-right">Uploaded File</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {DOC_META.map((item) => {
                      const doc = getDoc(candidate, item.type);
                      const flag = docFlags[item.type];
                      const ai = doc?.ai_extracted;
                      const aiStatus = doc?.ai_verified_status || '';
                      const isScanningThis =
                        uploadingDoc === item.type || (doc?.id !== undefined && analyzingDocId === doc.id);

                      const extractedHighlights: Array<{ label: string; value: string; mono?: boolean }> = [];
                      if (ai) {
                        if (ai.candidate_name_on_doc) {
                          extractedHighlights.push({ label: 'Name on Doc', value: ai.candidate_name_on_doc });
                        }
                        if (ai.expected_salary_myr !== undefined && ai.expected_salary_myr !== '') {
                          extractedHighlights.push({
                            label: 'Expected Salary',
                            value: String(ai.expected_salary_myr),
                            mono: true,
                          });
                        }
                        if (ai.notice_period) {
                          extractedHighlights.push({ label: 'Notice Period', value: ai.notice_period });
                        }
                        if (ai.availability_date) {
                          extractedHighlights.push({ label: 'Availability', value: ai.availability_date, mono: true });
                        }
                        if (ai.disc_profile_type) {
                          extractedHighlights.push({ label: 'DISC Type', value: ai.disc_profile_type });
                        }
                        if (ai.vakad_dominant_style) {
                          extractedHighlights.push({ label: 'VAKAD Style', value: ai.vakad_dominant_style });
                        }
                        if (ai.school_name) {
                          extractedHighlights.push({ label: 'School', value: ai.school_name });
                        }
                        if (ai.university_name) {
                          extractedHighlights.push({ label: 'University', value: ai.university_name });
                        }
                        if (ai.degree_title) {
                          extractedHighlights.push({ label: 'Degree', value: ai.degree_title });
                        }
                        if (ai.program_name) {
                          extractedHighlights.push({ label: 'Program', value: ai.program_name });
                        }
                        if (ai.honours_class) {
                          extractedHighlights.push({ label: 'Honours', value: ai.honours_class });
                        }
                        if (ai.exam_year) {
                          extractedHighlights.push({ label: 'Exam Year', value: ai.exam_year, mono: true });
                        }
                        if (ai.graduation_year) {
                          extractedHighlights.push({ label: 'Grad Year', value: ai.graduation_year, mono: true });
                        }
                        if (ai.total_credits !== undefined && ai.total_credits !== '') {
                          extractedHighlights.push({
                            label: 'Credits',
                            value: String(ai.total_credits),
                            mono: true,
                          });
                        }
                        if (ai.cgpa) {
                          extractedHighlights.push({ label: 'CGPA', value: ai.cgpa, mono: true });
                        }
                        if (ai.semesters_completed !== undefined && ai.semesters_completed !== '') {
                          extractedHighlights.push({
                            label: 'Semesters',
                            value: String(ai.semesters_completed),
                            mono: true,
                          });
                        }
                      }

                      return (
                        <React.Fragment key={item.type}>
                          <tr className="hover:bg-[#FAFBFC]">
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
                                disabled={!isAdmin || flag.not_applicable}
                                onChange={(e) =>
                                  setDocFlags((prev) => ({
                                    ...prev,
                                    [item.type]: { ...prev[item.type], completed: e.target.checked },
                                  }))
                                }
                                className="h-4 w-4 accent-[#0F766E] disabled:opacity-60"
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={flag.verified}
                                disabled={!isAdmin || flag.not_applicable}
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
                                className="h-4 w-4 accent-[#15803D] disabled:opacity-60"
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              {item.type === 'UEC' ? (
                                <input
                                  type="checkbox"
                                  checked={flag.not_applicable}
                                  disabled={!isAdmin}
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
                                  className="h-4 w-4 accent-[#64748B] disabled:opacity-60"
                                />
                              ) : (
                                <span className="text-[#CBD5E1]">—</span>
                              )}
                            </td>
                            <td className="px-3.5 py-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                {doc?.file_path && (
                                  <a
                                    href={getProtectedFileUrl(doc.file_path)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F766E] hover:underline"
                                  >
                                    View File
                                  </a>
                                )}
                                {isAdmin && item.allowUpload && !flag.not_applicable && (
                                  <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-medium text-[#334155] hover:bg-[#F8FAFC]">
                                    {uploadingDoc === item.type ? (
                                      <Loader2 className="h-3 w-3 animate-spin text-[#0F766E]" />
                                    ) : (
                                      <Upload className="h-3 w-3" />
                                    )}
                                    {uploadingDoc === item.type ? 'Scanning...' : doc?.file_path ? 'Replace' : 'Upload'}
                                    <input
                                      type="file"
                                      accept=".pdf,.jpg,.jpeg,.png,.webp,.docx"
                                      className="hidden"
                                      onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) void handleFileUpload(item.type, f);
                                        e.target.value = '';
                                      }}
                                    />
                                  </label>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Gemini AI Document Insights sub-row for uploaded academic documents */}
                          {item.allowUpload && doc?.file_path && !flag.not_applicable && (
                            <tr className="bg-[#F8FAFC]">
                              <td colSpan={5} className="px-3.5 py-2.5 border-t border-[#E2E8F0]">
                                <div className="space-y-1.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                      <span className="inline-flex items-center gap-1 font-semibold text-[#0F172A]">
                                        <Sparkles className="h-3 w-3 text-[#0F766E]" />
                                        Gemini AI Extraction
                                      </span>
                                      {ai?.document_detected && (
                                        <>
                                          <span className="text-[#CBD5E1]">·</span>
                                          <span className="font-medium text-[#334155]">{ai.document_detected}</span>
                                        </>
                                      )}
                                      <span className="text-[#CBD5E1]">·</span>
                                      {isScanningThis ? (
                                        <span className="inline-flex items-center gap-1 font-semibold text-[#0F766E]">
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                          Analyzing document...
                                        </span>
                                      ) : aiStatus === 'VERIFIED_MATCH' ? (
                                        <span className="inline-flex items-center gap-1 font-semibold text-[#15803D]">
                                          <CheckCircle2 className="h-3 w-3" />
                                          AI Verified · Name Matched
                                        </span>
                                      ) : aiStatus === 'NAME_MISMATCH' ? (
                                        <span className="inline-flex items-center gap-1 font-semibold text-[#DC2626]">
                                          <AlertTriangle className="h-3 w-3" />
                                          Name Mismatch Warning
                                        </span>
                                      ) : aiStatus === 'AI_FAILED' ? (
                                        <span className="inline-flex items-center gap-1 font-semibold text-[#B45309]">
                                          <AlertTriangle className="h-3 w-3" />
                                          AI Scan Failed — Retry Available
                                        </span>
                                      ) : aiStatus === 'REVIEW_NEEDED' ? (
                                        <span className="inline-flex items-center gap-1 font-semibold text-[#B45309]">
                                          <AlertCircle className="h-3 w-3" />
                                          Review Needed
                                        </span>
                                      ) : (
                                        <span className="text-[#64748B]">Not yet scanned by Gemini AI</span>
                                      )}
                                    </div>

                                    {isAdmin && (
                                      <button
                                        type="button"
                                        disabled={isScanningThis}
                                        onClick={() => void handleReanalyzeDoc(doc)}
                                        className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#334155] hover:bg-[#F1F5F9] disabled:opacity-50"
                                      >
                                        {analyzingDocId === doc.id ? (
                                          <Loader2 className="h-3 w-3 animate-spin text-[#0F766E]" />
                                        ) : (
                                          <RefreshCw className="h-3 w-3 text-[#0F766E]" />
                                        )}
                                        {analyzingDocId === doc.id ? 'Analyzing...' : 'Re-Analyze with Gemini AI'}
                                      </button>
                                    )}
                                  </div>

                                  {aiStatus === 'NAME_MISMATCH' && ai?.candidate_name_on_doc && (
                                    <div className="rounded border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1.5 text-[11px] text-[#B91C1C]">
                                      Printed name <strong className="font-semibold">&ldquo;{ai.candidate_name_on_doc}&rdquo;</strong> does not match candidate record <strong className="font-semibold">&ldquo;{candidate.full_name}&rdquo;</strong>. Please verify identity manually before checking HR Verified.
                                    </div>
                                  )}

                                  {aiStatus === 'AI_FAILED' && (
                                    <div className="rounded border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-1.5 text-[11px] text-[#92400E]">
                                      {ai?.error ||
                                        'The file was saved securely, but Gemini AI could not complete scanning. Click Re-Analyze with Gemini AI to try again.'}
                                    </div>
                                  )}

                                  {extractedHighlights.length > 0 && (
                                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-[#334155]">
                                      {extractedHighlights.map((field) => (
                                        <span key={field.label}>
                                          <span className="text-[#64748B]">{field.label}:</span>{' '}
                                          <span
                                            className={`font-medium text-[#0F172A] ${
                                              field.mono ? 'font-mono tabular-nums' : ''
                                            }`}
                                          >
                                            {field.value}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  )}

                                  {ai?.key_traits_summary && (
                                    <div className="text-[11px] text-[#334155]">
                                      <span className="text-[#64748B]">Key DISC Traits:</span>{' '}
                                      <span className="text-[#0F172A]">{ai.key_traits_summary}</span>
                                    </div>
                                  )}

                                  {ai?.scores_summary && (
                                    <div className="text-[11px] text-[#334155]">
                                      <span className="text-[#64748B]">VAKAD Scores:</span>{' '}
                                      <span className="font-mono text-[#0F172A]">{ai.scores_summary}</span>
                                    </div>
                                  )}

                                  {ai?.grades_summary && (
                                    <div className="text-[11px] text-[#334155]">
                                      <span className="text-[#64748B]">Grades:</span>{' '}
                                      <span className="font-mono text-[#0F172A]">{ai.grades_summary}</span>
                                    </div>
                                  )}

                                  {ai?.verification_notes && (
                                    <div className="text-[11px] leading-relaxed text-[#475569]">
                                      <span className="font-semibold text-[#64748B]">AI Notes:</span>{' '}
                                      {ai.verification_notes}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
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
                  {isAdmin ? (
                    <input
                      type="text"
                      value={discProfile}
                      onChange={(e) => setDiscProfile(e.target.value)}
                      placeholder="e.g., High D / C — Analytical Driver"
                      className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
                    />
                  ) : (
                    <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs text-[#334155]">
                      {candidate.disc_profile || 'Not recorded yet'}
                    </div>
                  )}
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSaveChecklist}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E293B] disabled:opacity-50"
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" />
                    Save Checklist Verification
                  </button>
                )}
              </div>

              {/* Stage 8 Qualification */}
              <div className="border border-[#E2E8F0] rounded-lg p-4 bg-[#FAFBFC] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-[#0F172A]">Stage 8 · Qualification Decision</h3>
                    <p className="text-xs text-[#64748B]">
                      {isAdmin
                        ? 'Marking a candidate Qualified automatically dispatches the Interview Invitation email with their self-service slot booking link.'
                        : 'Recorded academic qualification review status.'}
                    </p>
                  </div>
                  <span className="font-mono text-xs font-semibold uppercase text-[#475569]">
                    Status: {candidate.qualification_status}
                  </span>
                </div>

                {isAdmin ? (
                  <>
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
                  </>
                ) : (
                  <p className="text-xs text-[#334155] bg-white border border-[#E2E8F0] rounded-md px-3 py-2.5">
                    {candidate.qualification_remarks || 'No qualification remarks recorded yet.'}
                  </p>
                )}
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

                    {isAdmin && (
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
                    )}
                  </div>
                ) : isAdmin ? (
                  <div className="space-y-3">
                    <p className="text-xs text-[#64748B]">
                      No active booking yet. The candidate can book directly via their portal link, or an Administrator can assign an open slot atomically below:
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
                ) : (
                  <p className="text-xs text-[#64748B]">No interview slot has been booked yet.</p>
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

                {isAdmin ? (
                  <>
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
                  </>
                ) : (
                  <div className="space-y-2 text-xs text-[#334155] bg-white border border-[#E2E8F0] rounded-md p-3.5">
                    <div>
                      Panel Rating:{' '}
                      <strong className="font-mono">
                        {candidate.interview_rating ? `${candidate.interview_rating} / 5` : 'Not rated yet'}
                      </strong>
                    </div>
                    <div>
                      Feedback: {candidate.interview_feedback || 'No interview feedback recorded yet.'}
                    </div>
                    {candidate.final_decision_notes && (
                      <div>Final Notes: {candidate.final_decision_notes}</div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* TAB 4: EMPLOYMENT OFFER */}
          {activeTab === 'offer' && (
            <>
              {isAdmin && (
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
              )}

              {/* Stage 14-15 Offer Summary & Tracking (Viewable by Both Roles) */}
              {candidate.offer ? (
                <div className="border border-[#E2E8F0] rounded-lg p-4 bg-[#FAFBFC] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-[#0F172A]">
                        Stage 14–15 · Employment Offer Status
                      </h3>
                      <p className="text-xs text-[#64748B]">
                        Package: <strong className="text-[#0F172A]">{formatMYR(candidate.offer.salary_myr)}</strong> basic +{' '}
                        {formatMYR(candidate.offer.allowance_myr)} allowance · Start {candidate.offer.start_date} · Deadline {candidate.offer.deadline_date}
                      </p>
                    </div>
                    <span className="font-mono text-xs font-bold text-[#0F766E]">
                      {candidate.offer.status}
                    </span>
                  </div>

                  {candidate.offer.offer_terms_summary && (
                    <p className="text-xs text-[#334155] leading-relaxed">
                      {candidate.offer.offer_terms_summary}
                    </p>
                  )}

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

                  {isAdmin ? (
                    <>
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
                    </>
                  ) : (
                    candidate.offer.candidate_response_note && (
                      <div className="text-xs text-[#475569] border-t border-[#E2E8F0] pt-2">
                        Response Note: {candidate.offer.candidate_response_note}
                      </div>
                    )
                  )}
                </div>
              ) : (
                !isAdmin && (
                  <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFBFC] p-5 text-xs text-[#64748B]">
                    No employment offer has been issued for this candidate yet.
                  </div>
                )
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
  const types: DocType[] = [
    'RESUME',
    'APPLICATION_FORM',
    'DISC',
    'VAKAD',
    'SPM',
    'UEC',
    'DEGREE',
    'TRANSCRIPT',
  ];
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
