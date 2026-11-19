export const GOOGLE_APPS_SCRIPT_URLS = {
  employmentApplicationForm:
    'https://script.google.com/macros/s/AKfycbzmwDILioaOGbozPl9t13wCJLpdF_T99WHAglBDJJXvEZTmWIt2oilSNYLyyatK6cG0/exec',
  discPersonalityAssessment:
    'https://script.google.com/macros/s/AKfycby-lUFDHSd2NmbiS3Gbg8Y22Ql8smy3XjatCdIs3s5AZ2yeqTBUB6dBQbhgt5EpDt1W/exec',
} as const;

export const BOOTSTRAPPED_ADMIN_EMAIL = 'wangtjw2026@gmail.com';

export type StaffRole = 'hr_admin' | 'recruiter' | 'hiring_manager';

export type ApplicationSource = 'JobStreet' | 'Email';

export type CandidateStatus =
  | 'new'
  | 'pending_screening'
  | 'shortlisted_docs'
  | 'rejected_screening'
  | 'docs_under_review'
  | 'qualified'
  | 'not_qualified'
  | 'interview_invited'
  | 'interview_confirmed'
  | 'interview_completed'
  | 'offer_sent'
  | 'offer_pending'
  | 'offer_accepted'
  | 'offer_rejected'
  | 'offer_expired'
  | 'rejected_post_interview';

export type DocStatus = 'missing' | 'submitted' | 'verified';
export type UecDocStatus = 'not_applicable' | 'missing' | 'submitted' | 'verified';
export type ScreeningDecision = 'pending' | 'proceed' | 'reject';
export type QualificationDecision = 'pending' | 'qualified' | 'not_qualified';
export type PostInterviewDecision = 'pending' | 'offer' | 'reject';
export type OfferStatus = 'none' | 'offer_sent' | 'pending_response' | 'accepted' | 'rejected' | 'expired';

export type InterviewMode =
  | 'Google Meet'
  | 'Microsoft Teams'
  | 'On-site (KL HQ)'
  | 'On-site (Penang)';

export type SlotStatus = 'available' | 'booked' | 'completed' | 'cancelled';

export type EmailTemplateType =
  | 'shortlist_forms_disc'
  | 'docs_reminder_48h'
  | 'interview_invite'
  | 'interview_confirmation'
  | 'employment_offer'
  | 'rejection_notice';

export type AuditTargetType =
  | 'candidate'
  | 'pii'
  | 'compensation'
  | 'interview_slot'
  | 'export'
  | 'rbac';

