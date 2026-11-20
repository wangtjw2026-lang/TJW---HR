export const GOOGLE_APPS_SCRIPT_URLS = {
  employmentApplicationForm:
    'https://script.google.com/macros/s/AKfycbzmwDILioaOGbozPl9t13wCJLpdF_T99WHAglBDJJXvEZTmWIt2oilSNYLyyatK6cG0/exec',
  discPersonalityAssessment:
    'https://script.google.com/macros/s/AKfycby-lUFDHSd2NmbiS3Gbg8Y22Ql8smy3XjatCdIs3s5AZ2yeqTBUB6dBQbhgt5EpDt1W/exec',
} as const;

export type StaffRole = 'administrator' | 'manager';

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

export type DocType = 'RESUME' | 'APP_FORM' | 'DISC' | 'SPM' | 'UEC' | 'DEGREE' | 'TRANSCRIPT';

export type ScreeningDecision = 'pending' | 'proceed' | 'reject';
export type QualificationStatus = 'pending' | 'qualified' | 'not_qualified';
export type PostInterviewDecision = 'pending' | 'offer' | 'reject';
export type OfferStatus = 'Offer Sent' | 'Pending Response' | 'Accepted' | 'Rejected' | 'Expired';
export type BookingStatus = 'CONFIRMED' | 'RESCHEDULED' | 'CANCELLED' | 'COMPLETED';

export type InterviewMode =
  | 'Google Meet'
  | 'Microsoft Teams'
  | 'On-site (KL HQ)'
  | 'On-site (Penang)';

export interface StaffUser {
  id: number;
  name: string;
  email: string;
  role: StaffRole;
  department: string;
  created_at?: string;
}

export interface CandidateDocument {
  id: number;
  candidate_id: number;
  doc_type: DocType;
  completed: boolean;
  verified: boolean;
  not_applicable: boolean;
  file_name: string;
  file_path: string;
  uploaded_at: string;
}

export interface InterviewBooking {
  id: number;
  slot_id: number;
  candidate_id: number;
  candidate_name?: string;
  candidate_position?: string;
  status: BookingStatus;
  booked_at: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  location_or_link?: string;
  interviewer_name?: string;
  mode?: string;
}

export interface OfferRecord {
  id: number;
  candidate_id: number;
  position: string;
  department: string;
  salary_myr: number | null;
  allowance_myr: number | null;
  probation_months: number;
  start_date: string;
  issue_date: string;
  deadline_date: string;
  offer_letter_path: string;
  offer_terms_summary: string;
  status: OfferStatus;
  candidate_response_note: string;
  responded_at: string;
  created_at: string;
}

export interface CandidateRecord {
  id: number;
  candidate_code: string;
  full_name: string;
  phone: string;
  email: string;
  location: string;
  position: string;
  department: string;
  source: ApplicationSource;
  applied_date: string;
  stage: number;
  status: CandidateStatus;
  education: string;
  experience: string;
  years_experience: number;
  skills: string[];
  ai_score: number;
  ai_summary: string;
  screening_decision: ScreeningDecision;
  screening_remarks: string;
  disc_profile: string;
  last_doc_reminder_at: string;
  qualification_status: QualificationStatus;
  qualification_remarks: string;
  interview_feedback: string;
  interview_rating: number;
  post_interview_decision: PostInterviewDecision;
  final_decision_notes: string;
  portal_token: string;
  created_at: string;
  updated_at: string;
  documents: CandidateDocument[];
  active_booking: InterviewBooking | null;
  offer: OfferRecord | null;
}

export interface InterviewSlot {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  booked_count: number;
  location_or_link: string;
  interviewer_name: string;
  department: string;
  mode: InterviewMode;
  status: 'ACTIVE' | 'CANCELLED';
  created_at: string;
  bookings: InterviewBooking[];
}

export interface EmailLogRecord {
  id: number;
  candidate_id: number | null;
  candidate_name: string;
  recipient_email: string;
  template_type: string;
  subject: string;
  body_preview: string;
  stage_triggered: number;
  delivery_status: string;
  triggered_by: string;
  created_at: string;
}

export interface AuditLogRecord {
  id: number;
  actor_id: number | null;
  actor_email: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  details: string;
  created_at: string;
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
  offerStatus: '' | OfferStatus | 'NONE';
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
  {
    label: string;
    badgeLabel: string;
    summary: string;
    canWrite: boolean;
    canViewSalary: boolean;
    canExportCsv: boolean;
    canManageUsers: boolean;
  }
> = {
  administrator: {
    label: 'Administrator',
    badgeLabel: 'Administrator',
    summary:
      'Full access — view all records, add/edit/delete candidates, run AI resume screening, make hiring decisions, manage interview slots, issue offers, send emails, export reports, and manage user accounts.',
    canWrite: true,
    canViewSalary: true,
    canExportCsv: true,
    canManageUsers: true,
  },
  manager: {
    label: 'Manager',
    badgeLabel: 'Manager (View Only)',
    summary:
      'Read-only access — view the dashboard, recruitment pipeline, candidate profiles, uploaded resumes/academic documents, interview calendar, offer statuses, and export reports. Cannot modify records or manage users.',
    canWrite: false,
    canViewSalary: true,
    canExportCsv: true,
    canManageUsers: false,
  },
};
