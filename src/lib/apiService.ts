import {
  AuditLogRecord,
  BookingStatus,
  CandidateRecord,
  DocType,
  EmailLogRecord,
  InterviewMode,
  InterviewSlot,
  OfferStatus,
  ParsedResumeResult,
  PostInterviewDecision,
  QualificationStatus,
  ScreeningDecision,
  StaffRole,
  StaffUser,
} from '../types/ats';

const TOKEN_STORAGE_KEY = 'talentflow_my_jwt';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

async function apiFetch<T>(url: string, options: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (auth) {
    const token = getStoredToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || `HTTP ${res.status}` };
  }

  if (!res.ok) {
    const errMsg =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed with status ${res.status}`;
    if (res.status === 401 && auth) {
      setStoredToken(null);
    }
    throw new Error(errMsg);
  }

  return data as T;
}

export function getProtectedFileUrl(filename: string, portalToken?: string): string {
  const encoded = encodeURIComponent(filename);
  if (portalToken) {
    return `/api/files/${encoded}?portal_token=${encodeURIComponent(portalToken)}`;
  }
  const token = getStoredToken() || '';
  return `/api/files/${encoded}?auth=${encodeURIComponent(token)}`;
}

// =============================================================================
// AUTH, FIRST-RUN SETUP & STAFF USERS
// =============================================================================
export async function fetchAuthSetupStatus(): Promise<{ needsSetup: boolean }> {
  return apiFetch<{ needsSetup: boolean }>('/api/auth/setup-status', {}, false);
}

export async function setupInitialHrAdmin(params: {
  name: string;
  email: string;
  password: string;
  department?: string;
}): Promise<{ token: string; user: StaffUser }> {
  const data = await apiFetch<{ token: string; user: StaffUser }>(
    '/api/auth/setup',
    {
      method: 'POST',
      body: JSON.stringify(params),
    },
    false
  );
  setStoredToken(data.token);
  return data;
}

export async function loginStaff(email: string, password: string): Promise<{ token: string; user: StaffUser }> {
  const data = await apiFetch<{ token: string; user: StaffUser }>(
    '/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    },
    false
  );
  setStoredToken(data.token);
  return data;
}

export async function fetchCurrentUser(): Promise<StaffUser> {
  const data = await apiFetch<{ user: StaffUser }>('/api/auth/me');
  return data.user;
}

export function logoutStaff(): void {
  setStoredToken(null);
}

export async function fetchStaffUsers(): Promise<StaffUser[]> {
  const data = await apiFetch<{ users: StaffUser[] }>('/api/users');
  return data.users;
}

export async function createStaffUser(params: {
  name: string;
  email: string;
  password: string;
  role: StaffRole;
  department: string;
}): Promise<StaffUser> {
  const data = await apiFetch<{ user: StaffUser }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.user;
}

export async function updateStaffUser(id: number, role: StaffRole, department: string): Promise<StaffUser> {
  const data = await apiFetch<{ user: StaffUser }>(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role, department }),
  });
  return data.user;
}

export async function deleteStaffUser(id: number): Promise<void> {
  await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
}

// =============================================================================
// GEMINI AI RESUME PARSER
// =============================================================================
export async function parseResumeWithAi(payload: {
  resumeText?: string;
  fileBase64?: string;
  fileMimeType?: string;
  fileName?: string;
  positionApplied: string;
  department: string;
  jobRequirements?: string;
}): Promise<ParsedResumeResult> {
  return apiFetch<ParsedResumeResult>('/api/ai/parse-resume', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// =============================================================================
// CANDIDATES & WORKFLOW
// =============================================================================
export async function fetchCandidates(): Promise<CandidateRecord[]> {
  const data = await apiFetch<{ candidates: CandidateRecord[] }>('/api/candidates');
  return data.candidates;
}

export async function registerCandidate(params: {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  positionApplied: string;
  department: string;
  source: 'JobStreet' | 'Email';
  educationSummary: string;
  experienceSummary: string;
  yearsExperience: number;
  skills: string[];
  aiMatchScore: number;
  aiSummary: string;
  hasUec: boolean;
  resumeFile?: File | null;
  resumeFileName?: string;
}): Promise<CandidateRecord> {
  const form = new FormData();
  form.append('full_name', params.fullName);
  form.append('email', params.email);
  form.append('phone', params.phone);
  form.append('location', params.location);
  form.append('position', params.positionApplied);
  form.append('department', params.department);
  form.append('source', params.source);
  form.append('education', params.educationSummary);
  form.append('experience', params.experienceSummary);
  form.append('years_experience', String(params.yearsExperience));
  form.append('skills', JSON.stringify(params.skills));
  form.append('ai_score', String(params.aiMatchScore));
  form.append('ai_summary', params.aiSummary);
  form.append('hasUec', String(params.hasUec));
  if (params.resumeFile) {
    form.append('resumeFile', params.resumeFile);
  } else if (params.resumeFileName) {
    form.append('resumeFileName', params.resumeFileName);
  }

  const data = await apiFetch<{ candidate: CandidateRecord }>('/api/candidates', {
    method: 'POST',
    body: form,
  });
  return data.candidate;
}

export async function submitScreeningDecision(
  candidateId: number,
  screening_decision: ScreeningDecision,
  screening_remarks: string
): Promise<CandidateRecord> {
  const data = await apiFetch<{ candidate: CandidateRecord }>(`/api/candidates/${candidateId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      actionType: 'screening_decision',
      screening_decision,
      screening_remarks,
    }),
  });
  return data.candidate;
}

