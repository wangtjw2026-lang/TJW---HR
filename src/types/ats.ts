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

export type UserApprovalStatus = 'pending' | 'approved' | 'rejected';

export type TwoFaMethod = 'EMAIL_OTP' | 'AUTHENTICATOR_APP';
export type TwoFaChangeStatus = 'locked' | 'pending_admin_approval';
export type TwoFaRequestedAction =
  | 'RESET_2FA'
  | 'DISABLE_2FA'
  | 'ENABLE_2FA'
  | 'SWITCH_TO_AUTHENTICATOR_APP'
  | 'SWITCH_TO_EMAIL_OTP';

export interface TwoFaRequestedPayload {
  action: TwoFaRequestedAction;
  reason: string;
  requested_at: string;
}

export interface StaffUser {
  id: number;
  name: string;
  email: string;
  role: StaffRole;
  department: string;
  status: UserApprovalStatus;
  approved_by: string;
  approved_at: string;
  two_fa_enabled: boolean;
  two_fa_method: TwoFaMethod;
  two_fa_change_status: TwoFaChangeStatus;
  two_fa_requested_state: string;
  two_fa_approved_by: string;
  created_at?: string;
}

export interface DangerZoneStats {
  candidates: {
    total: number;
    active: number;
    rejectedOrWithdrawn: number;
  };
  files: {
    dbDocumentRecords: number;
    filesOnDisk: number;
    totalDiskBytes: number;
    rejectedCandidateFiles: number;
  };
  interviews: {
    totalSlots: number;
    activeSlots: number;
    bookedSlots: number;
    unbookedFutureSlots: number;
    totalBookings: number;
    confirmedBookings: number;
  };
  users: {
    totalUsers: number;
    approvedUsers: number;
    pendingUsers: number;
    rejectedOrLockedUsers: number;
    twoFaLockedUsers: number;
    pendingTwoFaRequests: number;
  };
  auditLogs: {
    totalEntries: number;
    immutableProtected: boolean;
    triggers: string[];
  };
  pendingTwoFaUsers: StaffUser[];
}

export type AiDocumentVerificationStatus =
  | ''
  | 'VERIFIED_MATCH'
  | 'NAME_MISMATCH'
  | 'REVIEW_NEEDED'
  | 'AI_FAILED';

export interface AiDocumentExtractionPayload {
  // Common academic & certificate fields
  document_detected?: string;
  candidate_name_on_doc?: string;
  name_matches_candidate?: boolean;
  verification_notes?: string;
  // SPM & UEC fields
  exam_year?: string;
  school_name?: string;
  grades_summary?: string;
  total_credits?: string | number;
  // Degree fields
  university_name?: string;
  degree_title?: string;
  honours_class?: string;
  graduation_year?: string;
  // Transcript fields
  program_name?: string;
  cgpa?: string;
  semesters_completed?: string | number;
  // Resume fields
  full_name?: string;
  email?: string;
  phone?: string;
  location?: string;
  years_experience?: number;
  has_uec?: boolean;
  skills?: string[];
  education?: string;
  experience?: string;
  ai_score?: number;
  ai_summary?: string;
  // Metadata & error state
  model_used?: string;
  extracted_at?: string;
  error?: string;
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
  ai_extracted_json: string;
  ai_verified_status: AiDocumentVerificationStatus;
  ai_extracted: AiDocumentExtractionPayload | null;
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
  recent_emails?: EmailLogRecord[];
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
  smtp_error: string;
  message_id: string;
  triggered_by: string;
  created_at: string;
}

export interface SmtpConfigStatus {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  userMasked: string;
  reason?: string;
}

export interface EmailDeliveryResult {
  id: number;
  delivery_status: 'SENT_SMTP' | 'SMTP_FAILED' | 'LOGGED_LOCAL';
  smtp_error: string;
  message_id: string;
  recipient_email: string;
  subject: string;
  template_type: string;
}

export type AuditActorRole = 'administrator' | 'manager' | 'candidate_portal' | 'system';

