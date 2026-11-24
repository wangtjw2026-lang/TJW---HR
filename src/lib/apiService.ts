import {
  AuditLogFilters,
  AuditLogRecord,
  AuditLogsQueryResult,
  BookingStatus,
  CandidateRecord,
  DangerZoneStats,
  DocType,
  EmailDeliveryResult,
  EmailLogRecord,
  InterviewMode,
  InterviewSlot,
  OfferStatus,
  ParsedResumeResult,
  PostInterviewDecision,
  PublicPortalUrlStatus,
  QualificationStatus,
  ScreeningDecision,
  SmtpConfigStatus,
  StaffRole,
  StaffUser,
  TwoFaRequestedAction,
} from '../types/ats';

const TOKEN_STORAGE_KEY = 'talentflow_my_jwt';

type SessionExpiredListener = (info: { code?: string; message: string }) => void;
let sessionExpiredListener: SessionExpiredListener | null = null;
let currentAuditPageHeader = 'Pipeline Dashboard';

export function registerSessionExpiredHandler(listener: SessionExpiredListener | null): void {
  sessionExpiredListener = listener;
}

export function setCurrentAuditPage(pageName: string): void {
  currentAuditPageHeader = pageName || 'Pipeline Dashboard';
}

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

async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
  auth = true,
  timeoutMs?: number
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (auth) {
    const token = getStoredToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (currentAuditPageHeader && !headers.has('X-Page-Visited')) {
      headers.set('X-Page-Visited', currentAuditPageHeader);
    }
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  let controller: AbortController | null = null;
  let timerId: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs && timeoutMs > 0 && !options.signal) {
    controller = new AbortController();
    timerId = setTimeout(() => controller?.abort(), timeoutMs);
  }

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: options.signal ?? controller?.signal,
    });
    const text = await res.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || `HTTP ${res.status}` };
    }

    if (!res.ok) {
      const dataObj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
      const errMsg =
        'error' in dataObj ? String(dataObj.error) : `Request failed with status ${res.status}`;
      const errCode = typeof dataObj.code === 'string' ? dataObj.code : undefined;

      if (res.status === 401 && auth) {
        setStoredToken(null);
        sessionExpiredListener?.({ code: errCode, message: errMsg });
      }
      throw new Error(errMsg);
    }

    return data as T;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out while waiting for the server. Please try again.');
    }
    throw err;
  } finally {
    if (timerId) clearTimeout(timerId);
  }
}

export function getProtectedFileUrl(filename: string, portalToken?: string): string {
  const isGdrive = filename.startsWith('gdrive://');
  const authParam = portalToken
    ? `portal_token=${encodeURIComponent(portalToken)}`
    : `auth=${encodeURIComponent(getStoredToken() || '')}`;
  if (isGdrive) {
    return `/api/files/gdrive?ref=${encodeURIComponent(filename)}&${authParam}`;
  }
  const encoded = encodeURIComponent(filename);
  return `/api/files/${encoded}?${authParam}`;
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

export async function requestStaffAccess(params: {
  name: string;
  email: string;
  password: string;
  role: StaffRole;
  department: string;
}): Promise<{ message: string; user: StaffUser }> {
  return apiFetch<{ message: string; user: StaffUser }>(
    '/api/auth/register-request',
    {
      method: 'POST',
      body: JSON.stringify(params),
    },
    false
  );
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

export async function keepSessionAlive(): Promise<void> {
  await apiFetch('/api/auth/keep-alive', { method: 'POST' });
}

export async function logoutStaffSession(params?: {
  reason?: 'manual' | 'idle_timeout';
  page_visited?: string;
}): Promise<void> {
  const token = getStoredToken();
  setStoredToken(null);
  if (!token) return;
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason: params?.reason || 'manual',
        page_visited: params?.page_visited || currentAuditPageHeader,
      }),
    });
  } catch {
    // Best-effort server logout notification; local token is already cleared
  }
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

export async function approveStaffUser(
  id: number,
  role: StaffRole,
  department?: string
): Promise<StaffUser> {
  const data = await apiFetch<{ user: StaffUser }>(`/api/users/${id}/approve`, {
    method: 'PATCH',
    body: JSON.stringify({ role, ...(department ? { department } : {}) }),
  });
  return data.user;
}