export async function updateCandidateDocsChecklist(
  candidateId: number,
  documents: Array<{ doc_type: DocType; completed: boolean; verified: boolean; not_applicable: boolean }>,
  disc_profile: string
): Promise<CandidateRecord> {
  const data = await apiFetch<{ candidate: CandidateRecord }>(`/api/candidates/${candidateId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      actionType: 'docs_verification',
      documents,
      disc_profile,
    }),
  });
  return data.candidate;
}

export async function uploadCandidateDocument(
  candidateId: number,
  docType: DocType,
  file: File
): Promise<CandidateRecord> {
  const form = new FormData();
  form.append('doc_type', docType);
  form.append('file', file);
  const data = await apiFetch<{ candidate: CandidateRecord }>(`/api/candidates/${candidateId}/documents`, {
    method: 'POST',
    body: form,
  });
  return data.candidate;
}

export async function sendDocReminder(candidateId: number): Promise<CandidateRecord> {
  const data = await apiFetch<{ candidate: CandidateRecord }>(`/api/candidates/${candidateId}/remind-docs`, {
    method: 'POST',
  });
  return data.candidate;
}

export async function sendBatchDocReminders(candidateIds: number[]): Promise<number> {
  const data = await apiFetch<{ sentCount: number }>('/api/candidates/remind-docs-batch', {
    method: 'POST',
    body: JSON.stringify({ candidateIds }),
  });
  return data.sentCount;
}

export async function submitQualificationDecision(
  candidateId: number,
  qualification_status: QualificationStatus,
  qualification_remarks: string
): Promise<CandidateRecord> {
  const data = await apiFetch<{ candidate: CandidateRecord }>(`/api/candidates/${candidateId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      actionType: 'qualification_decision',
      qualification_status,
      qualification_remarks,
    }),
  });
  return data.candidate;
}

export async function submitPostInterviewDecision(
  candidateId: number,
  interview_feedback: string,
  interview_rating: number,
  post_interview_decision: PostInterviewDecision,
  final_decision_notes: string
): Promise<CandidateRecord> {
  const data = await apiFetch<{ candidate: CandidateRecord }>(`/api/candidates/${candidateId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      actionType: 'post_interview',
      interview_feedback,
      interview_rating,
      post_interview_decision,
      final_decision_notes,
    }),
  });
  return data.candidate;
}

export async function sendEmploymentOffer(
  candidateId: number,
  params: {
    position: string;
    department: string;
    salary_myr: number;
    allowance_myr: number;
    probation_months: number;
    start_date: string;
    deadline_date: string;
    offer_terms_summary: string;
    offerLetterFile?: File | null;
  }
): Promise<CandidateRecord> {
  const form = new FormData();
  form.append('position', params.position);
  form.append('department', params.department);
  form.append('salary_myr', String(params.salary_myr));
  form.append('allowance_myr', String(params.allowance_myr));
  form.append('probation_months', String(params.probation_months));
  form.append('start_date', params.start_date);
  form.append('deadline_date', params.deadline_date);
  form.append('offer_terms_summary', params.offer_terms_summary);
  if (params.offerLetterFile) {
    form.append('offerLetter', params.offerLetterFile);
  }
  const data = await apiFetch<{ candidate: CandidateRecord }>(`/api/candidates/${candidateId}/offer`, {
    method: 'POST',
    body: form,
  });
  return data.candidate;
}

export async function updateOfferStatus(
  candidateId: number,
  status: OfferStatus,
  candidate_response_note: string
): Promise<CandidateRecord> {
  const data = await apiFetch<{ candidate: CandidateRecord }>(`/api/candidates/${candidateId}/offer-status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, candidate_response_note }),
  });
  return data.candidate;
}

