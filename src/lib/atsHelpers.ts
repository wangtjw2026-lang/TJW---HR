import {
  CandidateDocument,
  CandidateFilters,
  CandidateRecord,
  DocType,
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
  const check = (type: DocType, label: string) => {
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
  check('APP_FORM', 'Employment Application Form');
  check('DISC', 'DISC Personality Assessment');
  check('SPM', 'SPM Examination Results');
  check('UEC', 'UEC Examination Results');
  check('DEGREE', 'University Degree Certificate');
  check('TRANSCRIPT', 'University Academic Transcript');
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
    'Employment Form',
    'DISC Form',
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
    docStatusLabel(c, 'APP_FORM'),
    docStatusLabel(c, 'DISC'),
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