export async function rejectStaffUser(id: number, reason?: string): Promise<StaffUser> {
  const data = await apiFetch<{ user: StaffUser }>(`/api/users/${id}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ reason: reason || '' }),
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
// 2FA GOVERNANCE & SYSTEM ADMINISTRATOR DANGER ZONE
// =============================================================================
export async function requestMyTwoFaChange(params: {
  requested_action: TwoFaRequestedAction;
  reason: string;
}): Promise<{ message: string; user: StaffUser }> {
  return apiFetch<{ message: string; user: StaffUser }>('/api/users/me/request-2fa-change', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function reviewUserTwoFaChange(
  userId: number,
  params: {
    decision: 'approve' | 'deny';
    admin_password: string;
    requested_action?: TwoFaRequestedAction;
    notes?: string;
  }
): Promise<{ user: StaffUser; stats: DangerZoneStats }> {
  return apiFetch<{ user: StaffUser; stats: DangerZoneStats }>(
    `/api/admin/users/${userId}/2fa-approval`,
    {
      method: 'PATCH',
      body: JSON.stringify(params),
    }
  );
}

export async function fetchDangerZoneStats(): Promise<DangerZoneStats> {
  const data = await apiFetch<{ stats: DangerZoneStats }>('/api/admin/danger-zone/stats');
  return data.stats;
}

export async function purgeRejectedCandidates(params: {
  admin_password: string;
  confirmation_phrase: string;
}): Promise<{ purgedCandidates: number; removedFiles: number; stats: DangerZoneStats }> {
  return apiFetch<{ purgedCandidates: number; removedFiles: number; stats: DangerZoneStats }>(
    '/api/admin/danger-zone/purge-rejected-candidates',
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
}

export async function revokeAllUserSessions(params: {
  admin_password: string;
  confirmation_phrase: string;
}): Promise<{ revokedAccounts: number; forceReauth: boolean }> {
  return apiFetch<{ revokedAccounts: number; forceReauth: boolean }>(
    '/api/admin/danger-zone/revoke-all-sessions',
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
}

export async function resetUnbookedInterviewSlots(params: {
  admin_password: string;
  confirmation_phrase: string;
}): Promise<{ deletedSlots: number; preservedBookedSlots: number; stats: DangerZoneStats }> {
  return apiFetch<{ deletedSlots: number; preservedBookedSlots: number; stats: DangerZoneStats }>(
    '/api/admin/danger-zone/reset-interview-slots',
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
}

// =============================================================================
// GEMINI AI RESUME PARSER
// =============================================================================
function unwrapResumePayload(res: unknown): ParsedResumeResult {
  const root = (res && typeof res === 'object' ? res : {}) as Record<string, unknown>;
  const nested =
    (root.extracted && typeof root.extracted === 'object' ? root.extracted : null) ||
    (root.data && typeof root.data === 'object' ? root.data : null) ||
    (root.result && typeof root.result === 'object' ? root.result : null) ||
    root;
  const payload = (Array.isArray(nested) ? nested[0] || {} : nested) as Record<string, unknown>;

  const skillsRaw = payload.skills;
  const skills = Array.isArray(skillsRaw)
    ? skillsRaw.map((s) => String(s).trim()).filter(Boolean)
    : typeof skillsRaw === 'string'
      ? skillsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const rawScore = Number(
    payload.ai_score ?? payload.aiMatchScore ?? payload.match_score ?? payload.score
  );
  const rawYears = Number(payload.years_experience ?? payload.yearsExperience);

  return {
    full_name: String(payload.full_name ?? payload.fullName ?? payload.name ?? '').trim(),
    email: String(payload.email ?? '').trim(),
    phone: String(payload.phone ?? payload.contact_number ?? '').trim(),
    location: String(payload.location ?? '').trim(),
    years_experience: Number.isFinite(rawYears) ? rawYears : 0,
    has_uec: Boolean(
      payload.has_uec ?? payload.hasUec ?? payload.detected_uec_mention ?? payload.detectedUecMention
    ),
    skills,
    education: String(
      payload.education ?? payload.education_summary ?? payload.educationSummary ?? ''
    ).trim(),
    experience: String(
      payload.experience ?? payload.experience_summary ?? payload.experienceSummary ?? ''
    ).trim(),
    ai_score: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0,
    ai_summary: String(payload.ai_summary ?? payload.aiSummary ?? '').trim(),
  };
}

export async function parseResumeWithAi(payload: {
  file?: File | null;
  resumeText?: string;
  position: string;
  department?: string;
  rubric?: string;
}): Promise<ParsedResumeResult> {
  const cleanedText = String(payload.resumeText ?? '')
    .replace(/\uFFFD/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .trim();

  if (payload.file) {
    const form = new FormData();
    form.append('file', payload.file);
    if (cleanedText) {
      form.append('resumeText', cleanedText);
    }
    form.append('position', payload.position);
    if (payload.department) {
      form.append('department', payload.department);
    }
    if (payload.rubric?.trim()) {
      form.append('rubric', payload.rubric.trim());
    }
    const raw = await apiFetch<unknown>(
      '/api/ai/parse-resume',
      {
        method: 'POST',
        body: form,
      },
      true,
      95_000
    );
    return unwrapResumePayload(raw);
  }

  const raw = await apiFetch<unknown>(
    '/api/ai/parse-resume',
    {
      method: 'POST',
      body: JSON.stringify({
        resumeText: cleanedText,
        position: payload.position,
        department: payload.department || '',
        rubric: payload.rubric?.trim() || '',
      }),
    },
    true,
    95_000
  );
  return unwrapResumePayload(raw);
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

  const data = await apiFetch<{ candidate: CandidateRecord }>(
    '/api/candidates',
    {
      method: 'POST',
      body: form,
    },
    true,
    95_000
  );
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
  const data = await apiFetch<{ candidate: CandidateRecord }>(
    `/api/candidates/${candidateId}/documents`,
    {
      method: 'POST',
      body: form,
    },
    true,
    95_000
  );
  return data.candidate;
}

export async function reanalyzeDocumentWithAi(docId: number): Promise<CandidateRecord> {
  const data = await apiFetch<{ candidate: CandidateRecord }>(
    `/api/documents/${docId}/ai-extract`,
    {
      method: 'POST',
    },
    true,
    95_000
  );
  return data.candidate;
}

export async function sendDocReminder(candidateId: number): Promise<CandidateRecord> {
  const data = await apiFetch<{ candidate: CandidateRecord }>(`/api/candidates/${candidateId}/remind-docs`, {
    method: 'POST',
  });
  return data.candidate;
}

export async function sendBatchDocReminders(
  candidateIds: number[]
): Promise<{ sentCount: number; deliveredCount: number; failedCount: number; lastError: string }> {
  return apiFetch<{ sentCount: number; deliveredCount: number; failedCount: number; lastError: string }>(
    '/api/candidates/remind-docs-batch',
    {
      method: 'POST',
      body: JSON.stringify({ candidateIds }),
    }
  );
}

export async function logWhatsAppOutreach(
  candidateId: number,
  payload: {
    phone: string;
    normalizedPhone?: string;
    templateName: string;
    pageVisited?: string;
  }
): Promise<{ logged: boolean }> {
  return apiFetch<{ logged: boolean }>(`/api/candidates/${candidateId}/whatsapp-log`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
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
  form.append('doc_type', docType);
  form.append('file', file);
  return apiFetch(
    `/api/portal/${encodeURIComponent(portalToken)}/documents`,
    { method: 'POST', body: form },
    false,
    95_000
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
// EMAIL LOGS, LIVE GMAIL SMTP & TAMPER-EVIDENT AUDIT LOGS
// =============================================================================
export async function fetchEmailLogsWithStatus(): Promise<{
  emailLogs: EmailLogRecord[];
  smtpStatus: SmtpConfigStatus;
  portalUrlStatus: PublicPortalUrlStatus;
}> {
  return apiFetch<{
    emailLogs: EmailLogRecord[];
    smtpStatus: SmtpConfigStatus;
    portalUrlStatus: PublicPortalUrlStatus;
  }>('/api/email-logs');
}

export async function fetchEmailLogs(): Promise<EmailLogRecord[]> {
  const data = await fetchEmailLogsWithStatus();
  return data.emailLogs;
}

export async function resendEmailLog(
  emailLogId: number,
  pageVisited = 'Email Automation & Audit Trail'
): Promise<{
  emailDelivery: EmailDeliveryResult;
  emailLog: EmailLogRecord;
  candidate: CandidateRecord | null;
}> {
  return apiFetch(`/api/email-logs/${emailLogId}/resend`, {
    method: 'POST',
    body: JSON.stringify({ page_visited: pageVisited }),
  });
}

export async function verifySmtpConnection(): Promise<{
  ok: boolean;
  error: string;
  smtpStatus: SmtpConfigStatus;
}> {
  return apiFetch('/api/smtp/verify', {
    method: 'POST',
  });
}

function buildAuditQueryString(filters?: Partial<AuditLogFilters>, limit?: number): string {
  const params = new URLSearchParams();
  if (filters?.search?.trim()) params.set('search', filters.search.trim());
  if (filters?.actor?.trim()) params.set('actor', filters.actor.trim());
  if (filters?.role?.trim()) params.set('role', filters.role.trim());
  if (filters?.page_visited?.trim()) params.set('page_visited', filters.page_visited.trim());
  if (filters?.action_taken?.trim()) params.set('action_taken', filters.action_taken.trim());
  if (filters?.date_from?.trim()) params.set('date_from', filters.date_from.trim());
  if (filters?.date_to?.trim()) params.set('date_to', filters.date_to.trim());
  if (limit && Number.isFinite(limit)) params.set('limit', String(limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function fetchAuditLogsWithMeta(
  filters?: Partial<AuditLogFilters>,
  limit = 500
): Promise<AuditLogsQueryResult> {
  const qs = buildAuditQueryString(filters, limit);
  const data = await apiFetch<AuditLogsQueryResult>(`/api/audit-logs${qs}`);
  return {
    auditLogs: Array.isArray(data.auditLogs) ? data.auditLogs : [],
    totalCount: Number(data.totalCount) || 0,
    facets: {
      actors: Array.isArray(data.facets?.actors) ? data.facets.actors : [],
      pages: Array.isArray(data.facets?.pages) ? data.facets.pages : [],
      actions: Array.isArray(data.facets?.actions) ? data.facets.actions : [],
    },
  };
}

export async function fetchAuditLogs(filters?: Partial<AuditLogFilters>): Promise<AuditLogRecord[]> {
  const result = await fetchAuditLogsWithMeta(filters);
  return result.auditLogs;
}

export async function logPageVisit(params: {
  page_visited: string;
  target_entity?: string;
  details?: string;
}): Promise<void> {
  try {
    await apiFetch('/api/audit-logs/page-visit', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch {
    // Non-blocking audit telemetry: never interrupt user navigation
  }
}

export async function logCsvExport(count: number, filterSummary?: string): Promise<void> {
  await apiFetch('/api/audit-logs/export', {
    method: 'POST',
    body: JSON.stringify({
      count,
      filter_summary: filterSummary || '',
    }),
  });
}

export async function downloadAuditLogCsv(filters?: Partial<AuditLogFilters>): Promise<string> {
  const qs = buildAuditQueryString(filters);
  const headers = new Headers();
  const token = getStoredToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`/api/audit-logs/export${qs}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    let errMsg = `Export failed with status ${res.status}`;
    let errCode: string | undefined;
    try {
      const text = await res.text();
      const parsed = JSON.parse(text) as { error?: string; code?: string };
      if (parsed?.error) errMsg = parsed.error;
      if (parsed?.code) errCode = parsed.code;
    } catch {
      // use fallback status message
    }
    if (res.status === 401) {
      setStoredToken(null);
      sessionExpiredListener?.({ code: errCode, message: errMsg });
    }
    throw new Error(errMsg);
  }

  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || `TJW_HR_Audit_Trail_${new Date().toISOString().slice(0, 10)}.csv`;

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);

  return filename;
}
