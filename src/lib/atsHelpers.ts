import {
  CandidateFilters,
  CandidatePrivateCompensation,
  CandidatePrivatePii,
  CandidateRecord,
  EmailTemplateType,
  GOOGLE_APPS_SCRIPT_URLS,
  StaffRole,
  WORKFLOW_STAGES,
} from '../types/ats';

export function clampString(value: string | undefined | null, maxLen: number): string {
  return String(value ?? '').trim().slice(0, maxLen);
}

export function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export function generateCandidateCode(): string {
  const now = new Date();
  const ym = `${now.getFullYear().toString().slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TFMY-${ym}-${rand}`;
}

export function maskEmail(email: string): string {
  const cleaned = email.trim().toLowerCase();
  const parts = cleaned.split('@');
  if (parts.length !== 2) return '***@***';
  const [local, domain] = parts;
  const visible = local.length <= 2 ? local.charAt(0) : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.length <= 4) return '***-****';
  return `${digits.slice(0, 4)}***${digits.slice(-4)}`;
}

export async function hashContactValue(raw: string): Promise<string> {
  const normalized = raw.trim().toLowerCase().replace(/[\s\-()]/g, '');
  if (!normalized) return 'empty_hash_0000';
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
  }
  let fallback = 0;
  for (let i = 0; i < normalized.length; i++) {
    fallback = (fallback * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return `h_${fallback.toString(16).padStart(12, '0')}`;
}

export function formatMYR(amount: number | undefined | null): string {
  const safe = Number(amount) || 0;
  return `RM ${safe.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function getStageTitle(stage: number): string {
  return WORKFLOW_STAGES.find((s) => s.stage === stage)?.title ?? `Stage ${stage}`;
}

export function getMissingMandatoryDocs(candidate: CandidateRecord): string[] {
  const missing: string[] = [];
  if (!candidate.employmentFormCompleted) missing.push('Employment Application Form');
  if (!candidate.discFormCompleted) missing.push('DISC Personality Assessment');
  if (candidate.docSpmStatus === 'missing') missing.push('SPM Examination Results');
  if (candidate.docUecStatus === 'missing') missing.push('UEC Examination Results');
  if (candidate.docDegreeStatus === 'missing') missing.push('University Degree Certificate');
  if (candidate.docTranscriptStatus === 'missing') missing.push('University Academic Transcript');
  return missing;
}

export function hasPendingDocs(candidate: CandidateRecord): boolean {
  return (
    (candidate.currentStage === 5 || candidate.currentStage === 6 || candidate.status === 'shortlisted_docs') &&
    getMissingMandatoryDocs(candidate).length > 0
  );
}

export function composeAutomatedEmail(params: {
  templateType: EmailTemplateType;
  candidateName: string;
  positionApplied: string;
  department: string;
  missingDocs?: string[];
  interviewDate?: string;
  interviewTime?: string;
  interviewMode?: string;
  interviewerName?: string;
  monthlySalaryMYR?: number;
  startDate?: string;
  offerDeadline?: string;
  rejectionReason?: string;
}): { subject: string; bodyPreview: string } {
  const {
    templateType,
    candidateName,
    positionApplied,
    department,
    missingDocs = [],
    interviewDate,
    interviewTime,
    interviewMode,
    interviewerName,
    monthlySalaryMYR,
    startDate,
    offerDeadline,
    rejectionReason,
  } = params;

  switch (templateType) {
    case 'shortlist_forms_disc':
      return {
        subject: `[TalentFlow MY] Shortlisted for ${positionApplied} — Complete Application & DISC Assessment`,
        bodyPreview: clampString(
          `Dear ${candidateName},\n\nCongratulations! Your application for ${positionApplied} (${department}) has progressed to the next stage.\n\nPlease complete both official forms below and upload your Malaysian academic documents (SPM, UEC if applicable, University Degree Certificate, and Academic Transcript):\n\n1. Employment Application Form:\n${GOOGLE_APPS_SCRIPT_URLS.employmentApplicationForm}\n\n2. DISC Personality Assessment:\n${GOOGLE_APPS_SCRIPT_URLS.discPersonalityAssessment}\n\nThank you,\nTalentFlow MY HR Recruitment Team`,
          1950
        ),
      };
    case 'docs_reminder_48h':
      return {
        subject: `[Reminder] Pending Assessment & Academic Documents — ${positionApplied}`,
        bodyPreview: clampString(
          `Dear ${candidateName},\n\nThis is a friendly 48-hour follow-up reminder for your ${positionApplied} application. Our HR team is still awaiting the following required items:\n- ${missingDocs.join('\n- ') || 'Required Academic Certificates & Forms'}\n\nLinks:\n• Employment Application Form: ${GOOGLE_APPS_SCRIPT_URLS.employmentApplicationForm}\n• DISC Personality Assessment: ${GOOGLE_APPS_SCRIPT_URLS.discPersonalityAssessment}\n\nPlease submit at your earliest convenience so we can proceed to qualification review.\n\nRegards,\nTalentFlow MY HR Team`,
          1950
        ),
      };
    case 'interview_invite':
      return {
        subject: `[Interview Invitation] Select Your Interview Slot — ${positionApplied}`,
        bodyPreview: clampString(
          `Dear ${candidateName},\n\nYour credentials and assessments have been verified and you are qualified for the interview stage for ${positionApplied} (${department}).\n\nPlease open the TalentFlow MY Self-Service Interview Portal to reserve an available date and time slot. Slots are locked atomically on a first-come basis.\n\nBest regards,\nTalentFlow MY Recruitment Team`,
          1950
        ),
      };
    case 'interview_confirmation':
      return {
        subject: `[Confirmed] Interview Schedule for ${positionApplied} on ${interviewDate}`,
        bodyPreview: clampString(
          `Dear ${candidateName},\n\nYour interview slot for ${positionApplied} (${department}) is confirmed:\n• Date: ${interviewDate || 'TBD'}\n• Time: ${interviewTime || 'TBD'}\n• Mode: ${interviewMode || 'Google Meet'}\n• Panelist: ${interviewerName || 'Hiring Panel'}\n\nYour slot has been atomically reserved. We look forward to speaking with you.\n\nRegards,\nTalentFlow MY HR Team`,
          1950
        ),
      };
    case 'employment_offer':
      return {
        subject: `[Employment Offer] ${positionApplied} — TalentFlow MY`,
        bodyPreview: clampString(
          `Dear ${candidateName},\n\nWe are pleased to extend an official offer of employment for the position of ${positionApplied} in ${department}.\n• Offered Package: ${monthlySalaryMYR ? formatMYR(monthlySalaryMYR) + '/month' : 'Per Official Offer Letter'}\n• Proposed Start Date: ${startDate || 'To be confirmed'}\n• Offer Response Deadline: ${offerDeadline || 'Within 5 working days'}\n\nPlease review the full Offer Letter via the Candidate Self-Service Portal to confirm your acceptance or response.\n\nWarm regards,\nTalentFlow MY HR Admin`,
          1950
        ),
      };
    case 'rejection_notice':
      return {
        subject: `Application Update — ${positionApplied}`,
        bodyPreview: clampString(
          `Dear ${candidateName},\n\nThank you for your interest in the ${positionApplied} role (${department}) and the time you invested in our recruitment process.\n\nAfter careful consideration, we will not be moving forward with your application at this time.${rejectionReason ? ` (Internal note logged: ${rejectionReason})` : ''}\n\nWe wish you every success in your career search.\n\nSincerely,\nTalentFlow MY HR Team`,
          1950
        ),
      };
  }
}

export interface DashboardKPIs {
  totalApplications: number;
  newCandidates: number;
  pendingResumeScreening: number;
  shortlistedCandidates: number;
  rejectedCandidates: number;
  pendingDocuments: number;
  qualifiedCandidates: number;
  notQualifiedCandidates: number;
  interviewInvitationsSent: number;
  confirmedInterviews: number;
  pendingInterviewEvaluations: number;
  employmentOffersSent: number;
  offersAccepted: number;
  offersRejected: number;
  pendingOfferResponses: number;
}

export function computeDashboardKPIs(candidates: CandidateRecord[]): DashboardKPIs {
  return {
    totalApplications: candidates.length,
    newCandidates: candidates.filter((c) => c.currentStage <= 2 || c.status === 'new').length,
    pendingResumeScreening: candidates.filter(
      (c) => c.status === 'new' || c.status === 'pending_screening' || (c.currentStage <= 4 && c.screeningDecision === 'pending')
    ).length,
    shortlistedCandidates: candidates.filter((c) => c.screeningDecision === 'proceed' || c.currentStage >= 5).length,
    rejectedCandidates: candidates.filter(
      (c) =>
        c.status === 'rejected_screening' ||
        c.status === 'not_qualified' ||
        c.status === 'rejected_post_interview'
    ).length,
    pendingDocuments: candidates.filter((c) => hasPendingDocs(c) || c.status === 'shortlisted_docs' || c.status === 'docs_under_review').length,
    qualifiedCandidates: candidates.filter((c) => c.qualificationDecision === 'qualified').length,
    notQualifiedCandidates: candidates.filter((c) => c.qualificationDecision === 'not_qualified' || c.status === 'not_qualified').length,
    interviewInvitationsSent: candidates.filter((c) => c.currentStage >= 9 && c.qualificationDecision === 'qualified').length,
    confirmedInterviews: candidates.filter(
      (c) => c.status === 'interview_confirmed' || (c.interviewSlotId !== '' && c.currentStage >= 10)
    ).length,
    pendingInterviewEvaluations: candidates.filter(
      (c) =>
        (c.status === 'interview_confirmed' || c.status === 'interview_completed') &&
        c.postInterviewDecision === 'pending'
    ).length,
    employmentOffersSent: candidates.filter((c) => c.offerStatus !== 'none').length,
    offersAccepted: candidates.filter((c) => c.offerStatus === 'accepted' || c.status === 'offer_accepted').length,
    offersRejected: candidates.filter(
      (c) => c.offerStatus === 'rejected' || c.offerStatus === 'expired' || c.status === 'offer_rejected' || c.status === 'offer_expired'
    ).length,
    pendingOfferResponses: candidates.filter(
      (c) => c.offerStatus === 'offer_sent' || c.offerStatus === 'pending_response'
    ).length,
  };
}

export function filterCandidates(candidates: CandidateRecord[], filters: CandidateFilters): CandidateRecord[] {
  const q = filters.search.trim().toLowerCase();
  return candidates.filter((c) => {
    if (q) {
      const hay = [
        c.candidateCode,
        c.fullName,
        c.positionApplied,
        c.department,
        c.maskedEmail,
        ...c.skills,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.dateFrom && c.applicationDate < filters.dateFrom) return false;
    if (filters.dateTo && c.applicationDate > filters.dateTo) return false;
    if (filters.position && c.positionApplied !== filters.position) return false;
    if (filters.department && c.department !== filters.department) return false;
    if (filters.source && c.source !== filters.source) return false;
    if (filters.stage !== '' && c.currentStage !== Number(filters.stage)) return false;
    if (filters.status && c.status !== filters.status) return false;
    if (filters.interviewDate && c.interviewDate !== filters.interviewDate) return false;
    if (filters.offerStatus && c.offerStatus !== filters.offerStatus) return false;
    return true;
  });
}

function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportCandidatesToExcelCsv(params: {
  candidates: CandidateRecord[];
  piiMap: Record<string, CandidatePrivatePii | undefined>;
  compMap: Record<string, CandidatePrivateCompensation | undefined>;
  role: StaffRole;
}): void {
  const { candidates, piiMap, compMap, role } = params;
  const includePii = role === 'hr_admin';
  const includeSalary = role === 'hr_admin';

  const headers = [
    'Candidate Code',
    'Full Name',
    'Email',
    'Phone',
    'Position Applied',
    'Department',
    'Source',
    'Application Date',
    'Stage #',
    'Stage Milestone',
    'Status',
    'AI Match Score (%)',
    'Years Experience',
    'Screening Decision',
    'Employment Form',
    'DISC Form',
    'DISC Profile',
    'SPM Doc',
    'UEC Doc',
    'Degree Doc',
    'Transcript Doc',
    'Qualification Decision',
    'Interview Date',
    'Interview Time',
    'Interviewer',
    'Post-Interview Decision',
    'Offer Status',
    ...(includeSalary ? ['Monthly Salary (MYR)', 'Allowance (MYR)', 'Start Date', 'Offer Deadline'] : []),
  ];

  const rows = candidates.map((c) => {
    const pii = piiMap[c.id];
    const comp = compMap[c.id];
    return [
      c.candidateCode,
      c.fullName,
      includePii ? pii?.email || c.maskedEmail : c.maskedEmail,
      includePii ? pii?.phone || c.maskedPhone : c.maskedPhone,
      c.positionApplied,
      c.department,
      c.source,
      c.applicationDate,
      c.currentStage,
      getStageTitle(c.currentStage),
      c.status,
      c.aiMatchScore,
      c.yearsExperience,
      c.screeningDecision,
      c.employmentFormCompleted ? 'Completed' : 'Pending',
      c.discFormCompleted ? 'Completed' : 'Pending',
      c.discProfile || '-',
      c.docSpmStatus,
      c.docUecStatus,
      c.docDegreeStatus,
      c.docTranscriptStatus,
      c.qualificationDecision,
      c.interviewDate || '-',
      c.interviewTime || '-',
      c.interviewerName || '-',
      c.postInterviewDecision,
      c.offerStatus,
      ...(includeSalary
        ? [
            comp?.monthlySalaryMYR ? formatMYR(comp.monthlySalaryMYR) : '-',
            comp?.allowanceMYR ? formatMYR(comp.allowanceMYR) : '-',
            comp?.startDate || '-',
            comp?.offerDeadline || '-',
          ]
        : []),
    ];
  });

  const csvContent =
    '\uFEFF' +
    [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.setAttribute('download', `TalentFlow_MY_Recruitment_Report_${stamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function formatTimestamp(ts: unknown): string {
  if (!ts) return 'Just now';
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });
  }
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });
  }
  return 'Just now';
}
