import {
  CandidateDocument,
  CandidateFilters,
  CandidateRecord,
  DocType,
  ONLINE_FORM_URLS,
  StaffRole,
  WORKFLOW_STAGES,
} from '../types/ats';

export function formatMYR(amount: number | undefined | null): string {
  if (amount === null || amount === undefined) return 'Restricted (HR Admin)';
  const safe = Number(amount) || 0;
  return `RM ${safe.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function getStageTitle(stage: number): string {
  return WORKFLOW_STAGES.find((s) => s.stage === stage)?.title ?? `Stage ${stage}`;
}

export function getDoc(candidate: CandidateRecord, type: DocType): CandidateDocument | undefined {
  return candidate.documents.find((d) => d.doc_type === type);
}

export function getMissingMandatoryDocs(candidate: CandidateRecord): string[] {
  const missing: string[] = [];
  const vakadActive = Boolean(candidate.form_links?.vakad_url);

  const checkForm = (type: 'APPLICATION_FORM' | 'DISC' | 'VAKAD', submittedFlag: boolean | undefined, label: string) => {
    const doc = getDoc(candidate, type);
    if (doc?.not_applicable) return;
    if (submittedFlag || doc?.completed || doc?.verified) return;
    missing.push(label);
  };

  const checkUploadDoc = (type: DocType, label: string) => {
    const doc = getDoc(candidate, type);
    if (!doc) {
      if (type !== 'UEC') missing.push(label);
      return;
    }
    if (doc.not_applicable) return;
    if (!doc.completed && !doc.verified) {
      missing.push(label);
    }
  };

  checkForm('APPLICATION_FORM', candidate.application_form_submitted, 'Employment Application Form (Online Form)');
  checkForm('DISC', candidate.disc_submitted, 'DISC Assessment (Online Assessment)');
  if (vakadActive) {
    checkForm('VAKAD', candidate.vakad_submitted, 'VAKAD Assessment (Online Assessment)');
  }
  checkUploadDoc('SPM', 'SPM Examination Results');
  checkUploadDoc('UEC', 'UEC Examination Results');
  checkUploadDoc('DEGREE', 'University Degree Certificate');
  checkUploadDoc('TRANSCRIPT', 'University Academic Transcript');
  return missing;
}

export function hasPendingDocs(candidate: CandidateRecord): boolean {
  return (
    (candidate.stage === 5 || candidate.stage === 6 || candidate.status === 'shortlisted_docs') &&
    getMissingMandatoryDocs(candidate).length > 0
  );
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
    newCandidates: candidates.filter((c) => c.stage <= 2 || c.status === 'new').length,
    pendingResumeScreening: candidates.filter(
      (c) => c.status === 'new' || c.status === 'pending_screening' || (c.stage <= 4 && c.screening_decision === 'pending')
    ).length,
    shortlistedCandidates: candidates.filter((c) => c.screening_decision === 'proceed' || c.stage >= 5).length,
    rejectedCandidates: candidates.filter(
      (c) =>
        c.status === 'rejected_screening' ||
        c.status === 'not_qualified' ||
        c.status === 'rejected_post_interview'
    ).length,
    pendingDocuments: candidates.filter(
      (c) => hasPendingDocs(c) || c.status === 'shortlisted_docs' || c.status === 'docs_under_review'
    ).length,
    qualifiedCandidates: candidates.filter((c) => c.qualification_status === 'qualified').length,
    notQualifiedCandidates: candidates.filter(
      (c) => c.qualification_status === 'not_qualified' || c.status === 'not_qualified'
    ).length,
    interviewInvitationsSent: candidates.filter((c) => c.stage >= 9 && c.qualification_status === 'qualified').length,
    confirmedInterviews: candidates.filter(
      (c) =>
        c.status === 'interview_confirmed' ||
        (c.active_booking && (c.active_booking.status === 'CONFIRMED' || c.active_booking.status === 'COMPLETED'))
    ).length,
    pendingInterviewEvaluations: candidates.filter(
      (c) =>
        (c.status === 'interview_confirmed' || c.status === 'interview_completed') &&
        c.post_interview_decision === 'pending'
    ).length,
    employmentOffersSent: candidates.filter((c) => Boolean(c.offer)).length,
    offersAccepted: candidates.filter((c) => c.offer?.status === 'Accepted' || c.status === 'offer_accepted').length,
    offersRejected: candidates.filter(
      (c) =>
        c.offer?.status === 'Rejected' ||
        c.offer?.status === 'Expired' ||
        c.status === 'offer_rejected' ||
        c.status === 'offer_expired'
    ).length,
    pendingOfferResponses: candidates.filter(
      (c) => c.offer?.status === 'Offer Sent' || c.offer?.status === 'Pending Response'
    ).length,
  };
}

export function filterCandidates(candidates: CandidateRecord[], filters: CandidateFilters): CandidateRecord[] {
  const q = filters.search.trim().toLowerCase();
  return candidates.filter((c) => {
    if (q) {
      const hay = [
        c.candidate_code,
        c.full_name,
        c.email,
        c.phone,
        c.position,
        c.department,
        ...c.skills,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.dateFrom && c.applied_date < filters.dateFrom) return false;
    if (filters.dateTo && c.applied_date > filters.dateTo) return false;
    if (filters.position && c.position !== filters.position) return false;
    if (filters.department && c.department !== filters.department) return false;
    if (filters.source && c.source !== filters.source) return false;
    if (filters.stage !== '' && c.stage !== Number(filters.stage)) return false;
    if (filters.status && c.status !== filters.status) return false;
    if (filters.interviewDate && c.active_booking?.date !== filters.interviewDate) return false;
    if (filters.offerStatus) {
      if (filters.offerStatus === 'NONE' && c.offer) return false;
      if (filters.offerStatus !== 'NONE' && c.offer?.status !== filters.offerStatus) return false;
    }
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

export function exportCandidatesToExcelCsv(candidates: CandidateRecord[], _role: StaffRole): void {
  const includeSalary = true;

  const docStatusLabel = (c: CandidateRecord, t: DocType) => {
    const d = getDoc(c, t);
    if (t === 'VAKAD' && !c.form_links?.vakad_url && !c.vakad_submitted && !d?.completed && !d?.verified) {
      return 'Not Yet Created';
    }
    if (t === 'APPLICATION_FORM' && (d?.verified || c.application_form_submitted || d?.completed)) {
      return d?.verified ? 'verified' : 'submitted';
    }
    if (t === 'DISC' && (d?.verified || c.disc_submitted || d?.completed)) {
      return d?.verified ? 'verified' : 'submitted';
    }
    if (t === 'VAKAD' && (d?.verified || c.vakad_submitted || d?.completed)) {
      return d?.verified ? 'verified' : 'submitted';
    }
    if (!d) return 'missing';
    if (d.not_applicable) return 'N/A';
    if (d.verified) return 'verified';
    if (d.completed) return 'submitted';
    return 'missing';
  };

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
    'Employment Application Form',
    'DISC Assessment',
    'VAKAD Assessment',
    'DISC Profile',
    'SPM Doc',
    'UEC Doc',
    'Degree Doc',
    'Transcript Doc',
    'Qualification Status',
    'Interview Date',
    'Interview Time',
    'Interviewer',
    'Post-Interview Decision',
    'Offer Status',
    ...(includeSalary ? ['Monthly Salary (MYR)', 'Allowance (MYR)', 'Start Date', 'Offer Deadline'] : []),
  ];

  const rows = candidates.map((c) => [
    c.candidate_code,
    c.full_name,
    c.email,
    c.phone,
    c.position,
    c.department,
    c.source,
    c.applied_date,
    c.stage,
    getStageTitle(c.stage),
    c.status,
    c.ai_score,
    c.years_experience,
    c.screening_decision,
    docStatusLabel(c, 'APPLICATION_FORM'),
    docStatusLabel(c, 'DISC'),
    docStatusLabel(c, 'VAKAD'),
    c.disc_profile || '-',
    docStatusLabel(c, 'SPM'),
    docStatusLabel(c, 'UEC'),
    docStatusLabel(c, 'DEGREE'),
    docStatusLabel(c, 'TRANSCRIPT'),
    c.qualification_status,
    c.active_booking?.date || '-',
    c.active_booking ? `${c.active_booking.start_time} - ${c.active_booking.end_time}` : '-',
    c.active_booking?.interviewer_name || '-',
    c.post_interview_decision,
    c.offer?.status || 'No Offer',
    ...(includeSalary
      ? [
          c.offer?.salary_myr ? formatMYR(c.offer.salary_myr) : '-',
          c.offer?.allowance_myr ? formatMYR(c.offer.allowance_myr) : '-',
          c.offer?.start_date || '-',
          c.offer?.deadline_date || '-',
        ]
      : []),
  ]);

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

export function formatTimestamp(ts: string | undefined | null): string {
  if (!ts) return 'Just now';
  const normalized = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });
}

// =============================================================================
// MALAYSIAN WHATSAPP OUTREACH HELPERS
// =============================================================================
export type WhatsAppTemplateKey = 'shortlisted_docs' | 'interview_reminder' | 'general_followup';

export interface WhatsAppTemplateOption {
  key: WhatsAppTemplateKey;
  label: string;
  shortLabel: string;
}

export const WHATSAPP_TEMPLATES: WhatsAppTemplateOption[] = [
  {
    key: 'shortlisted_docs',
    label: 'Shortlisted / Stage 3 Document & Form Reminder',
    shortLabel: 'Shortlisted & Docs Reminder',
  },
  {
    key: 'interview_reminder',
    label: 'Interview Invitation / Reminder',
    shortLabel: 'Interview Reminder',
  },
  {
    key: 'general_followup',
    label: 'General Follow-Up',
    shortLabel: 'General Follow-Up',
  },
];

/**
 * Normalizes a Malaysian mobile phone number into international E.164 digits without '+'.
 * Examples:
 *  - "011-31832623"   -> "601131832623"
 *  - "+60 12-345 6789" -> "60123456789"
 *  - "60191234567"    -> "60191234567"
 * Returns null if the number is missing or not a valid 11-12 digit Malaysian mobile (/^601[0-9]{8,9}$/).
 */
export function normalizeMalaysiaMobile(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const cleaned = String(phone).replace(/[\s\-()+]/g, '');
  if (!cleaned) return null;
  let normalized = cleaned;
  if (normalized.startsWith('0')) {
    normalized = `60${normalized.slice(1)}`;
  }
  if (!/^601[0-9]{8,9}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function formatMalaysiaWhatsAppUrl(
  phone: string | undefined | null,
  message: string
): string | null {
  const normalizedPhone = normalizeMalaysiaMobile(phone);
  if (!normalizedPhone) return null;
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}

export function getDefaultWhatsAppTemplateKey(stage: number): WhatsAppTemplateKey {
  if (stage >= 9 && stage <= 12) return 'interview_reminder';
  if (stage >= 3 && stage <= 8) return 'shortlisted_docs';
  return 'general_followup';
}

export function getWhatsAppTemplateLabel(key: WhatsAppTemplateKey): string {
  return WHATSAPP_TEMPLATES.find((t) => t.key === key)?.label ?? 'General Follow-Up';
}

export function resolveCandidatePortalUrl(
  candidate: Pick<CandidateRecord, 'portal_token' | 'portal_url'>
): string {
  const configuredPortalUrl = String(candidate.portal_url || '').trim();
  if (configuredPortalUrl) return configuredPortalUrl;
  const token = String(candidate.portal_token || '').trim();
  if (!token) return '';
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin.replace(/\/+$/, '')}/?portal=${token}`;
  }
  return `/?portal=${token}`;
}

