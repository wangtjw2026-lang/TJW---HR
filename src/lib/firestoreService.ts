import { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import {
  AuditTargetType,
  BOOTSTRAPPED_ADMIN_EMAIL,
  CandidatePrivateCompensation,
  CandidatePrivatePii,
  CandidateRecord,
  CandidateStatus,
  DocStatus,
  EmailLogRecord,
  EmailTemplateType,
  InterviewMode,
  InterviewSlot,
  OfferStatus,
  PdpaAuditLogRecord,
  PostInterviewDecision,
  QualificationDecision,
  ScreeningDecision,
  StaffRole,
  StaffUser,
  UecDocStatus,
} from '../types/ats';
import {
  clampString,
  composeAutomatedEmail,
  generateCandidateCode,
  getMissingMandatoryDocs,
  hashContactValue,
  maskEmail,
  maskPhone,
  sanitizeId,
} from './atsHelpers';
import { db, handleFirestoreError, OperationType } from './firebase';

function makeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return sanitizeId(`${prefix}_${Date.now()}_${rand}`);
}

export function isBootstrappedAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase());
}

export async function ensureStaffUserProfile(user: User): Promise<StaffUser> {
  const userRef = doc(db, 'users', user.uid);
  const path = `users/${user.uid}`;
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      return snap.data() as StaffUser;
    }
    const defaultRole: StaffRole = isBootstrappedAdminEmail(user.email) ? 'hr_admin' : 'recruiter';
    const profile: StaffUser = {
      uid: user.uid,
      email: clampString(user.email || 'staff@talentflow.my', 254),
      displayName: clampString(user.displayName || user.email?.split('@')[0] || 'HR Staff', 120),
      role: defaultRole,
      department: 'Human Resources',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(userRef, profile);
    return { ...profile, role: defaultRole };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export function subscribeStaffUsers(
  user: User,
  onData: (users: StaffUser[]) => void
): Unsubscribe {
  const path = 'users';
  const q = isBootstrappedAdminEmail(user.email)
    ? query(collection(db, path))
    : query(collection(db, path), where('uid', '==', user.uid));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as StaffUser);
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function updateStaffUserRole(params: {
  targetUser: StaffUser;
  newRole: StaffRole;
  department: string;
  actor: StaffUser;
}): Promise<void> {
  const { targetUser, newRole, department, actor } = params;
  const userRef = doc(db, 'users', targetUser.uid);
  const path = `users/${targetUser.uid}`;
  try {
    await updateDoc(userRef, {
      role: newRole,
      department: clampString(department || targetUser.department, 80),
      displayName: clampString(targetUser.displayName, 120),
      updatedAt: serverTimestamp(),
    });
    if (newRole === 'hr_admin') {
      const adminRef = doc(db, 'admins', targetUser.uid);
      const adminSnap = await getDoc(adminRef);
      if (!adminSnap.exists()) {
        await setDoc(adminRef, {
          uid: targetUser.uid,
          email: clampString(targetUser.email, 254),
          grantedBy: actor.uid,
          createdAt: serverTimestamp(),
        });
      }
    }
    await recordPdpaAudit({
      actor,
      action: 'RBAC_ROLE_UPDATED',
      targetType: 'rbac',
      targetId: targetUser.uid,
      details: `Updated role for ${targetUser.email} to ${newRole} (${department}).`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeCandidates(
  user: User,
  onData: (candidates: CandidateRecord[]) => void
): Unsubscribe {
  const path = 'candidates';
  const q = isBootstrappedAdminEmail(user.email)
    ? query(collection(db, path))
    : query(collection(db, path), where('assignedStaffIds', 'array-contains', user.uid));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ ...(d.data() as Omit<CandidateRecord, 'id'>), id: d.id }))
        .sort((a, b) => b.applicationDate.localeCompare(a.applicationDate));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeInterviewSlots(
  user: User,
  onData: (slots: InterviewSlot[]) => void
): Unsubscribe {
  const path = 'interviewSlots';
  const q = isBootstrappedAdminEmail(user.email)
    ? query(collection(db, path))
    : query(collection(db, path), where('assignedStaffIds', 'array-contains', user.uid));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ ...(d.data() as Omit<InterviewSlot, 'id'>), id: d.id }))
        .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeEmailLogs(
  user: User,
  onData: (logs: EmailLogRecord[]) => void
): Unsubscribe {
  const path = 'emailLogs';
  const q = isBootstrappedAdminEmail(user.email)
    ? query(collection(db, path))
    : query(collection(db, path), where('assignedStaffIds', 'array-contains', user.uid));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ ...(d.data() as Omit<EmailLogRecord, 'id'>), id: d.id }))
        .sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          const tb = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          return tb - ta;
        });
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeAuditLogs(
  user: User,
  onData: (logs: PdpaAuditLogRecord[]) => void
): Unsubscribe {
  const path = 'auditLogs';
  const q = isBootstrappedAdminEmail(user.email)
    ? query(collection(db, path))
    : query(collection(db, path), where('assignedStaffIds', 'array-contains', user.uid));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ ...(d.data() as Omit<PdpaAuditLogRecord, 'id'>), id: d.id }))
        .sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          const tb = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
          return tb - ta;
        });
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function recordPdpaAudit(params: {
  actor: StaffUser;
  action: string;
  targetType: AuditTargetType;
  targetId: string;
  details: string;
}): Promise<void> {
  const logId = makeDocId('audit');
  const path = `auditLogs/${logId}`;
  try {
    await setDoc(doc(db, 'auditLogs', logId), {
      actorUid: params.actor.uid,
      actorEmail: clampString(params.actor.email, 254),
      actorRole: params.actor.role,
      action: clampString(params.action, 100),
      targetType: params.targetType,
      targetId: clampString(params.targetId, 128),
      details: clampString(params.details, 500),
      ownerId: params.actor.uid,
      assignedStaffIds: [params.actor.uid],
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function logAutomatedEmail(params: {
  actor: StaffUser;
  candidate: CandidateRecord;
  templateType: EmailTemplateType;
  subject: string;
  bodyPreview: string;
  stageTriggered: number;
}): Promise<void> {
  const logId = makeDocId('mail');
  const path = `emailLogs/${logId}`;
  try {
    await setDoc(doc(db, 'emailLogs', logId), {
      candidateId: params.candidate.id,
      candidateName: clampString(params.candidate.fullName, 140),
      maskedRecipient: clampString(params.candidate.maskedEmail, 120),
      templateType: params.templateType,
      subject: clampString(params.subject, 200),
      bodyPreview: clampString(params.bodyPreview, 2000),
      stageTriggered: params.stageTriggered,
      deliveryStatus: 'dispatched',
      triggeredByUid: params.actor.uid,
      ownerId: params.actor.uid,
      assignedStaffIds: [params.actor.uid],
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function fetchCandidatePrivatePii(
  candidateId: string,
  actor: StaffUser,
  logAccess = true
): Promise<CandidatePrivatePii | null> {
  const path = `candidates/${candidateId}/private/pii`;
  try {
    const snap = await getDoc(doc(db, 'candidates', candidateId, 'private', 'pii'));
    if (logAccess) {
      await recordPdpaAudit({
        actor,
        action: 'VIEW_CANDIDATE_PII',
        targetType: 'pii',
        targetId: candidateId,
        details: `Accessed PDPA-protected contact details & academic docs for candidate ${candidateId}.`,
      });
    }
    return snap.exists() ? (snap.data() as CandidatePrivatePii) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function fetchCandidateCompensation(
  candidateId: string,
  actor: StaffUser,
  logAccess = true
): Promise<CandidatePrivateCompensation | null> {
  const path = `candidates/${candidateId}/private/compensation`;
  try {
    const snap = await getDoc(doc(db, 'candidates', candidateId, 'private', 'compensation'));
    if (logAccess && snap.exists()) {
      await recordPdpaAudit({
        actor,
        action: 'VIEW_COMPENSATION_PACKAGE',
        targetType: 'compensation',
        targetId: candidateId,
        details: `Viewed confidential MYR offer & salary package for candidate ${candidateId}.`,
      });
    }
    return snap.exists() ? (snap.data() as CandidatePrivateCompensation) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function registerCandidate(params: {
  actor: StaffUser;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  positionApplied: string;
  department: string;
  source: 'JobStreet' | 'Email';
  resumeFileName: string;
  resumeExcerpt: string;
  educationSummary: string;
  experienceSummary: string;
  yearsExperience: number;
  skills: string[];
  aiMatchScore: number;
  aiSummary: string;
  hasUec: boolean;
}): Promise<string> {
  const candidateId = makeDocId('cand');
  const candidateCode = generateCandidateCode();
  const emailHash = await hashContactValue(params.email);
  const phoneHash = await hashContactValue(params.phone);
  const today = new Date().toISOString().slice(0, 10);

  const batch = writeBatch(db);
  const candRef = doc(db, 'candidates', candidateId);
  const piiRef = doc(db, 'candidates', candidateId, 'private', 'pii');

  const safeSkills = params.skills
    .map((s) => clampString(s, 60))
    .filter(Boolean)
    .slice(0, 20);

  batch.set(candRef, {
    candidateCode,
    fullName: clampString(params.fullName, 140),
    maskedEmail: clampString(maskEmail(params.email), 120),
    maskedPhone: clampString(maskPhone(params.phone), 40),
    emailHash,
    phoneHash,
    positionApplied: clampString(params.positionApplied, 120),
    department: clampString(params.department, 80),
    source: params.source,
    applicationDate: today,
    currentStage: 3,
    status: 'pending_screening' as CandidateStatus,
    aiMatchScore: Math.max(0, Math.min(100, Math.round(params.aiMatchScore))),
    aiSummary: clampString(params.aiSummary, 1200),
    educationSummary: clampString(params.educationSummary, 600),
    experienceSummary: clampString(params.experienceSummary, 800),
    yearsExperience: Math.max(0, Math.min(60, Number(params.yearsExperience) || 0)),
    skills: safeSkills,
    screeningDecision: 'pending' as ScreeningDecision,
    screeningRejectionReason: '',
    employmentFormCompleted: false,
    discFormCompleted: false,
    discProfile: '',
    docSpmStatus: 'missing' as DocStatus,
    docUecStatus: (params.hasUec ? 'missing' : 'not_applicable') as UecDocStatus,
    docDegreeStatus: 'missing' as DocStatus,
    docTranscriptStatus: 'missing' as DocStatus,
    lastDocReminderAt: '',
    qualificationDecision: 'pending' as QualificationDecision,
    qualificationRemarks: '',
    interviewSlotId: '',
    interviewDate: '',
    interviewTime: '',
    interviewMode: '',
    interviewerName: '',
    interviewFeedback: '',
    interviewRating: 0,
    postInterviewDecision: 'pending' as PostInterviewDecision,
    offerStatus: 'none' as OfferStatus,
    finalDecisionNotes: '',
    ownerId: params.actor.uid,
    assignedStaffIds: [params.actor.uid],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(piiRef, {
    email: clampString(params.email, 254),
    phone: clampString(params.phone, 40),
    location: clampString(params.location || 'Kuala Lumpur, Malaysia', 120),
    resumeFileName: clampString(params.resumeFileName || 'pasted_resume.txt', 180),
    resumeExcerpt: clampString(params.resumeExcerpt, 4000),
    spmFileName: '',
    uecFileName: '',
    degreeFileName: '',
    transcriptFileName: '',
    ownerId: params.actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await recordPdpaAudit({
      actor: params.actor,
      action: 'CANDIDATE_REGISTERED',
      targetType: 'candidate',
      targetId: candidateId,
      details: `Registered ${params.fullName} (${candidateCode}) via ${params.source} for ${params.positionApplied} (AI Score: ${params.aiMatchScore}%).`,
    });
    return candidateId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `candidates/${candidateId}`);
  }
}

// Stage 4 -> 5: Screening Decision + Auto-send Google Apps Script Form & DISC links
export async function submitScreeningDecision(params: {
  actor: StaffUser;
  candidate: CandidateRecord;
  decision: ScreeningDecision;
  rejectionReason: string;
}): Promise<void> {
  const { actor, candidate, decision, rejectionReason } = params;
  const path = `candidates/${candidate.id}`;
  const candRef = doc(db, 'candidates', candidate.id);

  let nextStage = 3;
  let nextStatus: CandidateStatus = 'pending_screening';
  if (decision === 'proceed') {
    nextStage = 5;
    nextStatus = 'shortlisted_docs';
  } else if (decision === 'reject') {
    nextStage = 4;
    nextStatus = 'rejected_screening';
  }

  try {
    await updateDoc(candRef, {
      currentStage: nextStage,
      status: nextStatus,
      screeningDecision: decision,
      screeningRejectionReason: clampString(decision === 'reject' ? rejectionReason : '', 500),
      updatedAt: serverTimestamp(),
    });

    if (decision === 'proceed') {
      const email = composeAutomatedEmail({
        templateType: 'shortlist_forms_disc',
        candidateName: candidate.fullName,
        positionApplied: candidate.positionApplied,
        department: candidate.department,
      });
      await logAutomatedEmail({
        actor,
        candidate,
        templateType: 'shortlist_forms_disc',
        subject: email.subject,
        bodyPreview: email.bodyPreview,
        stageTriggered: 5,
      });
    } else if (decision === 'reject') {
      const email = composeAutomatedEmail({
        templateType: 'rejection_notice',
        candidateName: candidate.fullName,
        positionApplied: candidate.positionApplied,
        department: candidate.department,
        rejectionReason,
      });
      await logAutomatedEmail({
        actor,
        candidate,
        templateType: 'rejection_notice',
        subject: email.subject,
        bodyPreview: email.bodyPreview,
        stageTriggered: 4,
      });
    }

    await recordPdpaAudit({
      actor,
      action: `SCREENING_${decision.toUpperCase()}`,
      targetType: 'candidate',
      targetId: candidate.id,
      details:
        decision === 'proceed'
          ? `Shortlisted ${candidate.fullName} (Stage 5) & auto-dispatched Employment Form + DISC Assessment links.`
          : decision === 'reject'
            ? `Rejected ${candidate.fullName} at initial screening. Reason: ${rejectionReason}`
            : `Set ${candidate.fullName} screening status back to Pending Review.`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// Stage 6 & 7: Update Academic Docs & Google Apps Script Forms + Optional PII File Names
export async function updateCandidateDocsAndForms(params: {
  actor: StaffUser;
  candidate: CandidateRecord;
  employmentFormCompleted: boolean;
  discFormCompleted: boolean;
  discProfile: string;
  docSpmStatus: DocStatus;
  docUecStatus: UecDocStatus;
  docDegreeStatus: DocStatus;
  docTranscriptStatus: DocStatus;
  fileNames?: {
    spmFileName?: string;
    uecFileName?: string;
    degreeFileName?: string;
    transcriptFileName?: string;
  };
}): Promise<void> {
  const {
    actor,
    candidate,
    employmentFormCompleted,
    discFormCompleted,
    discProfile,
    docSpmStatus,
    docUecStatus,
    docDegreeStatus,
    docTranscriptStatus,
    fileNames,
  } = params;

  const allSubmittedOrVerified =
    employmentFormCompleted &&
    discFormCompleted &&
    docSpmStatus !== 'missing' &&
    docUecStatus !== 'missing' &&
    docDegreeStatus !== 'missing' &&
    docTranscriptStatus !== 'missing';

  const nextStage = candidate.currentStage < 7 ? (allSubmittedOrVerified ? 7 : 6) : candidate.currentStage;
  const nextStatus: CandidateStatus =
    candidate.currentStage <= 7
      ? allSubmittedOrVerified
        ? 'docs_under_review'
        : 'shortlisted_docs'
      : candidate.status;

  const path = `candidates/${candidate.id}`;
  try {
    await updateDoc(doc(db, 'candidates', candidate.id), {
      currentStage: nextStage,
      status: nextStatus,
      employmentFormCompleted,
      discFormCompleted,
      discProfile: clampString(discProfile, 120),
      docSpmStatus,
      docUecStatus,
      docDegreeStatus,
      docTranscriptStatus,
      updatedAt: serverTimestamp(),
    });

    if (fileNames && (actor.role === 'hr_admin' || actor.role === 'recruiter')) {
      const piiRef = doc(db, 'candidates', candidate.id, 'private', 'pii');
      const piiSnap = await getDoc(piiRef);
      if (piiSnap.exists()) {
        const existingPii = piiSnap.data() as CandidatePrivatePii;
        await updateDoc(piiRef, {
          spmFileName: clampString(fileNames.spmFileName ?? existingPii.spmFileName, 180),
          uecFileName: clampString(fileNames.uecFileName ?? existingPii.uecFileName, 180),
          degreeFileName: clampString(fileNames.degreeFileName ?? existingPii.degreeFileName, 180),
          transcriptFileName: clampString(fileNames.transcriptFileName ?? existingPii.transcriptFileName, 180),
          updatedAt: serverTimestamp(),
        });
      }
    }

    await recordPdpaAudit({
      actor,
      action: 'DOCS_CHECKLIST_UPDATED',
      targetType: 'candidate',
      targetId: candidate.id,
      details: `Updated forms & Malaysian academic checklist for ${candidate.fullName} (SPM:${docSpmStatus}, UEC:${docUecStatus}, Degree:${docDegreeStatus}, Transcript:${docTranscriptStatus}).`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// Stage 6: Automated 48h Missing Document Reminder
export async function sendMissingDocsReminder(params: {
  actor: StaffUser;
  candidate: CandidateRecord;
}): Promise<void> {
  const { actor, candidate } = params;
  const missingDocs = getMissingMandatoryDocs(candidate);
  const nowIso = new Date().toISOString();
  const path = `candidates/${candidate.id}`;
  try {
    await updateDoc(doc(db, 'candidates', candidate.id), {
      lastDocReminderAt: nowIso.slice(0, 19),
      currentStage: Math.max(candidate.currentStage, 6),
      updatedAt: serverTimestamp(),
    });

    const email = composeAutomatedEmail({
      templateType: 'docs_reminder_48h',
      candidateName: candidate.fullName,
      positionApplied: candidate.positionApplied,
      department: candidate.department,
      missingDocs,
    });
    await logAutomatedEmail({
      actor,
      candidate,
      templateType: 'docs_reminder_48h',
      subject: email.subject,
      bodyPreview: email.bodyPreview,
      stageTriggered: 6,
    });

    await recordPdpaAudit({
      actor,
      action: 'DOCS_REMINDER_DISPATCHED',
      targetType: 'candidate',
      targetId: candidate.id,
      details: `Dispatched missing document reminder to ${candidate.fullName} (${missingDocs.length} pending items).`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// Stage 8 -> 9: Qualification Decision + Auto-Send Interview Invite
export async function submitQualificationDecision(params: {
  actor: StaffUser;
  candidate: CandidateRecord;
  decision: QualificationDecision;
  remarks: string;
}): Promise<void> {
  const { actor, candidate, decision, remarks } = params;
  const path = `candidates/${candidate.id}`;

  const nextStage = decision === 'qualified' ? 9 : decision === 'not_qualified' ? 8 : 7;
  const nextStatus: CandidateStatus =
    decision === 'qualified'
      ? 'interview_invited'
      : decision === 'not_qualified'
        ? 'not_qualified'
        : 'docs_under_review';

  try {
    await updateDoc(doc(db, 'candidates', candidate.id), {
      currentStage: nextStage,
      status: nextStatus,
      qualificationDecision: decision,
      qualificationRemarks: clampString(remarks, 800),
      updatedAt: serverTimestamp(),
    });

    if (decision === 'qualified') {
      const email = composeAutomatedEmail({
        templateType: 'interview_invite',
        candidateName: candidate.fullName,
        positionApplied: candidate.positionApplied,
        department: candidate.department,
      });
      await logAutomatedEmail({
        actor,
        candidate,
        templateType: 'interview_invite',
        subject: email.subject,
        bodyPreview: email.bodyPreview,
        stageTriggered: 9,
      });
    } else if (decision === 'not_qualified') {
      const email = composeAutomatedEmail({
        templateType: 'rejection_notice',
        candidateName: candidate.fullName,
        positionApplied: candidate.positionApplied,
        department: candidate.department,
        rejectionReason: remarks || 'Did not meet document & qualification criteria.',
      });
      await logAutomatedEmail({
        actor,
        candidate,
        templateType: 'rejection_notice',
        subject: email.subject,
        bodyPreview: email.bodyPreview,
        stageTriggered: 8,
      });
    }

    await recordPdpaAudit({
      actor,
      action: `QUALIFICATION_${decision.toUpperCase()}`,
      targetType: 'candidate',
      targetId: candidate.id,
      details:
        decision === 'qualified'
          ? `Qualified ${candidate.fullName} & dispatched Stage 9 self-service interview invite.`
          : `Classified ${candidate.fullName} as ${decision}. Remarks: ${remarks}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// Create Available Interview Slot
export async function createInterviewSlot(params: {
  actor: StaffUser;
  date: string;
  startTime: string;
  endTime: string;
  interviewerName: string;
  department: string;
  mode: InterviewMode;
  meetingLinkOrRoom: string;
}): Promise<string> {
  const slotId = makeDocId('slot');
  const path = `interviewSlots/${slotId}`;
  try {
    await setDoc(doc(db, 'interviewSlots', slotId), {
      date: clampString(params.date, 20),
      startTime: clampString(params.startTime, 20),
      endTime: clampString(params.endTime, 20),
      interviewerName: clampString(params.interviewerName, 120),
      department: clampString(params.department, 80),
      mode: params.mode,
      meetingLinkOrRoom: clampString(params.meetingLinkOrRoom, 250),
      status: 'available',
      bookedCandidateId: '',
      bookedCandidateName: '',
      ownerId: params.actor.uid,
      assignedStaffIds: [params.actor.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await recordPdpaAudit({
      actor: params.actor,
      action: 'INTERVIEW_SLOT_CREATED',
      targetType: 'interview_slot',
      targetId: slotId,
      details: `Added interview slot on ${params.date} (${params.startTime}-${params.endTime}) with ${params.interviewerName}.`,
    });
    return slotId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

// Stage 10: Atomic Slot Locking via Firestore runTransaction (Zero Double-Booking)
export async function bookInterviewSlotAtomically(params: {
  actor: StaffUser;
  candidate: CandidateRecord;
  slotId: string;
}): Promise<InterviewSlot> {
  const { actor, candidate, slotId } = params;
  const slotRef = doc(db, 'interviewSlots', slotId);
  const candRef = doc(db, 'candidates', candidate.id);

  let bookedSlotData: InterviewSlot | null = null;
  try {
    await runTransaction(db, async (tx) => {
      const slotSnap = await tx.get(slotRef);
      if (!slotSnap.exists()) {
        throw new Error('Selected interview slot no longer exists.');
      }
      const slot = slotSnap.data() as Omit<InterviewSlot, 'id'>;
      if (slot.status !== 'available') {
        throw new Error('This slot has already been reserved. Atomic locking prevented a double-booking.');
      }

      const candSnap = await tx.get(candRef);
      if (!candSnap.exists()) {
        throw new Error('Candidate record not found.');
      }

      const timeRange = `${slot.startTime} - ${slot.endTime}`;
      tx.update(candRef, {
        currentStage: 10,
        status: 'interview_confirmed',
        interviewSlotId: slotId,
        interviewDate: clampString(slot.date, 30),
        interviewTime: clampString(timeRange, 40),
        interviewMode: clampString(slot.mode, 60),
        interviewerName: clampString(slot.interviewerName, 120),
        updatedAt: serverTimestamp(),
      });

      tx.update(slotRef, {
        status: 'booked',
        bookedCandidateId: candidate.id,
        bookedCandidateName: clampString(candidate.fullName, 140),
        updatedAt: serverTimestamp(),
      });

      bookedSlotData = { ...slot, id: slotId, status: 'booked', bookedCandidateId: candidate.id, bookedCandidateName: candidate.fullName };
    });

    if (!bookedSlotData) {
      throw new Error('Transaction did not complete slot reservation.');
    }

    const slotConfirmed: InterviewSlot = bookedSlotData;
    const email = composeAutomatedEmail({
      templateType: 'interview_confirmation',
      candidateName: candidate.fullName,
      positionApplied: candidate.positionApplied,
      department: candidate.department,
      interviewDate: slotConfirmed.date,
      interviewTime: `${slotConfirmed.startTime} - ${slotConfirmed.endTime}`,
      interviewMode: slotConfirmed.mode,
      interviewerName: slotConfirmed.interviewerName,
    });
    await logAutomatedEmail({
      actor,
      candidate,
      templateType: 'interview_confirmation',
      subject: email.subject,
      bodyPreview: email.bodyPreview,
      stageTriggered: 10,
    });

    await recordPdpaAudit({
      actor,
      action: 'INTERVIEW_SLOT_BOOKED_ATOMIC',
      targetType: 'interview_slot',
      targetId: slotId,
      details: `Atomically locked slot ${slotConfirmed.date} ${slotConfirmed.startTime} for ${candidate.fullName} and sent confirmation.`,
    });

    return slotConfirmed;
  } catch (err) {
    if (err instanceof Error && (err.message.includes('already been reserved') || err.message.includes('no longer exists'))) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `interviewSlots/${slotId}`);
  }
}

// Stage 11: Mark Interview Conducted
export async function markInterviewCompleted(params: {
  actor: StaffUser;
  candidate: CandidateRecord;
  slotId?: string;
}): Promise<void> {
  const { actor, candidate, slotId } = params;
  try {
    await updateDoc(doc(db, 'candidates', candidate.id), {
      currentStage: 11,
      status: 'interview_completed',
      interviewFeedback: candidate.interviewFeedback,
      interviewRating: candidate.interviewRating,
      postInterviewDecision: candidate.postInterviewDecision,
      finalDecisionNotes: candidate.finalDecisionNotes,
      updatedAt: serverTimestamp(),
    });
    const resolvedSlotId = slotId || candidate.interviewSlotId;
    if (resolvedSlotId) {
      const slotRef = doc(db, 'interviewSlots', resolvedSlotId);
      const slotSnap = await getDoc(slotRef);
      if (slotSnap.exists() && (slotSnap.data() as InterviewSlot).status === 'booked') {
        await updateDoc(slotRef, {
          status: 'completed',
          updatedAt: serverTimestamp(),
        });
      }
    }
    await recordPdpaAudit({
      actor,
      action: 'INTERVIEW_CONDUCTED',
      targetType: 'candidate',
      targetId: candidate.id,
      details: `Marked Stage 11 interview completed for ${candidate.fullName}.`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `candidates/${candidate.id}`);
  }
}

// Stage 12: Post-Interview Panel Evaluation & Decision
export async function submitPostInterviewEvaluation(params: {
  actor: StaffUser;
  candidate: CandidateRecord;
  feedback: string;
  rating: number;
  decision: PostInterviewDecision;
  notes: string;
}): Promise<void> {
  const { actor, candidate, feedback, rating, decision, notes } = params;
  const path = `candidates/${candidate.id}`;

  const nextStage = 12;
  const nextStatus: CandidateStatus =
    decision === 'reject' ? 'rejected_post_interview' : 'interview_completed';

  try {
    await updateDoc(doc(db, 'candidates', candidate.id), {
      currentStage: nextStage,
      status: nextStatus,
      interviewFeedback: clampString(feedback, 1500),
      interviewRating: Math.max(0, Math.min(5, Math.round(rating))),
      postInterviewDecision: decision,
      finalDecisionNotes: clampString(notes, 800),
      updatedAt: serverTimestamp(),
    });

    if (decision === 'reject') {
      const email = composeAutomatedEmail({
        templateType: 'rejection_notice',
        candidateName: candidate.fullName,
        positionApplied: candidate.positionApplied,
        department: candidate.department,
        rejectionReason: notes || 'Not selected after panel interview.',
      });
      await logAutomatedEmail({
        actor,
        candidate,
        templateType: 'rejection_notice',
        subject: email.subject,
        bodyPreview: email.bodyPreview,
        stageTriggered: 12,
      });
    }

    await recordPdpaAudit({
      actor,
      action: `POST_INTERVIEW_${decision.toUpperCase()}`,
      targetType: 'candidate',
      targetId: candidate.id,
      details: `Recorded panel rating ${rating}/5 and decision "${decision}" for ${candidate.fullName}.`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// Stage 13: Send Employment Offer (MYR Compensation isolated in private/compensation — HR Admin only)
export async function sendEmploymentOffer(params: {
  actor: StaffUser;
  candidate: CandidateRecord;
  positionOffered: string;
  departmentOffered: string;
  monthlySalaryMYR: number;
  allowanceMYR: number;
  probationMonths: number;
  startDate: string;
  offerDeadline: string;
  offerTermsSummary: string;
}): Promise<void> {
  const {
    actor,
    candidate,
    positionOffered,
    departmentOffered,
    monthlySalaryMYR,
    allowanceMYR,
    probationMonths,
    startDate,
    offerDeadline,
    offerTermsSummary,
  } = params;

  const compRef = doc(db, 'candidates', candidate.id, 'private', 'compensation');
  const candRef = doc(db, 'candidates', candidate.id);
  const offerRefCode = `OL-${candidate.candidateCode}`;

  try {
    const existingComp = await getDoc(compRef);
    if (existingComp.exists()) {
      await updateDoc(compRef, {
        positionOffered: clampString(positionOffered, 120),
        departmentOffered: clampString(departmentOffered, 80),
        monthlySalaryMYR: Math.max(0, Math.min(500000, Number(monthlySalaryMYR) || 0)),
        allowanceMYR: Math.max(0, Math.min(100000, Number(allowanceMYR) || 0)),
        probationMonths: Math.max(0, Math.min(24, Math.round(probationMonths))),
        startDate: clampString(startDate, 30),
        offerDeadline: clampString(offerDeadline, 30),
        offerLetterRef: clampString(offerRefCode, 120),
        offerTermsSummary: clampString(offerTermsSummary, 1500),
        candidateResponseNote: '',
        respondedAt: '',
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(compRef, {
        positionOffered: clampString(positionOffered, 120),
        departmentOffered: clampString(departmentOffered, 80),
        monthlySalaryMYR: Math.max(0, Math.min(500000, Number(monthlySalaryMYR) || 0)),
        allowanceMYR: Math.max(0, Math.min(100000, Number(allowanceMYR) || 0)),
        probationMonths: Math.max(0, Math.min(24, Math.round(probationMonths))),
        startDate: clampString(startDate, 30),
        offerDeadline: clampString(offerDeadline, 30),
        offerLetterRef: clampString(offerRefCode, 120),
        offerTermsSummary: clampString(offerTermsSummary, 1500),
        candidateResponseNote: '',
        respondedAt: '',
        ownerId: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await updateDoc(candRef, {
      currentStage: 13,
      status: 'offer_sent',
      offerStatus: 'offer_sent',
      finalDecisionNotes: clampString(`Offer ${offerRefCode} dispatched on ${new Date().toISOString().slice(0, 10)}.`, 800),
      updatedAt: serverTimestamp(),
    });

    const email = composeAutomatedEmail({
      templateType: 'employment_offer',
      candidateName: candidate.fullName,
      positionApplied: positionOffered,
      department: departmentOffered,
      monthlySalaryMYR,
      startDate,
      offerDeadline,
    });
    await logAutomatedEmail({
      actor,
      candidate,
      templateType: 'employment_offer',
      subject: email.subject,
      bodyPreview: email.bodyPreview,
      stageTriggered: 13,
    });

    await recordPdpaAudit({
      actor,
      action: 'EMPLOYMENT_OFFER_SENT',
      targetType: 'compensation',
      targetId: candidate.id,
      details: `Generated & dispatched MYR employment offer ${offerRefCode} to ${candidate.fullName} (Start: ${startDate}).`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `candidates/${candidate.id}/private/compensation`);
  }
}

// Stage 14 & 15: Track Offer Response & Record Final Status
export async function updateOfferResponseStatus(params: {
  actor: StaffUser;
  candidate: CandidateRecord;
  offerStatus: OfferStatus;
  responseNote: string;
}): Promise<void> {
  const { actor, candidate, offerStatus, responseNote } = params;
  const candRef = doc(db, 'candidates', candidate.id);
  const compRef = doc(db, 'candidates', candidate.id, 'private', 'compensation');

  const isFinal = offerStatus === 'accepted' || offerStatus === 'rejected' || offerStatus === 'expired';
  const nextStage = isFinal ? 15 : 14;
  let nextStatus: CandidateStatus = 'offer_pending';
  if (offerStatus === 'offer_sent') nextStatus = 'offer_sent';
  if (offerStatus === 'pending_response') nextStatus = 'offer_pending';
  if (offerStatus === 'accepted') nextStatus = 'offer_accepted';
  if (offerStatus === 'rejected') nextStatus = 'offer_rejected';
  if (offerStatus === 'expired') nextStatus = 'offer_expired';

  try {
    await updateDoc(candRef, {
      currentStage: nextStage,
      status: nextStatus,
      offerStatus,
      finalDecisionNotes: clampString(responseNote || `Offer status updated to ${offerStatus}.`, 800),
      updatedAt: serverTimestamp(),
    });

    if (actor.role === 'hr_admin') {
      const compSnap = await getDoc(compRef);
      if (compSnap.exists()) {
        await updateDoc(compRef, {
          candidateResponseNote: clampString(responseNote, 600),
          respondedAt: isFinal ? new Date().toISOString().slice(0, 19) : '',
          updatedAt: serverTimestamp(),
        });
      }
    }

    await recordPdpaAudit({
      actor,
      action: `OFFER_${offerStatus.toUpperCase()}`,
      targetType: 'compensation',
      targetId: candidate.id,
      details: `Updated offer response for ${candidate.fullName} to "${offerStatus}" (Stage ${nextStage}).`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `candidates/${candidate.id}`);
  }
}

// 1-Click Malaysian Sample Pipeline Seeder (for empty workspaces)
export async function seedMalaysianSampleWorkspace(actor: StaffUser): Promise<void> {
  const today = new Date();
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const daysAhead = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const samples = [
    {
      code: 'TFMY-2611-1041',
      fullName: 'Nur Aisyah binti Mohd Razali',
      email: 'aisyah.razali@gmail.com',
      phone: '+60 12-482 9104',
      location: 'Petaling Jaya, Selangor',
      positionApplied: 'Senior Full-Stack Engineer',
      department: 'Engineering & Technology',
      source: 'JobStreet' as const,
      applicationDate: daysAgo(1),
      currentStage: 3,
      status: 'pending_screening' as CandidateStatus,
      aiMatchScore: 91,
      aiSummary: 'Strong 6-year TypeScript, React, Node.js, and GCP track record at a KL fintech scale-up. Honours Degree from Universiti Malaya (CGPA 3.78) with 9As in SPM.',
      educationSummary: 'B.Comp.Sc. (Hons) Software Engineering, Universiti Malaya (CGPA 3.78) · SPM 9A (SMK Damansara Utama)',
      experienceSummary: 'Lead Frontend & API Engineer at PayNet Digital Partners (4 yrs); Full-Stack Developer at Grab Malaysia (2 yrs).',
      yearsExperience: 6,
      skills: ['TypeScript', 'React', 'Node.js', 'Cloud Firestore', 'PostgreSQL', 'Tailwind CSS', 'System Design'],
      screeningDecision: 'pending' as ScreeningDecision,
      screeningRejectionReason: '',
      employmentFormCompleted: false,
      discFormCompleted: false,
      discProfile: '',
      docSpmStatus: 'missing' as DocStatus,
      docUecStatus: 'not_applicable' as UecDocStatus,
      docDegreeStatus: 'missing' as DocStatus,
      docTranscriptStatus: 'missing' as DocStatus,
      qualificationDecision: 'pending' as QualificationDecision,
      qualificationRemarks: '',
      interviewRating: 0,
      interviewFeedback: '',
      postInterviewDecision: 'pending' as PostInterviewDecision,
      offerStatus: 'none' as OfferStatus,
      finalDecisionNotes: '',
      resumeFileName: 'Nur_Aisyah_Razali_CV_2026.pdf',
      spmFileName: '',
      uecFileName: '',
      degreeFileName: '',
      transcriptFileName: '',
    },
    {
      code: 'TFMY-2611-1042',
      fullName: 'Tan Wei Jian',
      email: 'weijian.tan@outlook.my',
      phone: '+60 16-773 2219',
      location: 'Georgetown, Penang',
      positionApplied: 'Financial Accountant (MIA/ACCA)',
      department: 'Finance & Accounting',
      source: 'Email' as const,
      applicationDate: daysAgo(4),
      currentStage: 6,
      status: 'shortlisted_docs' as CandidateStatus,
      aiMatchScore: 86,
      aiSummary: 'ACCA affiliate with 5 years statutory audit & MFRS reporting experience at Big 4 Penang. Holds both SPM and UEC credentials plus First-Class Accounting degree.',
      educationSummary: 'B.Acc (Hons) Universiti Sains Malaysia (CGPA 3.84) · ACCA Affiliate · UEC 7A & SPM 8A (Chung Ling High School)',
      experienceSummary: 'Senior Audit Associate at PwC Malaysia (3.5 yrs); Accounts Executive at Intel Penang (1.5 yrs).',
      yearsExperience: 5,
      skills: ['MFRS / IFRS', 'ACCA', 'SAP S/4HANA', 'SST & LHDN Tax', 'Financial Consolidation', 'Excel VBA'],
      screeningDecision: 'proceed' as ScreeningDecision,
      screeningRejectionReason: '',
      employmentFormCompleted: true,
      discFormCompleted: false,
      discProfile: '',
      docSpmStatus: 'submitted' as DocStatus,
      docUecStatus: 'missing' as UecDocStatus,
      docDegreeStatus: 'submitted' as DocStatus,
      docTranscriptStatus: 'missing' as DocStatus,
      qualificationDecision: 'pending' as QualificationDecision,
      qualificationRemarks: '',
      interviewRating: 0,
      interviewFeedback: '',
      postInterviewDecision: 'pending' as PostInterviewDecision,
      offerStatus: 'none' as OfferStatus,
      finalDecisionNotes: '',
      resumeFileName: 'Tan_Wei_Jian_ACCA_Resume.pdf',
      spmFileName: 'TWJ_SPM_Result.pdf',
      uecFileName: '',
      degreeFileName: 'TWJ_USM_Degree_Scroll.pdf',
      transcriptFileName: '',
    },
    {
      code: 'TFMY-2611-1043',
      fullName: 'Kavitha a/p Subramaniam',
      email: 'kavitha.subra@gmail.com',
      phone: '+60 17-390 8845',
      location: 'Subang Jaya, Selangor',
      positionApplied: 'HR Business Partner',
      department: 'Human Resources',
      source: 'JobStreet' as const,
      applicationDate: daysAgo(6),
      currentStage: 7,
      status: 'docs_under_review' as CandidateStatus,
      aiMatchScore: 89,
      aiSummary: 'Experienced Malaysian Employment Act 1955 & PDPA HRBP. Completed both Google Apps Script forms and submitted all verified academic credentials.',
      educationSummary: 'B.Sc. Human Resource Development, UTM Skudai (CGPA 3.65) · SPM 8A',
      experienceSummary: 'HR Business Partner at Sime Darby Property (4 yrs); Talent Acquisition Specialist at Axiata (2.5 yrs).',
      yearsExperience: 6.5,
      skills: ['Employment Act 1955', 'PDPA Compliance', 'Industrial Relations', 'HRDF / HRD Corp', 'Talent Acquisition'],
      screeningDecision: 'proceed' as ScreeningDecision,
      screeningRejectionReason: '',
      employmentFormCompleted: true,
      discFormCompleted: true,
      discProfile: 'I/S — Collaborative Influence',
      docSpmStatus: 'verified' as DocStatus,
      docUecStatus: 'not_applicable' as UecDocStatus,
      docDegreeStatus: 'verified' as DocStatus,
      docTranscriptStatus: 'submitted' as DocStatus,
      qualificationDecision: 'pending' as QualificationDecision,
      qualificationRemarks: 'All mandatory certificates received; final CGPA transcript cross-check in progress.',
      interviewRating: 0,
      interviewFeedback: '',
      postInterviewDecision: 'pending' as PostInterviewDecision,
      offerStatus: 'none' as OfferStatus,
      finalDecisionNotes: '',
      resumeFileName: 'Kavitha_Subramaniam_HRBP.pdf',
      spmFileName: 'Kavitha_SPM_Cert.pdf',
      uecFileName: '',
      degreeFileName: 'Kavitha_UTM_Degree.pdf',
      transcriptFileName: 'Kavitha_UTM_Transcript.pdf',
    },
    {
      code: 'TFMY-2611-1044',
      fullName: 'Muhammad Danish bin Iskandar',
      email: 'danish.iskandar@yahoo.com.my',
      phone: '+60 19-615 4402',
      location: 'Cyberjaya, Selangor',
      positionApplied: 'Data & BI Analyst',
      department: 'Engineering & Technology',
      source: 'JobStreet' as const,
      applicationDate: daysAgo(8),
      currentStage: 9,
      status: 'interview_invited' as CandidateStatus,
      aiMatchScore: 84,
      aiSummary: 'Solid Power BI, SQL, and Python analytics background in Malaysian telco & e-commerce. Qualified after full academic verification; awaiting self-service interview slot booking.',
      educationSummary: 'B.Sc. Data Science, Multimedia University (MMU) Cyberjaya (CGPA 3.71) · SPM 7A',
      experienceSummary: 'BI Analyst at CelcomDigi (3 yrs); Junior Data Analyst at Shopee Malaysia (1.5 yrs).',
      yearsExperience: 4.5,
      skills: ['SQL', 'Power BI', 'Python', 'BigQuery', 'Looker Studio', 'ETL Pipelines'],
      screeningDecision: 'proceed' as ScreeningDecision,
      screeningRejectionReason: '',
      employmentFormCompleted: true,
      discFormCompleted: true,
      discProfile: 'C/S — Analytical & Methodical',
      docSpmStatus: 'verified' as DocStatus,
      docUecStatus: 'not_applicable' as UecDocStatus,
      docDegreeStatus: 'verified' as DocStatus,
      docTranscriptStatus: 'verified' as DocStatus,
      qualificationDecision: 'qualified' as QualificationDecision,
      qualificationRemarks: 'Verified MMU degree and transcript; DISC C/S profile fits BI governance well.',
      interviewRating: 0,
      interviewFeedback: '',
      postInterviewDecision: 'pending' as PostInterviewDecision,
      offerStatus: 'none' as OfferStatus,
      finalDecisionNotes: '',
      resumeFileName: 'Danish_Iskandar_BI_CV.pdf',
      spmFileName: 'Danish_SPM.pdf',
      uecFileName: '',
      degreeFileName: 'Danish_MMU_Degree.pdf',
      transcriptFileName: 'Danish_MMU_Transcript.pdf',
    },
    {
      code: 'TFMY-2611-1045',
      fullName: 'Chong Hui Xin',
      email: 'huixin.chong@gmail.com',
      phone: '+60 11-2834 9901',
      location: 'Cheras, Kuala Lumpur',
      positionApplied: 'Product Designer (UI/UX)',
      department: 'Product & Design',
      source: 'Email' as const,
      applicationDate: daysAgo(10),
      currentStage: 9,
      status: 'interview_invited' as CandidateStatus,
      aiMatchScore: 93,
      aiSummary: 'Exceptional enterprise SaaS design systems portfolio. UEC + Monash Malaysia graduate; verified docs and scheduled for upcoming panel interview.',
      educationSummary: 'B.A. Communication & Digital Media, Monash University Malaysia (Distinction) · UEC 6A & SPM 8A',
      experienceSummary: 'Senior Product Designer at Carsome (3.5 yrs); UI/UX Designer at AirAsia Digital (2 yrs).',
      yearsExperience: 5.5,
      skills: ['Figma', 'Design Systems', 'WCAG Accessibility', 'Prototyping', 'User Research', 'Enterprise SaaS'],
      screeningDecision: 'proceed' as ScreeningDecision,
      screeningRejectionReason: '',
      employmentFormCompleted: true,
      discFormCompleted: true,
      discProfile: 'D/I — Results & Creative Drive',
      docSpmStatus: 'verified' as DocStatus,
      docUecStatus: 'verified' as UecDocStatus,
      docDegreeStatus: 'verified' as DocStatus,
      docTranscriptStatus: 'verified' as DocStatus,
      qualificationDecision: 'qualified' as QualificationDecision,
      qualificationRemarks: 'Outstanding portfolio and complete SPM/UEC/Monash credentials.',
      interviewRating: 0,
      interviewFeedback: '',
      postInterviewDecision: 'pending' as PostInterviewDecision,
      offerStatus: 'none' as OfferStatus,
      finalDecisionNotes: '',
      resumeFileName: 'Chong_Hui_Xin_Portfolio_CV.pdf',
      spmFileName: 'CHX_SPM.pdf',
      uecFileName: 'CHX_UEC.pdf',
      degreeFileName: 'CHX_Monash_Degree.pdf',
      transcriptFileName: 'CHX_Monash_Transcript.pdf',
      autoBookSlotIndex: 0,
    },
    {
      code: 'TFMY-2611-1046',
      fullName: 'Arvind Nair a/l Rajendran',
      email: 'arvind.nair@hotmail.my',
      phone: '+60 12-901 3348',
      location: 'Shah Alam, Selangor',
      positionApplied: 'Supply Chain & Logistics Lead',
      department: 'Operations & Supply Chain',
      source: 'JobStreet' as const,
      applicationDate: daysAgo(14),
      currentStage: 12,
      status: 'interview_completed' as CandidateStatus,
      aiMatchScore: 88,
      aiSummary: 'Strong ASEAN freight, Port Klang customs clearance, and ERP inventory optimization background. Passed panel interview with 4/5 rating; ready for Stage 13 MYR Offer.',
      educationSummary: 'B.Eng (Hons) Industrial Engineering, UTAR Sungai Long (CGPA 3.59) · SPM 7A',
      experienceSummary: 'Regional Logistics Lead at DHL Supply Chain Malaysia (5 yrs); Operations Planner at Top Glove (2 yrs).',
      yearsExperience: 7,
      skills: ['SAP MM/WM', 'Port Klang Customs', 'Vendor Negotiation', 'Cold Chain', 'Lean Six Sigma'],
      screeningDecision: 'proceed' as ScreeningDecision,
      screeningRejectionReason: '',
      employmentFormCompleted: true,
      discFormCompleted: true,
      discProfile: 'D/C — Decisive Execution',
      docSpmStatus: 'verified' as DocStatus,
      docUecStatus: 'not_applicable' as UecDocStatus,
      docDegreeStatus: 'verified' as DocStatus,
      docTranscriptStatus: 'verified' as DocStatus,
      qualificationDecision: 'qualified' as QualificationDecision,
      qualificationRemarks: 'All academic records verified.',
      interviewRating: 4,
      interviewFeedback: 'Demonstrated strong crisis resolution on Port Klang clearance bottlenecks and clear KPI ownership. Recommended for Employment Offer.',
      postInterviewDecision: 'offer' as PostInterviewDecision,
      offerStatus: 'none' as OfferStatus,
      finalDecisionNotes: 'Panel unanimous approval; pending HR Admin MYR offer package dispatch.',
      resumeFileName: 'Arvind_Nair_SupplyChain_CV.pdf',
      spmFileName: 'Arvind_SPM.pdf',
      uecFileName: '',
      degreeFileName: 'Arvind_UTAR_Degree.pdf',
      transcriptFileName: 'Arvind_UTAR_Transcript.pdf',
    },
    {
      code: 'TFMY-2611-1047',
      fullName: 'Lim Mei Ling',
      email: 'meiling.lim@gmail.com',
      phone: '+60 16-552 8017',
      location: 'Bangsar South, Kuala Lumpur',
      positionApplied: 'Compliance & PDPA Executive',
      department: 'Legal & Compliance',
      source: 'Email' as const,
      applicationDate: daysAgo(18),
      currentStage: 13,
      status: 'offer_sent' as CandidateStatus,
      aiMatchScore: 95,
      aiSummary: 'LL.B (Hons) graduate specializing in Malaysian PDPA 2010 (Amendment 2024), DPO governance, and ISO 27001 audits. Official MYR employment offer dispatched.',
      educationSummary: 'LL.B (Hons) University of Malaya (Second Upper) · CLP · SPM 9A',
      experienceSummary: 'Data Privacy & Legal Executive at Maybank Group Compliance (4 yrs).',
      yearsExperience: 4,
      skills: ['PDPA 2010 / 2024', 'ISO 27001', 'Contract Drafting', 'Risk Assessment', 'DPO Governance'],
      screeningDecision: 'proceed' as ScreeningDecision,
      screeningRejectionReason: '',
      employmentFormCompleted: true,
      discFormCompleted: true,
      discProfile: 'C/D — Precision & Governance',
      docSpmStatus: 'verified' as DocStatus,
      docUecStatus: 'not_applicable' as UecDocStatus,
      docDegreeStatus: 'verified' as DocStatus,
      docTranscriptStatus: 'verified' as DocStatus,
      qualificationDecision: 'qualified' as QualificationDecision,
      qualificationRemarks: 'Verified UM LL.B scroll & transcript.',
      interviewRating: 5,
      interviewFeedback: 'Exceptional mastery of 2024 PDPA mandatory breach notification timelines and cross-border transfer rules.',
      postInterviewDecision: 'offer' as PostInterviewDecision,
      offerStatus: 'offer_sent' as OfferStatus,
      finalDecisionNotes: 'Offer letter OL-TFMY-2611-1047 sent; awaiting candidate confirmation via portal.',
      resumeFileName: 'Lim_Mei_Ling_PDPA_CV.pdf',
      spmFileName: 'LML_SPM.pdf',
      uecFileName: '',
      degreeFileName: 'LML_UM_LLB.pdf',
      transcriptFileName: 'LML_UM_Transcript.pdf',
      offerPackage: {
        monthlySalaryMYR: 9200,
        allowanceMYR: 600,
        probationMonths: 3,
        startDate: daysAhead(28),
        offerDeadline: daysAhead(5),
        offerTermsSummary: 'Full-time Permanent (Bangsar South HQ, Hybrid 3/2). Includes EPF 13% employer contribution, SOCSO/EIS, medical coverage, and 18 days annual leave.',
      },
    },
    {
      code: 'TFMY-2611-1048',
      fullName: 'Farhan Hakim bin Azman',
      email: 'farhan.hakim@gmail.com',
      phone: '+60 13-229 7730',
      location: 'Johor Bahru, Johor',
      positionApplied: 'Enterprise Sales Manager',
      department: 'Sales & Commercial',
      source: 'JobStreet' as const,
      applicationDate: daysAgo(24),
      currentStage: 15,
      status: 'offer_accepted' as CandidateStatus,
      aiMatchScore: 90,
      aiSummary: 'Proven B2B SaaS quota attainment (138% FY25) across Malaysia & Singapore enterprise accounts. Offer accepted via online candidate portal.',
      educationSummary: 'B.Bus.Admin (Hons) Marketing, Sunway University (CGPA 3.62) · SPM 7A',
      experienceSummary: 'Enterprise Account Executive at Salesforce Malaysia (4 yrs); Business Development Manager at Maxis Business (3 yrs).',
      yearsExperience: 7,
      skills: ['Enterprise B2B SaaS', 'MEDDPICC', 'Key Account Strategy', 'Bahasa Melayu & English', 'CRM Forecasting'],
      screeningDecision: 'proceed' as ScreeningDecision,
      screeningRejectionReason: '',
      employmentFormCompleted: true,
      discFormCompleted: true,
      discProfile: 'D/I — High-Drive Closer',
      docSpmStatus: 'verified' as DocStatus,
      docUecStatus: 'not_applicable' as UecDocStatus,
      docDegreeStatus: 'verified' as DocStatus,
      docTranscriptStatus: 'verified' as DocStatus,
      qualificationDecision: 'qualified' as QualificationDecision,
      qualificationRemarks: 'All credentials verified.',
      interviewRating: 5,
      interviewFeedback: 'Strong executive presence and realistic 90-day Klang Valley enterprise pipeline plan.',
      postInterviewDecision: 'offer' as PostInterviewDecision,
      offerStatus: 'accepted' as OfferStatus,
      finalDecisionNotes: 'Candidate digitally accepted offer via Candidate Portal.',
      resumeFileName: 'Farhan_Hakim_Sales_CV.pdf',
      spmFileName: 'FH_SPM.pdf',
      uecFileName: '',
      degreeFileName: 'FH_Sunway_Degree.pdf',
      transcriptFileName: 'FH_Sunway_Transcript.pdf',
      offerPackage: {
        monthlySalaryMYR: 11500,
        allowanceMYR: 1200,
        probationMonths: 3,
        startDate: daysAhead(14),
        offerDeadline: daysAgo(2),
        offerTermsSummary: 'Base RM 11,500 + RM 1,200 Car/Travel Allowance + Quarterly OTE Commission. Permanent full-time.',
      },
    },
  ];

  // 1. Create 6 Available Interview Slots first
  const slotConfigs: Array<{
    date: string;
    startTime: string;
    endTime: string;
    interviewerName: string;
    department: string;
    mode: InterviewMode;
    meetingLinkOrRoom: string;
  }> = [
    {
      date: daysAhead(2),
      startTime: '10:00',
      endTime: '11:00',
      interviewerName: 'Puan Siti Nurhaliza (VP Product)',
      department: 'Product & Design',
      mode: 'Google Meet',
      meetingLinkOrRoom: 'https://meet.google.com/tfm-uxds-kls',
    },
    {
      date: daysAhead(2),
      startTime: '14:30',
      endTime: '15:30',
      interviewerName: 'Encik Hafizuddin (Head of Data)',
      department: 'Engineering & Technology',
      mode: 'Google Meet',
      meetingLinkOrRoom: 'https://meet.google.com/tfm-data-my1',
    },
    {
      date: daysAhead(3),
      startTime: '11:00',
      endTime: '12:00',
      interviewerName: 'Marcus Teh (Engineering Director)',
      department: 'Engineering & Technology',
      mode: 'On-site (KL HQ)',
      meetingLinkOrRoom: 'Menara TalentFlow, Level 18, Boardroom B',
    },
    {
      date: daysAhead(4),
      startTime: '09:30',
      endTime: '10:30',
      interviewerName: 'Ms. Evelyn Ong (Finance Controller)',
      department: 'Finance & Accounting',
      mode: 'Microsoft Teams',
      meetingLinkOrRoom: 'Teams Invite Auto-Generated',
    },
    {
      date: daysAhead(4),
      startTime: '15:00',
      endTime: '16:00',
      interviewerName: 'Encik Hafizuddin (Head of Data)',
      department: 'Engineering & Technology',
      mode: 'Google Meet',
      meetingLinkOrRoom: 'https://meet.google.com/tfm-data-my2',
    },
    {
      date: daysAhead(5),
      startTime: '10:30',
      endTime: '11:30',
      interviewerName: 'Dato’ Ramesh Pillai (HR Director)',
      department: 'Human Resources',
      mode: 'On-site (KL HQ)',
      meetingLinkOrRoom: 'Menara TalentFlow, Level 20, Suite A',
    },
  ];

  const createdSlotIds: string[] = [];
  for (const sc of slotConfigs) {
    const id = await createInterviewSlot({ actor, ...sc });
    createdSlotIds.push(id);
  }

  // 2. Create Candidates + Split PII + Compensation + Initial Automated Emails
  for (const s of samples) {
    const candId = makeDocId('cand');
    const emailHash = await hashContactValue(s.email);
    const phoneHash = await hashContactValue(s.phone);
    const batch = writeBatch(db);

    const candRef = doc(db, 'candidates', candId);
    const piiRef = doc(db, 'candidates', candId, 'private', 'pii');

    batch.set(candRef, {
      candidateCode: s.code,
      fullName: s.fullName,
      maskedEmail: maskEmail(s.email),
      maskedPhone: maskPhone(s.phone),
      emailHash,
      phoneHash,
      positionApplied: s.positionApplied,
      department: s.department,
      source: s.source,
      applicationDate: s.applicationDate,
      currentStage: s.currentStage,
      status: s.status,
      aiMatchScore: s.aiMatchScore,
      aiSummary: s.aiSummary,
      educationSummary: s.educationSummary,
      experienceSummary: s.experienceSummary,
      yearsExperience: s.yearsExperience,
      skills: s.skills,
      screeningDecision: s.screeningDecision,
      screeningRejectionReason: s.screeningRejectionReason,
      employmentFormCompleted: s.employmentFormCompleted,
      discFormCompleted: s.discFormCompleted,
      discProfile: s.discProfile,
      docSpmStatus: s.docSpmStatus,
      docUecStatus: s.docUecStatus,
      docDegreeStatus: s.docDegreeStatus,
      docTranscriptStatus: s.docTranscriptStatus,
      lastDocReminderAt: '',
      qualificationDecision: s.qualificationDecision,
      qualificationRemarks: s.qualificationRemarks,
      interviewSlotId: '',
      interviewDate: '',
      interviewTime: '',
      interviewMode: '',
      interviewerName: '',
      interviewFeedback: s.interviewFeedback,
      interviewRating: s.interviewRating,
      postInterviewDecision: s.postInterviewDecision,
      offerStatus: s.offerStatus,
      finalDecisionNotes: s.finalDecisionNotes,
      ownerId: actor.uid,
      assignedStaffIds: [actor.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(piiRef, {
      email: s.email,
      phone: s.phone,
      location: s.location,
      resumeFileName: s.resumeFileName,
      resumeExcerpt: `${s.educationSummary}\n\n${s.experienceSummary}`,
      spmFileName: s.spmFileName,
      uecFileName: s.uecFileName,
      degreeFileName: s.degreeFileName,
      transcriptFileName: s.transcriptFileName,
      ownerId: actor.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (s.offerPackage && (actor.role === 'hr_admin' || isBootstrappedAdminEmail(actor.email))) {
      const compRef = doc(db, 'candidates', candId, 'private', 'compensation');
      batch.set(compRef, {
        positionOffered: s.positionApplied,
        departmentOffered: s.department,
        monthlySalaryMYR: s.offerPackage.monthlySalaryMYR,
        allowanceMYR: s.offerPackage.allowanceMYR,
        probationMonths: s.offerPackage.probationMonths,
        startDate: s.offerPackage.startDate,
        offerDeadline: s.offerPackage.offerDeadline,
        offerLetterRef: `OL-${s.code}`,
        offerTermsSummary: s.offerPackage.offerTermsSummary,
        candidateResponseNote: s.offerStatus === 'accepted' ? 'Accepted with thanks. Looking forward to joining the team!' : '',
        respondedAt: s.offerStatus === 'accepted' ? daysAgo(3) : '',
        ownerId: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `candidates/${candId}`);
    }

    const candRecord: CandidateRecord = {
      id: candId,
      candidateCode: s.code,
      fullName: s.fullName,
      maskedEmail: maskEmail(s.email),
      maskedPhone: maskPhone(s.phone),
      emailHash,
      phoneHash,
      positionApplied: s.positionApplied,
      department: s.department,
      source: s.source,
      applicationDate: s.applicationDate,
      currentStage: s.currentStage,
      status: s.status,
      aiMatchScore: s.aiMatchScore,
      aiSummary: s.aiSummary,
      educationSummary: s.educationSummary,
      experienceSummary: s.experienceSummary,
      yearsExperience: s.yearsExperience,
      skills: s.skills,
      screeningDecision: s.screeningDecision,
      screeningRejectionReason: s.screeningRejectionReason,
      employmentFormCompleted: s.employmentFormCompleted,
      discFormCompleted: s.discFormCompleted,
      discProfile: s.discProfile,
      docSpmStatus: s.docSpmStatus,
      docUecStatus: s.docUecStatus,
      docDegreeStatus: s.docDegreeStatus,
      docTranscriptStatus: s.docTranscriptStatus,
      lastDocReminderAt: '',
      qualificationDecision: s.qualificationDecision,
      qualificationRemarks: s.qualificationRemarks,
      interviewSlotId: '',
      interviewDate: '',
      interviewTime: '',
      interviewMode: '',
      interviewerName: '',
      interviewFeedback: s.interviewFeedback,
      interviewRating: s.interviewRating,
      postInterviewDecision: s.postInterviewDecision,
      offerStatus: s.offerStatus,
      finalDecisionNotes: s.finalDecisionNotes,
      ownerId: actor.uid,
      assignedStaffIds: [actor.uid],
    };

    // Log Stage 5 shortlist email for shortlisted candidates
    if (s.currentStage >= 5 && s.currentStage <= 7) {
      const mail = composeAutomatedEmail({
        templateType: 'shortlist_forms_disc',
        candidateName: s.fullName,
        positionApplied: s.positionApplied,
        department: s.department,
      });
      await logAutomatedEmail({
        actor,
        candidate: candRecord,
        templateType: 'shortlist_forms_disc',
        subject: mail.subject,
        bodyPreview: mail.bodyPreview,
        stageTriggered: 5,
      });
    }

    // Atomically book slot 0 for Chong Hui Xin so Stage 10 transaction is live-demonstrated
    if (s.autoBookSlotIndex !== undefined && createdSlotIds[s.autoBookSlotIndex]) {
      await bookInterviewSlotAtomically({
        actor,
        candidate: candRecord,
        slotId: createdSlotIds[s.autoBookSlotIndex],
      });
    }
  }

  await recordPdpaAudit({
    actor,
    action: 'WORKSPACE_SAMPLE_INITIALIZED',
    targetType: 'candidate',
    targetId: 'batch_seed',
    details: 'Initialized TalentFlow MY workspace with 8 Malaysian candidate records across Stages 3–15 and 6 interview slots.',
  });
}