export interface StaffUser {
  uid: string;
  email: string;
  displayName: string;
  role: StaffRole;
  department: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CandidateRecord {
  id: string;
  candidateCode: string;
  fullName: string;
  maskedEmail: string;
  maskedPhone: string;
  emailHash: string;
  phoneHash: string;
  positionApplied: string;
  department: string;
  source: ApplicationSource;
  applicationDate: string;
  currentStage: number;
  status: CandidateStatus;
  aiMatchScore: number;
  aiSummary: string;
  educationSummary: string;
  experienceSummary: string;
  yearsExperience: number;
  skills: string[];
  screeningDecision: ScreeningDecision;
  screeningRejectionReason: string;
  employmentFormCompleted: boolean;
  discFormCompleted: boolean;
  discProfile: string;
  docSpmStatus: DocStatus;
  docUecStatus: UecDocStatus;
  docDegreeStatus: DocStatus;
  docTranscriptStatus: DocStatus;
  lastDocReminderAt: string;
  qualificationDecision: QualificationDecision;
  qualificationRemarks: string;
  interviewSlotId: string;
  interviewDate: string;
  interviewTime: string;
  interviewMode: string;
  interviewerName: string;
  interviewFeedback: string;
  interviewRating: number;
  postInterviewDecision: PostInterviewDecision;
  offerStatus: OfferStatus;
  finalDecisionNotes: string;
  ownerId: string;
  assignedStaffIds: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CandidatePrivatePii {
  email: string;
  phone: string;
  location: string;
  resumeFileName: string;
  resumeExcerpt: string;
  spmFileName: string;
  uecFileName: string;
  degreeFileName: string;
  transcriptFileName: string;
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CandidatePrivateCompensation {
  positionOffered: string;
  departmentOffered: string;
  monthlySalaryMYR: number;
  allowanceMYR: number;
  probationMonths: number;
  startDate: string;
  offerDeadline: string;
  offerLetterRef: string;
  offerTermsSummary: string;
  candidateResponseNote: string;
  respondedAt: string;
  ownerId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InterviewSlot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  interviewerName: string;
  department: string;
  mode: InterviewMode;
  meetingLinkOrRoom: string;
  status: SlotStatus;
  bookedCandidateId: string;
  bookedCandidateName: string;
  ownerId: string;
  assignedStaffIds: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface EmailLogRecord {
  id: string;
  candidateId: string;
  candidateName: string;
  maskedRecipient: string;
  templateType: EmailTemplateType;
  subject: string;
  bodyPreview: string;
  stageTriggered: number;
  deliveryStatus: 'dispatched' | 'queued';
  triggeredByUid: string;
  ownerId: string;
  assignedStaffIds: string[];
  createdAt?: unknown;
}

export interface PdpaAuditLogRecord {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorRole: StaffRole;
  action: string;
  targetType: AuditTargetType;
  targetId: string;
  details: string;
  ownerId: string;
  assignedStaffIds: string[];
  createdAt?: unknown;
}

export interface ParsedResumeResult {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  educationSummary: string;
  experienceSummary: string;
  yearsExperience: number;
  skills: string[];
  aiMatchScore: number;
  aiSummary: string;
  detectedSpmMention: boolean;
  detectedUecMention: boolean;
  detectedDegreeMention: boolean;
}

export interface CandidateFilters {
  search: string;
  dateFrom: string;
  dateTo: string;
  position: string;
  department: string;
  source: '' | ApplicationSource;
  stage: '' | number;
  status: '' | CandidateStatus;
  interviewDate: string;
  offerStatus: '' | OfferStatus;
}

export interface WorkflowStageMeta {
  stage: number;
  title: string;
  shortTitle: string;
  phase: 'Intake & Screening' | 'Forms & Verification' | 'Interviews' | 'Offer & Onboarding';
}

export const WORKFLOW_STAGES: WorkflowStageMeta[] = [
  { stage: 1, title: 'Receive Resume', shortTitle: 'Receive', phase: 'Intake & Screening' },
  { stage: 2, title: 'Register Candidate', shortTitle: 'Register', phase: 'Intake & Screening' },
  { stage: 3, title: 'Initial Resume Screening', shortTitle: 'Screen', phase: 'Intake & Screening' },
  { stage: 4, title: 'HR Screening Decision', shortTitle: 'Decision', phase: 'Intake & Screening' },
  { stage: 5, title: 'Auto-Send Forms & Links', shortTitle: 'Forms Sent', phase: 'Forms & Verification' },
  { stage: 6, title: 'Collect Academic Docs', shortTitle: 'Academic Docs', phase: 'Forms & Verification' },
  { stage: 7, title: 'HR Document Review', shortTitle: 'Doc Review', phase: 'Forms & Verification' },
  { stage: 8, title: 'Qualification Decision', shortTitle: 'Qualify', phase: 'Forms & Verification' },
  { stage: 9, title: 'Send Interview Invite', shortTitle: 'Invite Sent', phase: 'Interviews' },
  { stage: 10, title: 'Candidate Slot Selection', shortTitle: 'Slot Booked', phase: 'Interviews' },
  { stage: 11, title: 'Conduct Interview', shortTitle: 'Interviewed', phase: 'Interviews' },
  { stage: 12, title: 'Post-Interview Decision', shortTitle: 'Panel Decision', phase: 'Interviews' },
  { stage: 13, title: 'Send Employment Offer', shortTitle: 'Offer Sent', phase: 'Offer & Onboarding' },
  { stage: 14, title: 'Track Offer Response', shortTitle: 'Offer Track', phase: 'Offer & Onboarding' },
  { stage: 15, title: 'Final Status Recorded', shortTitle: 'Finalized', phase: 'Offer & Onboarding' },
];

export const DEPARTMENTS = [
  'Engineering & Technology',
  'Finance & Accounting',
  'Human Resources',
  'Operations & Supply Chain',
  'Sales & Commercial',
  'Product & Design',
  'Legal & Compliance',
] as const;

export const POSITIONS = [
  'Senior Full-Stack Engineer',
  'Financial Accountant (MIA/ACCA)',
  'HR Business Partner',
  'Supply Chain & Logistics Lead',
  'Enterprise Sales Manager',
  'Product Designer (UI/UX)',
  'Data & BI Analyst',
  'Compliance & PDPA Executive',
] as const;

export const STATUS_META: Record<
  CandidateStatus,
  { label: string; tone: 'neutral' | 'teal' | 'amber' | 'green' | 'red' }
> = {
  new: { label: 'New Application', tone: 'neutral' },
  pending_screening: { label: 'Pending Screening', tone: 'amber' },
  shortlisted_docs: { label: 'Shortlisted · Pending Docs', tone: 'teal' },
  rejected_screening: { label: 'Rejected (Screening)', tone: 'red' },
  docs_under_review: { label: 'Docs Under Review', tone: 'amber' },
  qualified: { label: 'Qualified', tone: 'green' },
  not_qualified: { label: 'Not Qualified', tone: 'red' },
  interview_invited: { label: 'Interview Invited', tone: 'teal' },
  interview_confirmed: { label: 'Interview Confirmed', tone: 'teal' },
  interview_completed: { label: 'Pending Evaluation', tone: 'amber' },
  offer_sent: { label: 'Offer Sent', tone: 'teal' },
  offer_pending: { label: 'Pending Offer Response', tone: 'amber' },
  offer_accepted: { label: 'Offer Accepted', tone: 'green' },
  offer_rejected: { label: 'Offer Rejected', tone: 'red' },
  offer_expired: { label: 'Offer Expired', tone: 'red' },
  rejected_post_interview: { label: 'Rejected (Post-Interview)', tone: 'red' },
};

export const ROLE_META: Record<
  StaffRole,
  { label: string; summary: string; canViewPii: boolean; canViewSalary: boolean; canExportCsv: boolean }
> = {
  hr_admin: {
    label: 'HR Admin',
    summary: 'Full access to candidate PII, academic transcripts, MYR salary packages, offer letters, and Excel CSV exports.',
    canViewPii: true,
    canViewSalary: true,
    canExportCsv: true,
  },
  recruiter: {
    label: 'Recruiter',
    summary: 'Operational access to screening, document verification, and interview scheduling. MYR salary packages are masked.',
    canViewPii: true,
    canViewSalary: false,
    canExportCsv: false,
  },
  hiring_manager: {
    label: 'Hiring Manager',
    summary: 'Restricted to interview schedules and evaluation scorecards. Raw PII, academic certificates, and MYR salaries are masked.',
    canViewPii: false,
    canViewSalary: false,
    canExportCsv: false,
  },
};