export async function deleteCandidate(candidateId: number): Promise<void> {
  await apiFetch(`/api/candidates/${candidateId}`, { method: 'DELETE' });
}

// =============================================================================
// INTERVIEW SLOTS & ATOMIC BOOKING
// =============================================================================
export async function fetchInterviewSlots(): Promise<InterviewSlot[]> {
  const data = await apiFetch<{ slots: InterviewSlot[] }>('/api/interview-slots');
  return data.slots;
}

export async function createInterviewSlot(params: {
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  location_or_link: string;
  interviewer_name: string;
  department: string;
  mode: InterviewMode;
}): Promise<InterviewSlot> {
  const data = await apiFetch<{ slot: InterviewSlot }>('/api/interview-slots', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.slot;
}

export async function updateInterviewSlot(
  slotId: number,
  updates: Partial<{
    date: string;
    start_time: string;
    end_time: string;
    capacity: number;
    location_or_link: string;
    interviewer_name: string;
    status: 'ACTIVE' | 'CANCELLED';
  }>
): Promise<InterviewSlot> {
  const data = await apiFetch<{ slot: InterviewSlot }>(`/api/interview-slots/${slotId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return data.slot;
}

export async function deleteInterviewSlot(slotId: number): Promise<void> {
  await apiFetch(`/api/interview-slots/${slotId}`, { method: 'DELETE' });
}

export async function bookInterviewSlotAtomically(
  slotId: number,
  candidateId: number
): Promise<{ slot: InterviewSlot; candidate: CandidateRecord }> {
  return apiFetch(`/api/interview-slots/${slotId}/book`, {
    method: 'POST',
    body: JSON.stringify({ candidateId }),
  });
}

export async function updateBookingStatus(bookingId: number, status: BookingStatus): Promise<void> {
  await apiFetch(`/api/interview-bookings/${bookingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// =============================================================================
// PUBLIC CANDIDATE PORTAL (/api/portal/:token — No JWT required)
// =============================================================================
export async function fetchPortalData(
  portalToken: string
): Promise<{ candidate: CandidateRecord; availableSlots: InterviewSlot[] }> {
  return apiFetch(`/api/portal/${encodeURIComponent(portalToken)}`, {}, false);
}

export async function portalUploadDocument(
  portalToken: string,
  docType: DocType,
  file: File
): Promise<{ candidate: CandidateRecord; availableSlots: InterviewSlot[] }> {
  const form = new FormData();
  form.append('action', 'upload_document');
  form.append('doc_type', docType);
  form.append('file', file);
  return apiFetch(
    `/api/portal/${encodeURIComponent(portalToken)}`,
    { method: 'POST', body: form },
    false
  );
}

export async function portalMarkFormsComplete(
  portalToken: string,
  appFormCompleted: boolean,
  discCompleted: boolean
): Promise<{ candidate: CandidateRecord; availableSlots: InterviewSlot[] }> {
  return apiFetch(
    `/api/portal/${encodeURIComponent(portalToken)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        action: 'complete_forms',
        app_form_completed: appFormCompleted,
        disc_completed: discCompleted,
      }),
    },
    false
  );
}

export async function portalBookInterviewSlot(
  portalToken: string,
  slotId: number
): Promise<{ candidate: CandidateRecord; availableSlots: InterviewSlot[] }> {
  return apiFetch(
    `/api/portal/${encodeURIComponent(portalToken)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        action: 'book_slot',
        slot_id: slotId,
      }),
    },
    false
  );
}

export async function portalRespondToOffer(
  portalToken: string,
  accepted: boolean,
  note: string
): Promise<{ candidate: CandidateRecord; availableSlots: InterviewSlot[] }> {
  return apiFetch(
    `/api/portal/${encodeURIComponent(portalToken)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        action: 'offer_response',
        accepted,
        note,
      }),
    },
    false
  );
}

// =============================================================================
// EMAIL LOGS & AUDIT LOGS
// =============================================================================
export async function fetchEmailLogs(): Promise<EmailLogRecord[]> {
  const data = await apiFetch<{ emailLogs: EmailLogRecord[] }>('/api/email-logs');
  return data.emailLogs;
}

export async function fetchAuditLogs(): Promise<AuditLogRecord[]> {
  const data = await apiFetch<{ auditLogs: AuditLogRecord[] }>('/api/audit-logs');
  return data.auditLogs;
}

export async function logCsvExport(count: number): Promise<void> {
  await apiFetch('/api/audit-logs/export', {
    method: 'POST',
    body: JSON.stringify({ count }),
  });
}
