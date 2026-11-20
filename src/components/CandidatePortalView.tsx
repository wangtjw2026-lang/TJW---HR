import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  Loader2,
  MapPin,
  ShieldCheck,
  Sparkles,
  Upload,
  Video,
  XCircle,
} from 'lucide-react';
import {
  fetchPortalData,
  getProtectedFileUrl,
  portalBookInterviewSlot,
  portalRespondToOffer,
  portalUploadDocument,
} from '../lib/apiService';
import { formatMYR, getDoc } from '../lib/atsHelpers';
import {
  CandidateRecord,
  DocType,
  InterviewSlot,
  STATUS_META,
} from '../types/ats';

interface CandidatePortalViewProps {
  /** Standalone public mode triggered from /?portal=<token> */
  publicToken?: string;
  /** HR Workspace Preview mode */
  candidates?: CandidateRecord[];
  initialCandidateId?: number | null;
  readOnly?: boolean;
  onRefreshWorkspace?: () => Promise<void> | void;
  onNotify?: (message: string) => void;
}

const FORMS_AND_ASSESSMENT_DOCS: Array<{
  type: DocType;
  label: string;
  subtitle: string;
}> = [
  {
    type: 'APPLICATION_FORM',
    label: 'Employment Application Form',
    subtitle: 'Mandatory · Upload completed Employment Application Form (PDF, PNG, JPG, WEBP, DOCX)',
  },
  {
    type: 'DISC',
    label: 'DISC Assessment Report / Sheet',
    subtitle: 'Mandatory · Upload completed DISC Personality Assessment report or sheet (PDF, PNG, JPG, WEBP, DOCX)',
  },
  {
    type: 'VAKAD',
    label: 'VAKAD Assessment Report / Sheet',
    subtitle: 'Mandatory · Upload completed VAKAD Assessment report or sheet (PDF, PNG, JPG, WEBP, DOCX)',
  },
];

const ACADEMIC_DOCS: Array<{
  type: DocType;
  label: string;
  subtitle: string;
}> = [
  {
    type: 'SPM',
    label: 'SPM Examination Results',
    subtitle: 'Mandatory · Sijil Pelajaran Malaysia slip or certificate (PDF, PNG, JPG, WEBP, DOCX)',
  },
  {
    type: 'UEC',
    label: 'UEC Examination Results',
    subtitle: 'If Applicable · Unified Examination Certificate (Independent Schools)',
  },
  {
    type: 'DEGREE',
    label: 'University Degree Certificate',
    subtitle: 'Mandatory · Official scroll / convocation certificate',
  },
  {
    type: 'TRANSCRIPT',
    label: 'University Academic Transcript',
    subtitle: 'Mandatory · Full semester-by-semester official academic transcript',
  },
];