export function buildWhatsAppMessage(
  candidate: Pick<
    CandidateRecord,
    'full_name' | 'position' | 'email' | 'portal_token' | 'portal_url' | 'form_links'
  >,
  templateKey: WhatsAppTemplateKey
): string {
  const name = candidate.full_name || 'Candidate';
  const position = candidate.position || 'open';
  const email = candidate.email || 'your email address';
  const portalUrl = resolveCandidatePortalUrl(candidate);
  const portalSuffix = portalUrl ? ` Portal link: ${portalUrl}` : '';
  const appFormUrl = candidate.form_links?.application_form_url || ONLINE_FORM_URLS.APPLICATION_FORM;
  const discUrl = candidate.form_links?.disc_url || ONLINE_FORM_URLS.DISC;
  const vakadUrl = candidate.form_links?.vakad_url || '';

  switch (templateKey) {
    case 'shortlisted_docs': {
      const vakadNote = vakadUrl
        ? `3) VAKAD Assessment: ${vakadUrl}`
        : `3) VAKAD Assessment: Not yet created (link coming soon — not required at this time)`;
      return [
        `Hi ${name}, this is HR from TJW. Congratulations on being shortlisted for the ${position} role!`,
        `We have also emailed ${email} with your next steps:`,
        `1) Employment Application Form (Mandatory): ${appFormUrl}`,
        `2) DISC Assessment (Mandatory): ${discUrl}`,
        vakadNote,
        `4) Upload your academic certificates (SPM, UEC if applicable, Degree, and Transcript) & confirm form submission via your Candidate Self-Service Portal:${portalUrl ? ` ${portalUrl}` : ' (see email)'}`,
        `Please check your inbox (and Spam/Junk folder) and let us know if you have any questions.`,
      ].join('\n');
    }
    case 'interview_reminder':
      return `Hi ${name}, this is HR from TJW regarding your ${position} application. Please confirm your interview slot via our Candidate Portal or reply here if you need any assistance.${portalSuffix}`;
    case 'general_followup':
    default:
      return `Hi ${name}, this is HR from TJW following up on your application for ${position}.`;
  }
}

export function openExternalWhatsAppUrl(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