export interface AuditLogRecord {
  id: number;
  timestamp: string;
  actor_id: number | null;
  actor_name: string;
  actor_role: AuditActorRole;
  page_visited: string;
  action_taken: string;
  target_entity: string;
  details: string;
  ip_address: string;
  user_agent: string;
}

export interface AuditLogFilters {
  search: string;
  actor: string;
  role: string;
  page_visited: string;
  action_taken: string;
  date_from: string;
  date_to: string;
}

export interface AuditLogsQueryResult {
  auditLogs: AuditLogRecord[];
  totalCount: number;
  facets: {
    actors: string[];
    pages: string[];
    actions: string[];
  };
}

export interface ParsedResumeResult {
  full_name: string;
  email: string;
  phone: string;
  location: string;
  years_experience: number;
  has_uec: boolean;
  skills: string[] | string;
  education: string;
  experience: string;
  ai_score: number;
  ai_summary: string;
  // Defensive optional aliases
  fullName?: string;
  name?: string;
  contact_number?: string;
  education_summary?: string;
  educationSummary?: string;
  experience_summary?: string;
  experienceSummary?: string;
  yearsExperience?: number;
  hasUec?: boolean;
  detected_uec_mention?: boolean;
  detectedUecMention?: boolean;
  aiMatchScore?: number;
  match_score?: number;
  score?: number;
  aiSummary?: string;
  extracted?: Record<string, unknown>;
  data?: Record<string, unknown>;
  result?: Record<string, unknown>;
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
    title: string;
    badgeLabel: string;
    accessLimits: string;
    summary: string;
    allowed: string[];
    restricted: string[];
    canWrite: boolean;
    canViewSalary: boolean;
    canExportCsv: boolean;
    canManageUsers: boolean;
  }
> = {
  administrator: {
    label: 'System Administrator',
    title: 'System Administrator — Full Access',
    badgeLabel: 'System Administrator',
    accessLimits: 'Full read/write, AI screening, emails, exports & user admin',
    summary:
      'Full administrative control across all recruitment pipelines, candidate records, AI screening, interview scheduling, offers, email automation, CSV/audit exports, and staff access approvals.',
    allowed: [
      'View all candidates, resumes, academic transcripts, interview schedules, offers, email logs, and audit trails.',
      'Create, edit, screen, qualify, advance, reject, or delete candidates and run Gemini AI document extraction.',
      'Create and manage interview slots, issue or update MYR offers, and send or resend SMTP emails.',
      'Export Excel candidate reports and download tamper-proof Audit Trail CSV logs.',
      'Create, approve, reject, change roles, or delete staff user accounts.',
    ],
    restricted: [
      'Cannot edit or delete tamper-evident audit trail records.',
      'Cannot delete or demote the last remaining active System Administrator account.',
    ],
    canWrite: true,
    canViewSalary: true,
    canExportCsv: true,
    canManageUsers: true,
  },
  manager: {
    label: 'Hiring Manager',
    title: 'Hiring Manager — View & Review Only',
    badgeLabel: 'Hiring Manager (View Only)',
    accessLimits: 'Read-only pipeline, profiles, docs, calendar & offers',
    summary:
      'Strict read-only review access to the Pipeline Dashboard, Candidate Database, Candidate Profiles & Uploaded Documents, Interview Calendar, Offer Statuses, and Logs.',
    allowed: [
      'View Pipeline Dashboard metrics and recruitment stage summaries.',
      'Browse Candidate Database, Candidate Profiles, resumes, and uploaded academic transcripts.',
      'View Interview Calendar schedules, panel bookings, and Employment Offer statuses.',
      'Inspect Email Automation logs and User Activity Audit Trail records (read-only).',
    ],
    restricted: [
      'Blocked (HTTP 403) from adding, editing, or deleting candidates or triggering Gemini AI scans.',
      'Blocked (HTTP 403) from changing screening, qualification, or post-interview decisions.',
      'Blocked (HTTP 403) from managing interview slots, issuing/updating offers, or sending/resending emails.',
      'Blocked (HTTP 403) from exporting Excel candidate reports, downloading Audit Trail CSVs, or managing users.',
    ],
    canWrite: false,
    canViewSalary: true,
    canExportCsv: false,
    canManageUsers: false,
  },
};