export const CandidatePortalView: React.FC<CandidatePortalViewProps> = ({
  publicToken,
  candidates = [],
  initialCandidateId = null,
  readOnly = false,
  onRefreshWorkspace,
  onNotify,
}) => {
  const isStandalone = Boolean(publicToken);
  const canInteract = isStandalone || !readOnly;

  const [selectedToken, setSelectedToken] = useState<string>(() => {
    if (publicToken) return publicToken;
    if (initialCandidateId) {
      const match = candidates.find((c) => c.id === initialCandidateId);
      if (match) return match.portal_token;
    }
    return candidates[0]?.portal_token || '';
  });

  const [portalCandidate, setPortalCandidate] = useState<CandidateRecord | null>(null);
  const [availableSlots, setAvailableSlots] = useState<InterviewSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadingType, setUploadingType] = useState<DocType | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  const [offerNote, setOfferNote] = useState('');

  useEffect(() => {
    if (publicToken) {
      setSelectedToken(publicToken);
      return;
    }
    if (initialCandidateId) {
      const match = candidates.find((c) => c.id === initialCandidateId);
      if (match) {
        setSelectedToken(match.portal_token);
        return;
      }
    }
    if (!selectedToken && candidates.length > 0) {
      setSelectedToken(candidates[0].portal_token);
    }
  }, [publicToken, initialCandidateId, candidates, selectedToken]);

  const loadPortal = async (token: string) => {
    if (!token) {
      setPortalCandidate(null);
      setAvailableSlots([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await fetchPortalData(token);
      setPortalCandidate(data.candidate);
      setAvailableSlots(data.availableSlots);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load candidate portal.');
      setPortalCandidate(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPortal(selectedToken);
  }, [selectedToken]);

  const notify = (msg: string) => {
    setSuccessMsg(msg);
    onNotify?.(msg);
  };

  const handleUploadDoc = async (docType: DocType, file: File) => {
    if (!selectedToken) return;
    setUploadingType(docType);
    setError('');
    setSuccessMsg('');
    try {
      const data = await portalUploadDocument(selectedToken, docType, file);
      setPortalCandidate(data.candidate);
      setAvailableSlots(data.availableSlots);
      await onRefreshWorkspace?.();
      const scannedDoc = data.candidate.documents.find((d) => d.doc_type === docType);
      if (scannedDoc?.ai_verified_status === 'NAME_MISMATCH') {
        notify(
          `Uploaded ${file.name} (${docType}). Please double-check that the name on the document matches your application.`
        );
      } else if (scannedDoc?.ai_extracted?.document_detected) {
        notify(
          `Uploaded ${file.name} — detected as ${scannedDoc.ai_extracted.document_detected} and submitted for HR review.`
        );
      } else {
        notify(`Uploaded ${file.name} for ${docType}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploadingType(null);
    }
  };

  const handleBookSlot = async (slotId: number) => {
    if (!selectedToken) return;
    setBusy(true);
    setError('');
    setSuccessMsg('');
    try {
      const data = await portalBookInterviewSlot(selectedToken, slotId);
      setPortalCandidate(data.candidate);
      setAvailableSlots(data.availableSlots);
      await onRefreshWorkspace?.();
      notify('Interview slot confirmed! A confirmation email has been sent to your inbox.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This slot is no longer available.');
    } finally {
      setBusy(false);
    }
  };

  const handleOfferDecision = async (accepted: boolean) => {
    if (!selectedToken) return;
    setBusy(true);
    setError('');
    setSuccessMsg('');
    try {
      const data = await portalRespondToOffer(selectedToken, accepted, offerNote);
      setPortalCandidate(data.candidate);
      setAvailableSlots(data.availableSlots);
      await onRefreshWorkspace?.();
      notify(
        accepted
          ? 'Employment offer accepted! Our HR team will reach out with onboarding instructions.'
          : 'Your response declining the offer has been recorded.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record offer response.');
    } finally {
      setBusy(false);
    }
  };

  const shareUrl =
    typeof window !== 'undefined' && selectedToken
      ? `${window.location.origin}/?portal=${selectedToken}`
      : '';

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      onNotify?.('Copied public candidate portal URL.');
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      onNotify?.(`Portal URL: ${shareUrl}`);
    }
  };

  const wrapperClass = isStandalone
    ? 'min-h-screen bg-[#F8FAFC] py-8 px-4 sm:px-6'
    : 'space-y-6';

  return (
    <div className={wrapperClass}>
      <div className={isStandalone ? 'mx-auto max-w-4xl space-y-6' : 'space-y-6'}>
        {/* Top bar */}
        {isStandalone ? (
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8F0] pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0F766E] text-white font-bold text-sm">
                TF
              </div>
              <div>
                <div className="text-base font-bold text-[#0F172A]">TalentFlow MY · Candidate Portal</div>
                <div className="text-xs text-[#64748B]">
                  Secure Token-Authenticated Self-Service Recruitment Portal
                </div>
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs text-[#0F766E] font-medium">
              <ShieldCheck className="h-4 w-4" />
              Encrypted Token Session
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E2E8F0] pb-4">
            <div>
              <h1 className="text-xl font-bold text-[#0F172A]">Candidate Self-Service Portal</h1>
              <p className="text-xs text-[#64748B] mt-0.5">
                Live preview powered by the public `/api/portal/:token` endpoint — candidates access their own URL directly without an HR login.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedToken}
                onChange={(e) => setSelectedToken(e.target.value)}
                className="rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] min-w-[260px]"
              >
                {candidates.length === 0 && <option value="">No candidates registered yet</option>}
                {candidates.map((c) => (
                  <option key={c.id} value={c.portal_token}>
                    {c.candidate_code} · {c.full_name} (Stage {c.stage})
                  </option>
                ))}
              </select>
              {shareUrl && (
                <button
                  type="button"
                  onClick={copyShareUrl}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC]"
                >
                  {copiedLink ? <Check className="h-3.5 w-3.5 text-[#15803D]" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedLink ? 'Copied URL' : 'Copy Public Link'}
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#B91C1C]">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-2 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-xs text-[#15803D]">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-xs text-[#64748B] gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-[#0F766E]" />
            Loading candidate portal...
          </div>
        ) : !portalCandidate ? (
          <div className="rounded-lg border border-dashed border-[#CBD5E1] bg-white p-12 text-center text-xs text-[#64748B]">
            {isStandalone
              ? 'This portal link is invalid or expired. Please contact HR for an updated link.'
              : 'Select a candidate above to preview or test their live self-service portal.'}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Candidate Identity Summary */}
            <div className="rounded-lg border border-[#E2E8F0] bg-white p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs text-[#64748B]">
                  <span className="font-mono font-semibold text-[#0F172A]">{portalCandidate.candidate_code}</span>
                  <span>·</span>
                  <span>Stage {portalCandidate.stage} of 15</span>
                </div>
                <h2 className="mt-1 text-lg font-bold text-[#0F172A]">{portalCandidate.full_name}</h2>
                <div className="flex items-center gap-2 text-xs text-[#475569] mt-0.5">
                  <Briefcase className="h-3.5 w-3.5 text-[#0F766E]" />
                  <span>
                    {portalCandidate.position} — {portalCandidate.department}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wider text-[#64748B]">Application Status</div>
                <div className="mt-0.5 text-sm font-bold text-[#0F766E]">
                  {STATUS_META[portalCandidate.status]?.label || portalCandidate.status}
                </div>
              </div>
            </div>

            {/* Section 1: Application Form, DISC & VAKAD Assessments (Upload Only) */}
            <div className="rounded-lg border border-[#E2E8F0] bg-white p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-[#0F172A]">
                  Step 1 · Employment Application Form, DISC &amp; VAKAD Assessments
                </h3>
                <p className="text-xs text-[#64748B] mt-0.5">
                  Upload your completed Employment Application Form, DISC Assessment, and VAKAD Assessment files (PDF, PNG, JPG, WEBP, or DOCX).
                </p>
              </div>

              <div className="divide-y divide-[#E2E8F0] border border-[#E2E8F0] rounded-md">
                {FORMS_AND_ASSESSMENT_DOCS.map((item) => {
                  const doc = getDoc(portalCandidate, item.type);
                  return (
                    <div
                      key={item.type}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#0F172A]">{item.label}</span>
                          {doc?.verified ? (
                            <span className="text-[11px] font-semibold text-[#15803D]">Verified by HR</span>
                          ) : doc?.completed ? (
                            <span className="text-[11px] font-semibold text-[#0F766E]">Uploaded</span>
                          ) : (
                            <span className="text-[11px] font-semibold text-[#B45309]">Pending Upload</span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#64748B]">{item.subtitle}</div>
                        {doc?.file_name && (
                          <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-[#0F766E]">
                            <FileText className="h-3 w-3" />
                            <span>{doc.file_name}</span>
                            {doc.file_path && (
                              <a
                                href={getProtectedFileUrl(doc.file_path, selectedToken)}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                View File
                              </a>
                            )}
                          </div>
                        )}
                        {doc?.file_path && doc.ai_verified_status && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                            {doc.ai_verified_status === 'VERIFIED_MATCH' ? (
                              <span className="inline-flex items-center gap-1 font-medium text-[#15803D]">
                                <Sparkles className="h-3 w-3" />
                                Detected: {doc.ai_extracted?.document_detected || item.label} · Name matched
                              </span>
                            ) : doc.ai_verified_status === 'NAME_MISMATCH' ? (
                              <span className="inline-flex items-center gap-1 font-medium text-[#DC2626]">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                Detected: {doc.ai_extracted?.document_detected || item.label} · Name on document
                                {doc.ai_extracted?.candidate_name_on_doc
                                  ? ` ("${doc.ai_extracted.candidate_name_on_doc}")`
                                  : ''}{' '}
                                does not match your profile. Please verify or replace if incorrect.
                              </span>
                            ) : doc.ai_verified_status === 'AI_FAILED' ? (
                              <span className="inline-flex items-center gap-1 text-[#64748B]">
                                <AlertCircle className="h-3 w-3 shrink-0" />
                                File received · Queued for manual HR verification.
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-medium text-[#B45309]">
                                <Sparkles className="h-3 w-3 shrink-0" />
                                Detected: {doc.ai_extracted?.document_detected || 'Uploaded document'} · Pending HR
                                verification
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {canInteract && (
                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] whitespace-nowrap shrink-0">
                          {uploadingType === item.type ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0F766E]" />
                          ) : (
                            <Upload className="h-3.5 w-3.5 text-[#0F766E]" />
                          )}
                          {uploadingType === item.type
                            ? 'Uploading & Scanning...'
                            : doc?.completed
                              ? 'Replace File'
                              : 'Upload File'}
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp,.docx"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void handleUploadDoc(item.type, f);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Section 2: Academic Documents Upload */}
            <div className="rounded-lg border border-[#E2E8F0] bg-white p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-[#0F172A]">
                  Step 2 · Required Malaysian Academic Documents
                </h3>
                <p className="text-xs text-[#64748B] mt-0.5">
                  Upload clear PDF, image, or DOCX copies of your SPM, UEC (if applicable), University Degree Certificate, and Academic Transcript.
                </p>
              </div>

              <div className="divide-y divide-[#E2E8F0] border border-[#E2E8F0] rounded-md">
                {ACADEMIC_DOCS.map((item) => {
                  const doc = getDoc(portalCandidate, item.type);
                  return (
                    <div
                      key={item.type}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#0F172A]">{item.label}</span>
                          {doc?.verified ? (
                            <span className="text-[11px] font-semibold text-[#15803D]">Verified by HR</span>
                          ) : doc?.completed ? (
                            <span className="text-[11px] font-semibold text-[#0F766E]">Uploaded</span>
                          ) : doc?.not_applicable ? (
                            <span className="text-[11px] font-medium text-[#64748B]">Not Applicable</span>
                          ) : (
                            <span className="text-[11px] font-semibold text-[#B45309]">Pending Upload</span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#64748B]">{item.subtitle}</div>
                        {doc?.file_name && (
                          <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-[#0F766E]">
                            <FileText className="h-3 w-3" />
                            <span>{doc.file_name}</span>
                            {doc.file_path && (
                              <a
                                href={getProtectedFileUrl(doc.file_path, selectedToken)}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                View File
                              </a>
                            )}
                          </div>
                        )}
                        {doc?.file_path && doc.ai_verified_status && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                            {doc.ai_verified_status === 'VERIFIED_MATCH' ? (
                              <span className="inline-flex items-center gap-1 font-medium text-[#15803D]">
                                <Sparkles className="h-3 w-3" />
                                Detected: {doc.ai_extracted?.document_detected || item.label} · Name matched
                              </span>
                            ) : doc.ai_verified_status === 'NAME_MISMATCH' ? (
                              <span className="inline-flex items-center gap-1 font-medium text-[#DC2626]">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                Detected: {doc.ai_extracted?.document_detected || item.label} · Name on document
                                {doc.ai_extracted?.candidate_name_on_doc
                                  ? ` ("${doc.ai_extracted.candidate_name_on_doc}")`
                                  : ''}{' '}
                                does not match your profile. Please verify or replace if incorrect.
                              </span>
                            ) : doc.ai_verified_status === 'AI_FAILED' ? (
                              <span className="inline-flex items-center gap-1 text-[#64748B]">
                                <AlertCircle className="h-3 w-3 shrink-0" />
                                File received · Queued for manual HR verification.
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-medium text-[#B45309]">
                                <Sparkles className="h-3 w-3 shrink-0" />
                                Detected: {doc.ai_extracted?.document_detected || 'Uploaded document'} · Pending HR
                                verification
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {canInteract && !doc?.not_applicable && (
                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] whitespace-nowrap shrink-0">
                          {uploadingType === item.type ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0F766E]" />
                          ) : (
                            <Upload className="h-3.5 w-3.5 text-[#0F766E]" />
                          )}
                          {uploadingType === item.type
                            ? 'Uploading & Scanning...'
                            : doc?.completed
                              ? 'Replace File'
                              : 'Upload File'}
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp,.docx"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void handleUploadDoc(item.type, f);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Section 3: Interview Slot Booking */}
            <div className="rounded-lg border border-[#E2E8F0] bg-white p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-[#0F172A]">Step 3 · Interview Slot Selection</h3>
                <p className="text-xs text-[#64748B] mt-0.5">
                  Once HR marks your application Qualified, choose an available interview slot below.
                </p>
              </div>

              {portalCandidate.active_booking ? (
                <div className="rounded-md border border-[#99F6E4] bg-[#F0FDFA] p-4 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#0F766E]">
                    <CheckCircle2 className="h-4 w-4" />
                    Interview Confirmed ({portalCandidate.active_booking.status})
                  </div>
                  <div className="text-sm font-bold text-[#0F172A] font-mono">
                    {portalCandidate.active_booking.date} · {portalCandidate.active_booking.start_time} –{' '}
                    {portalCandidate.active_booking.end_time} (MYT)
                  </div>
                  <div className="text-xs text-[#334155]">
                    Panelist: <strong>{portalCandidate.active_booking.interviewer_name}</strong> ·{' '}
                    {portalCandidate.active_booking.mode}
                  </div>
                  <div className="text-xs text-[#475569] break-all">
                    Location / Meeting Link: {portalCandidate.active_booking.location_or_link}
                  </div>
                </div>
              ) : portalCandidate.qualification_status !== 'qualified' && portalCandidate.stage < 9 ? (
                <div className="rounded-md bg-[#F8FAFC] border border-[#E2E8F0] p-4 text-xs text-[#64748B]">
                  Interview slot selection unlocks once HR completes document verification and marks your application <strong>Qualified</strong>.
                </div>
              ) : availableSlots.length === 0 ? (
                <div className="rounded-md bg-[#FFFBEB] border border-[#FDE68A] p-4 text-xs text-[#B45309]">
                  All published interview slots are currently full. HR will release additional dates shortly.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {availableSlots.map((slot) => (
                    <div
                      key={slot.id}
                      className="rounded-md border border-[#E2E8F0] p-4 flex flex-col justify-between gap-3 hover:border-[#0F766E]/60 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-bold text-[#0F172A]">
                          <span className="inline-flex items-center gap-1.5 font-mono">
                            <Calendar className="h-3.5 w-3.5 text-[#0F766E]" />
                            {slot.date}
                          </span>
                          <span className="text-[#15803D] font-semibold">
                            {slot.capacity - slot.booked_count} seat(s) left
                          </span>
                        </div>
                        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#334155]">
                          <Clock className="h-3.5 w-3.5 text-[#64748B]" />
                          {slot.start_time} – {slot.end_time} MYT
                        </div>
                        <div className="text-xs text-[#475569]">
                          Panel: {slot.interviewer_name} ({slot.department})
                        </div>
                        <div className="inline-flex items-center gap-1 text-[11px] text-[#64748B]">
                          {slot.mode.startsWith('On-site') ? (
                            <MapPin className="h-3 w-3" />
                          ) : (
                            <Video className="h-3 w-3" />
                          )}
                          {slot.mode}
                        </div>
                      </div>
                      {canInteract && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleBookSlot(slot.id)}
                          className="w-full rounded-md bg-[#0F766E] py-2 text-xs font-semibold text-white hover:bg-[#115E59] disabled:opacity-50"
                        >
                          Select &amp; Confirm This Slot
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Section 4: Employment Offer */}
            {portalCandidate.offer && (
              <div className="rounded-lg border border-[#0F766E]/40 bg-white p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#0F172A]">Step 4 · Official Employment Offer</h3>
                    <p className="text-xs text-[#64748B]">
                      Issued {portalCandidate.offer.issue_date} · Respond by {portalCandidate.offer.deadline_date}
                    </p>
                  </div>
                  <span className="font-mono text-xs font-bold text-[#0F766E]">
                    Status: {portalCandidate.offer.status}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <div className="text-[#64748B]">Monthly Basic Salary</div>
                    <div className="mt-0.5 font-mono text-base font-bold text-[#0F172A]">
                      {formatMYR(portalCandidate.offer.salary_myr)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#64748B]">Monthly Allowance</div>
                    <div className="mt-0.5 font-mono text-base font-bold text-[#0F172A]">
                      {formatMYR(portalCandidate.offer.allowance_myr)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#64748B]">Commencement &amp; Probation</div>
                    <div className="mt-0.5 font-semibold text-[#0F172A]">
                      {portalCandidate.offer.start_date} ({portalCandidate.offer.probation_months} mos)
                    </div>
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-[#334155]">
                  {portalCandidate.offer.offer_terms_summary}
                </p>

                {portalCandidate.offer.offer_letter_path && (
                  <div>
                    <a
                      href={getProtectedFileUrl(portalCandidate.offer.offer_letter_path, selectedToken)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F766E] hover:underline"
                    >
                      <FileText className="h-4 w-4" />
                      Download Official Offer Letter PDF
                    </a>
                  </div>
                )}

                {canInteract &&
                  (portalCandidate.offer.status === 'Offer Sent' ||
                    portalCandidate.offer.status === 'Pending Response') && (
                  <div className="space-y-3 border-t border-[#E2E8F0] pt-3">
                    <input
                      type="text"
                      value={offerNote}
                      onChange={(e) => setOfferNote(e.target.value)}
                      placeholder="Optional note to HR (e.g., notice period confirmation or questions)..."
                      className="w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-xs text-[#0F172A]"
                    />
                    <div className="flex flex-wrap gap-2.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleOfferDecision(true)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#15803D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#166534] disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Accept Employment Offer
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleOfferDecision(false)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[#FECACA] bg-white px-4 py-2 text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-50"
                      >
                        <XCircle className="h-4 w-4" />
                        Decline Offer
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
