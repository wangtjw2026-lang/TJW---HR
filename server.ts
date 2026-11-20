import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  db,
  ensureCandidateDocumentRows,
  generateCandidateCode,
  generatePortalToken,
  UPLOADS_ROOT,
} from './src/db/database.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'talentflow-my-dev-jwt-secret-change-in-prod';

const EMPLOYMENT_FORM_URL =
  'https://script.google.com/macros/s/AKfycbzmwDILioaOGbozPl9t13wCJLpdF_T99WHAglBDJJXvEZTmWIt2oilSNYLyyatK6cG0/exec';
const DISC_FORM_URL =
  'https://script.google.com/macros/s/AKfycby-lUFDHSd2NmbiS3Gbg8Y22Ql8smy3XjatCdIs3s5AZ2yeqTBUB6dBQbhgt5EpDt1W/exec';

type StaffRole = 'administrator' | 'manager';

interface AuthPayload {
  id: number;
  email: string;
  name: string;
  role: StaffRole;
  department: string;
}

interface AuthedRequest extends Request {
  user?: AuthPayload;
}

// =============================================================================
// MULTER LOCAL DISK FILE STORAGE (uploads/)
// =============================================================================
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_ROOT);
  },
  filename: (_req, file, cb) => {
    const safeExt = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
    const safeBase = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 48);
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `${unique}_${safeBase || 'file'}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// =============================================================================
// EMAIL AUTOMATION (Nodemailer with SQLite email_logs + console fallback)
// =============================================================================
function createMailTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
}

const mailTransporter = createMailTransporter();

async function dispatchEmail(params: {
  candidateId: number | null;
  candidateName: string;
  recipientEmail: string;
  templateType: string;
  subject: string;
  bodyText: string;
  stageTriggered: number;
  triggeredBy: string;
}) {
  let deliveryStatus = 'LOGGED_LOCAL';
  if (mailTransporter) {
    try {
      await mailTransporter.sendMail({
        from: process.env.SMTP_FROM || 'TalentFlow MY HR <hr@company.com>',
        to: params.recipientEmail,
        subject: params.subject,
        text: params.bodyText,
      });
      deliveryStatus = 'SENT_SMTP';
    } catch (err) {
      console.error('[Email Automation] SMTP send failed, logged to DB:', err);
      deliveryStatus = 'SMTP_FAILED_LOGGED';
    }
  } else {
    console.log(
      `\n[TalentFlow MY Email] (${params.templateType}) -> ${params.recipientEmail}\nSubject: ${params.subject}\n${params.bodyText}\n`
    );
  }

  db.prepare(`
    INSERT INTO email_logs (
      candidate_id, candidate_name, recipient_email, template_type,
      subject, body_preview, stage_triggered, delivery_status, triggered_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.candidateId,
    params.candidateName,
    params.recipientEmail,
    params.templateType,
    params.subject,
    params.bodyText,
    params.stageTriggered,
    deliveryStatus,
    params.triggeredBy
  );
}

function logAudit(params: {
  actor?: AuthPayload | null;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  targetType: string;
  targetId: string | number;
  details: string;
}) {
  db.prepare(`
    INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.actor?.id ?? null,
    params.actor?.email || params.actorEmail || 'candidate-portal',
    params.actor?.role || params.actorRole || 'CANDIDATE',
    params.action,
    params.targetType,
    String(params.targetId),
    params.details
  );
}

function getAppBaseUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function normalizePhone(phone: string): string {
  return String(phone || '').replace(/[\s\-()]/g, '').toLowerCase();
}

function getGeminiClient() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add your Gemini API key in Settings > Secrets to enable AI resume screening.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function inferResumeMimeType(mimeType: string, fileName: string): string {
  const ext = path.extname(fileName || '').toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.txt') return 'text/plain';
  const normalized = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (normalized === 'image/jpg') return 'image/jpeg';
  return normalized;
}

function sanitizeResumeText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\uFFFD/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .trim();
}

function formatMalaysianPhone(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const digitsOnly = trimmed.replace(/\D/g, '');
  let local = digitsOnly;
  if (local.startsWith('60') && local.length >= 11 && local.length <= 12) {
    local = `0${local.slice(2)}`;
  }
  if (/^011\d{8}$/.test(local)) {
    return `${local.slice(0, 3)}-${local.slice(3)}`;
  }
  if (/^01[02-9]\d{7,8}$/.test(local)) {
    return `${local.slice(0, 3)}-${local.slice(3)}`;
  }
  return trimmed.slice(0, 40);
}

function parseResumeMultipartIfPresent(req: Request, res: Response, next: NextFunction) {
  if (req.is('multipart/form-data')) {
    memoryUpload.any()(req, res, (err: unknown) => {
      if (err) {
        const message =
          err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
            ? 'Resume file exceeds the 15MB upload limit.'
            : err instanceof Error
              ? err.message
              : 'Failed to read uploaded resume file.';
        res.status(400).json({ error: message });
        return;
      }
      if (!req.file && Array.isArray(req.files) && req.files.length > 0) {
        req.file = req.files[0] as Express.Multer.File;
      }
      next();
    });
    return;
  }
  next();
}

// =============================================================================
// AUTH & RBAC MIDDLEWARE
// =============================================================================
function verifyJwtToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  const decoded = verifyJwtToken(token);
  if (!decoded) {
    res.status(401).json({ error: 'Session expired or invalid token. Please sign in again.' });
    return;
  }
  const dbUser = db
    .prepare('SELECT id, name, email, role, department FROM users WHERE id = ?')
    .get(decoded.id) as AuthPayload | undefined;
  if (!dbUser) {
    res.status(401).json({ error: 'Account no longer exists.' });
    return;
  }
  req.user = dbUser;
  next();
}

function requireRole(...allowedRoles: StaffRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Forbidden: Administrator role is required to perform this action.',
      });
      return;
    }
    next();
  };
}

// =============================================================================
// HYDRATION HELPERS
// =============================================================================
function hydrateCandidate(row: Record<string, unknown>, _role: StaffRole | 'CANDIDATE') {
  const candidateId = Number(row.id);
  const docs = db
    .prepare('SELECT * FROM candidate_documents WHERE candidate_id = ? ORDER BY id ASC')
    .all(candidateId) as Array<Record<string, unknown>>;

  const bookingRow = db
    .prepare(`
      SELECT b.*, s.date, s.start_time, s.end_time, s.location_or_link, s.interviewer_name, s.mode
      FROM interview_bookings b
      JOIN interview_slots s ON s.id = b.slot_id
      WHERE b.candidate_id = ? AND b.status IN ('CONFIRMED', 'COMPLETED')
      ORDER BY b.id DESC
      LIMIT 1
    `)
    .get(candidateId) as Record<string, unknown> | undefined;

  const offerRow = db
    .prepare('SELECT * FROM offers WHERE candidate_id = ? LIMIT 1')
    .get(candidateId) as Record<string, unknown> | undefined;

  let skills: string[] = [];
  try {
    const parsed = JSON.parse(String(row.skills || '[]'));
    skills = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    skills = [];
  }

  const canSeeSalary = true;

  return {
    ...row,
    skills,
    documents: docs.map((d) => ({
      id: Number(d.id),
      candidate_id: Number(d.candidate_id),
      doc_type: String(d.doc_type),
      completed: Boolean(d.completed),
      verified: Boolean(d.verified),
      not_applicable: Boolean(d.not_applicable),
      file_name: String(d.file_name || ''),
      file_path: String(d.file_path || ''),
      uploaded_at: String(d.uploaded_at || ''),
    })),
    active_booking: bookingRow
      ? {
          id: Number(bookingRow.id),
          slot_id: Number(bookingRow.slot_id),
          candidate_id: Number(bookingRow.candidate_id),
          status: String(bookingRow.status),
          booked_at: String(bookingRow.booked_at),
          date: String(bookingRow.date),
          start_time: String(bookingRow.start_time),
          end_time: String(bookingRow.end_time),
          location_or_link: String(bookingRow.location_or_link),
          interviewer_name: String(bookingRow.interviewer_name),
          mode: String(bookingRow.mode),
        }
      : null,
    offer: offerRow
      ? {
          id: Number(offerRow.id),
          candidate_id: Number(offerRow.candidate_id),
          position: String(offerRow.position),
          department: String(offerRow.department),
          salary_myr: canSeeSalary ? Number(offerRow.salary_myr) : null,
          allowance_myr: canSeeSalary ? Number(offerRow.allowance_myr) : null,
          probation_months: Number(offerRow.probation_months),
          start_date: String(offerRow.start_date),
          issue_date: String(offerRow.issue_date),
          deadline_date: String(offerRow.deadline_date),
          offer_letter_path: String(offerRow.offer_letter_path || ''),
          offer_terms_summary: String(offerRow.offer_terms_summary || ''),
          status: String(offerRow.status),
          candidate_response_note: String(offerRow.candidate_response_note || ''),
          responded_at: String(offerRow.responded_at || ''),
          created_at: String(offerRow.created_at),
        }
      : null,
  };
}

function hydrateSlot(slot: Record<string, unknown>) {
  const bookings = db
    .prepare(`
      SELECT b.*, c.full_name as candidate_name, c.position as candidate_position
      FROM interview_bookings b
      JOIN candidates c ON c.id = b.candidate_id
      WHERE b.slot_id = ?
      ORDER BY b.booked_at DESC
    `)
    .all(Number(slot.id));
  return {
    ...slot,
    bookings,
  };
}

function getMissingDocsForCandidate(candidateId: number): string[] {
  const labels: Record<string, string> = {
    APP_FORM: 'Employment Application Form (Google Apps Script)',
    DISC: 'DISC Personality Assessment (Google Apps Script)',
    SPM: 'SPM Examination Results',
    UEC: 'UEC Examination Results',
    DEGREE: 'University Degree Certificate',
    TRANSCRIPT: 'University Academic Transcript',
  };
  const rows = db
    .prepare(`SELECT doc_type, completed, verified, not_applicable FROM candidate_documents WHERE candidate_id = ? AND doc_type != 'RESUME'`)
    .all(candidateId) as Array<{ doc_type: string; completed: number; verified: number; not_applicable: number }>;

  const missing: string[] = [];
  for (const r of rows) {
    if (r.not_applicable) continue;
    if (!r.completed && !r.verified) {
      missing.push(labels[r.doc_type] || r.doc_type);
    }
  }
  return missing;
}

// Atomic interview slot booking transaction (prevents double-booking)
const reserveSlotTransaction = db.transaction((slotId: number, candidateId: number) => {
  const slot = db.prepare('SELECT * FROM interview_slots WHERE id = ?').get(slotId) as
    | {
        id: number;
        date: string;
        start_time: string;
        end_time: string;
        capacity: number;
        booked_count: number;
        location_or_link: string;
        interviewer_name: string;
        mode: string;
        status: string;
      }
    | undefined;

  if (!slot) {
    throw new Error('Interview slot not found.');
  }
  if (slot.status !== 'ACTIVE') {
    throw new Error('This interview slot has been cancelled.');
  }
  if (slot.booked_count >= slot.capacity) {
    throw new Error('This interview slot is already full. Atomic locking prevented double-booking.');
  }

  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as
    | { id: number; full_name: string; email: string; position: string; department: string }
    | undefined;
  if (!candidate) {
    throw new Error('Candidate not found.');
  }

  // If candidate already had an active CONFIRMED booking, release it cleanly in the same transaction
  const prevBooking = db
    .prepare(`SELECT * FROM interview_bookings WHERE candidate_id = ? AND status = 'CONFIRMED' LIMIT 1`)
    .get(candidateId) as { id: number; slot_id: number } | undefined;

  if (prevBooking) {
    if (prevBooking.slot_id === slotId) {
      throw new Error('Candidate already holds a confirmed reservation for this slot.');
    }
    db.prepare(`UPDATE interview_bookings SET status = 'RESCHEDULED' WHERE id = ?`).run(prevBooking.id);
    db.prepare(`UPDATE interview_slots SET booked_count = MAX(0, booked_count - 1) WHERE id = ?`).run(
      prevBooking.slot_id
    );
  }

  const info = db
    .prepare(`INSERT INTO interview_bookings (slot_id, candidate_id, status) VALUES (?, ?, 'CONFIRMED')`)
    .run(slotId, candidateId);

  db.prepare(`UPDATE interview_slots SET booked_count = booked_count + 1 WHERE id = ?`).run(slotId);

  db.prepare(`
    UPDATE candidates
    SET stage = CASE WHEN stage < 10 THEN 10 ELSE stage END,
        status = 'interview_confirmed',
        updated_at = datetime('now')
    WHERE id = ?
  `).run(candidateId);

  return {
    bookingId: Number(info.lastInsertRowid),
    slot,
    candidate,
  };
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'talentflow-my-sqlite' });
  });

  // ===========================================================================
  // 1. AUTHENTICATION, FIRST-RUN ADMIN SETUP & STAFF RBAC ROUTES
  // ===========================================================================
  app.get('/api/auth/setup-status', (_req: Request, res: Response) => {
    const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    res.json({ needsSetup: row.count === 0 });
  });

  app.post('/api/auth/setup', (req: Request, res: Response) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const department = String(req.body?.department || 'Human Resources').trim() || 'Human Resources';

    const existingCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
    if (existingCount > 0) {
      res.status(403).json({ error: 'Initial HR Admin account already exists. Please sign in.' });
      return;
    }

    if (!name || !email || !email.includes('@') || password.length < 8) {
      res.status(400).json({
        error: 'Full name, valid work email, and a password of at least 8 characters are required.',
      });
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    const createInitialAdmin = db.transaction(() => {
      const countInsideTx = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
      if (countInsideTx > 0) {
        return null;
      }
      const info = db
        .prepare('INSERT INTO users (name, email, password_hash, role, department) VALUES (?, ?, ?, ?, ?)')
        .run(name, email, hash, 'administrator', department);
      return db
        .prepare('SELECT id, name, email, role, department, created_at FROM users WHERE id = ?')
        .get(info.lastInsertRowid) as {
        id: number;
        name: string;
        email: string;
        role: StaffRole;
        department: string;
        created_at: string;
      };
    });

    const createdUser = createInitialAdmin();
    if (!createdUser) {
      res.status(403).json({ error: 'Initial Administrator account already exists. Please sign in.' });
      return;
    }

    const payload: AuthPayload = {
      id: createdUser.id,
      email: createdUser.email,
      name: createdUser.name,
      role: createdUser.role,
      department: createdUser.department,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

    logAudit({
      actor: payload,
      action: 'INITIAL_ADMIN_CREATED',
      targetType: 'auth',
      targetId: createdUser.id,
      details: `Registered initial Administrator account (${createdUser.email}).`,
    });

    res.status(201).json({ token, user: createdUser });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const user = db
      .prepare('SELECT id, name, email, password_hash, role, department, created_at FROM users WHERE lower(email) = ?')
      .get(email) as
      | (AuthPayload & { password_hash: string; created_at: string })
      | undefined;

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const payload: AuthPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

    logAudit({
      actor: payload,
      action: 'STAFF_LOGIN',
      targetType: 'auth',
      targetId: user.id,
      details: `${user.email} signed in (${user.role}).`,
    });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        created_at: user.created_at,
      },
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  app.get('/api/users', requireAuth, requireRole('administrator'), (_req: AuthedRequest, res: Response) => {
    const users = db
      .prepare('SELECT id, name, email, role, department, created_at FROM users ORDER BY id ASC')
      .all();
    res.json({ users });
  });

  app.post('/api/users', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const role: StaffRole = req.body?.role === 'administrator' ? 'administrator' : 'manager';
    const department = String(req.body?.department || 'Human Resources').trim() || 'Human Resources';

    if (!name || !email || !email.includes('@') || password.length < 6) {
      res.status(400).json({ error: 'Name, valid email, and password (min 6 characters) are required.' });
      return;
    }

    const exists = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
    if (exists) {
      res.status(409).json({ error: 'A user account with this email already exists.' });
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare('INSERT INTO users (name, email, password_hash, role, department) VALUES (?, ?, ?, ?, ?)')
      .run(name, email, hash, role, department);

    logAudit({
      actor: req.user,
      action: 'STAFF_USER_CREATED',
      targetType: 'rbac',
      targetId: Number(info.lastInsertRowid),
      details: `Created ${role} account for ${email}.`,
    });

    const created = db
      .prepare('SELECT id, name, email, role, department, created_at FROM users WHERE id = ?')
      .get(info.lastInsertRowid);
    res.status(201).json({ user: created });
  });

  app.patch('/api/users/:id', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    const targetId = Number(req.params.id);
    const role: StaffRole = req.body?.role === 'administrator' ? 'administrator' : 'manager';
    const department = String(req.body?.department || 'Human Resources').trim() || 'Human Resources';

    const target = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(targetId) as
      | { id: number; email: string; role: StaffRole }
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    if (target.role === 'administrator' && role !== 'administrator') {
      const adminCount = (
        db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'administrator'`).get() as { count: number }
      ).count;
      if (adminCount <= 1) {
        res.status(400).json({ error: 'Cannot demote the last remaining Administrator account.' });
        return;
      }
    }

    db.prepare('UPDATE users SET role = ?, department = ? WHERE id = ?').run(role, department, targetId);
    logAudit({
      actor: req.user,
      action: 'RBAC_ROLE_UPDATED',
      targetType: 'rbac',
      targetId,
      details: `Updated role for ${target.email} to ${role} (${department}).`,
    });

    const updated = db
      .prepare('SELECT id, name, email, role, department, created_at FROM users WHERE id = ?')
      .get(targetId);
    res.json({ user: updated });
  });

  app.delete('/api/users/:id', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    const targetId = Number(req.params.id);
    if (req.user && targetId === req.user.id) {
      res.status(400).json({ error: 'You cannot delete your own currently signed-in account.' });
      return;
    }

    const target = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(targetId) as
      | { id: number; email: string; role: StaffRole }
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    if (target.role === 'administrator') {
      const adminCount = (
        db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'administrator'`).get() as { count: number }
      ).count;
      if (adminCount <= 1) {
        res.status(400).json({ error: 'Cannot delete the last remaining Administrator account.' });
        return;
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    logAudit({
      actor: req.user,
      action: 'STAFF_USER_DELETED',
      targetType: 'rbac',
      targetId,
      details: `Removed ${target.role} account (${target.email}).`,
    });

    res.json({ deleted: true });
  });

  // ===========================================================================
  // 2. GEMINI AI RESUME PARSER & JOB-FIT SCORECARD (SERVER-SIDE ONLY)
  // ===========================================================================
  app.post(
    '/api/ai/parse-resume',
    requireAuth,
    requireRole('administrator'),
    parseResumeMultipartIfPresent,
    async (req: AuthedRequest, res: Response) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const uploadedFile: Express.Multer.File | null =
          req.file ||
          (Array.isArray(req.files) && req.files.length > 0
            ? (req.files[0] as Express.Multer.File)
            : null);

        let resumeText = sanitizeResumeText(body.resumeText ?? body.resume_text);
        const position = String(body.position ?? body.positionApplied ?? '').trim() || 'General Role';
        const department = String(body.department ?? '').trim() || 'Operations';
        const rubric = String(body.rubric ?? body.jobRequirements ?? '').trim();

        const rawJsonBase64 = String(body.fileBase64 ?? '').trim();
        const rawJsonMimeType = String(body.fileMimeType ?? '').trim();
        const fileName = uploadedFile?.originalname || String(body.fileName ?? '').trim();

        const SUPPORTED_INLINE_MIMES = new Set([
          'application/pdf',
          'image/png',
          'image/jpeg',
          'image/webp',
        ]);

        let inlineFile: { mimeType: string; data: string } | null = null;

        if (uploadedFile) {
          let fileBuffer: Buffer | null = null;
          if (uploadedFile.buffer && uploadedFile.buffer.length > 0) {
            fileBuffer = uploadedFile.buffer;
          } else if (uploadedFile.path && fs.existsSync(uploadedFile.path)) {
            fileBuffer = fs.readFileSync(uploadedFile.path);
          }

          if (!fileBuffer || fileBuffer.length === 0) {
            res.status(400).json({
              error: `Uploaded file "${uploadedFile.originalname}" appears to be empty (0 bytes). Please upload a valid resume file or paste the CV text directly.`,
            });
            return;
          }

          const resolvedMime = inferResumeMimeType(uploadedFile.mimetype, uploadedFile.originalname);
          if (resolvedMime === 'text/plain') {
            const decodedText = sanitizeResumeText(fileBuffer.toString('utf8'));
            if (decodedText) {
              resumeText = resumeText ? `${resumeText}\n\n${decodedText}` : decodedText;
            }
          } else if (SUPPORTED_INLINE_MIMES.has(resolvedMime)) {
            inlineFile = {
              mimeType: resolvedMime,
              data: fileBuffer.toString('base64'),
            };
          } else {
            res.status(400).json({
              error: `Unsupported file format (${uploadedFile.originalname}). Please upload a PDF, PNG, JPG, WEBP, or TXT resume, or paste the resume text directly.`,
            });
            return;
          }
        } else if (rawJsonBase64) {
          const cleanBase64 = rawJsonBase64.includes(',')
            ? rawJsonBase64.split(',')[1]
            : rawJsonBase64;
          const resolvedMime = inferResumeMimeType(rawJsonMimeType, fileName);
          if (resolvedMime === 'text/plain') {
            const decodedText = sanitizeResumeText(Buffer.from(cleanBase64, 'base64').toString('utf8'));
            if (decodedText) {
              resumeText = resumeText ? `${resumeText}\n\n${decodedText}` : decodedText;
            }
          } else if (SUPPORTED_INLINE_MIMES.has(resolvedMime)) {
            inlineFile = {
              mimeType: resolvedMime,
              data: cleanBase64,
            };
          } else {
            res.status(400).json({
              error: 'Unsupported resume file type. Please upload a PDF, PNG, JPG, WEBP, or TXT file.',
            });
            return;
          }
        }

        if (!inlineFile && !resumeText) {
          res.status(400).json({ error: 'No resume file or text provided.' });
          return;
        }

        const ai = getGeminiClient();
        const configuredModel = (process.env.GEMINI_MODEL || '').trim();
        const modelCandidates = Array.from(
          new Set([
            ...(configuredModel ? [configuredModel] : []),
            'gemini-4-hydrogen',
            'gemini-3.1-flash-lite',
          ])
        );

        console.log('[Gemini Parse Resume] Request:', {
          models: modelCandidates,
          hasInlineFile: Boolean(inlineFile),
          inlineMimeType: inlineFile?.mimeType || null,
          inlineBase64Length: inlineFile?.data.length || 0,
          textLength: resumeText.length,
          fileName: fileName || null,
          position,
        });

        const prompt = [
          'You are an experienced Malaysian enterprise HR recruitment specialist.',
          `Analyze the candidate resume for the position "${position}" in the "${department}" department.`,
          rubric ? `Screening rubric / role requirements: ${rubric}` : '',
          'Extract every available candidate detail accurately from the resume into a single flat JSON object with these exact keys:',
          '- full_name: Candidate full name exactly as written on the resume.',
          '- email: Candidate email address (empty string if not present; never invent).',
          '- phone: Candidate phone number formatted cleanly for Malaysia (e.g., 012-3456789 or 011-12345678; empty string if not present).',
          '- location: City and state in Malaysia (e.g., Petaling Jaya, Selangor or Kuala Lumpur; empty string if not stated).',
          '- years_experience: Total relevant years of working experience as a number (0 to 50).',
          '- has_uec: true only if UEC (Unified Examination Certificate) is explicitly mentioned in the resume, otherwise false.',
          '- skills: Array of up to 15 concise technical, domain, and soft skills found in the resume.',
          '- education: Highest qualification, institution, CGPA/grade, plus Malaysian qualifications (SPM, STPM, UEC, Diploma, Degree) if present.',
          '- experience: Concise summary of relevant roles, employers, key achievements, and total years of experience.',
          '- ai_score: Realistic integer job-fit score from 0 to 100 evaluated against the position and rubric.',
          '- ai_summary: Concise HR screening evaluation covering strengths, gaps, and hiring recommendation.',
        ]
          .filter(Boolean)
          .join('\n');

        const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
          { text: prompt },
        ];

        if (inlineFile) {
          parts.push({
            inlineData: {
              mimeType: inlineFile.mimeType,
              data: inlineFile.data,
            },
          });
        }

        if (resumeText) {
          parts.push({
            text: `Resume Content:\n${resumeText.slice(0, 60_000)}`,
          });
        }

        const responseSchema = {
          type: Type.OBJECT,
          properties: {
            full_name: { type: Type.STRING, description: 'Candidate full name' },
            email: { type: Type.STRING, description: 'Candidate email address if present, else empty string' },
            phone: {
              type: Type.STRING,
              description: 'Phone number formatted cleanly for Malaysia e.g. 01X-XXXXXXX',
            },
            location: { type: Type.STRING, description: 'City / State location' },
            years_experience: {
              type: Type.NUMBER,
              description: 'Total relevant years of working experience (0 to 50)',
            },
            has_uec: {
              type: Type.BOOLEAN,
              description: 'Whether UEC qualification is explicitly mentioned',
            },
            skills: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'List of key technical and domain skills',
            },
            education: {
              type: Type.STRING,
              description: 'Highest qualification, institution, CGPA/grade, and SPM/UEC/Degree details',
            },
            experience: {
              type: Type.STRING,
              description: 'Concise summary of relevant roles, employers, and years of experience',
            },
            ai_score: { type: Type.INTEGER, description: 'Job-fit score from 0 to 100' },
            ai_summary: {
              type: Type.STRING,
              description: 'HR screening summary covering strengths, gaps, and recommendation',
            },
          },
          required: [
            'full_name',
            'email',
            'phone',
            'location',
            'years_experience',
            'has_uec',
            'skills',
            'education',
            'experience',
            'ai_score',
            'ai_summary',
          ],
        };

        const PER_ATTEMPT_TIMEOUT_MS = 28_000;
        let responseText = '';
        let lastError: unknown = null;

        for (const modelName of modelCandidates) {
          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
          const abortController = new AbortController();
          const timeoutPromise = new Promise<never>((_resolve, reject) => {
            timeoutHandle = setTimeout(() => {
              abortController.abort();
              reject(new Error(`Model ${modelName} timed out after ${PER_ATTEMPT_TIMEOUT_MS / 1000}s.`));
            }, PER_ATTEMPT_TIMEOUT_MS);
          });

          const thinkingConfig =
            modelName === 'gemini-3.1-flash-lite'
              ? { thinkingLevel: ThinkingLevel.MINIMAL }
              : /^gemini-(3|4)/i.test(modelName)
                ? { thinkingLevel: ThinkingLevel.LOW }
                : undefined;

          try {
            const response = await Promise.race([
              ai.models.generateContent({
                model: modelName,
                contents: [{ role: 'user', parts }],
                config: {
                  abortSignal: abortController.signal,
                  systemInstruction:
                    'Return strictly valid flat JSON matching the provided schema. Never wrap the JSON inside an extra key or array. Never fabricate email addresses or phone numbers that do not appear in the resume.',
                  responseMimeType: 'application/json',
                  responseSchema,
                  ...(thinkingConfig ? { thinkingConfig } : {}),
                },
              }),
              timeoutPromise,
            ]).finally(() => {
              if (timeoutHandle) clearTimeout(timeoutHandle);
            });

            const candidateText = (response.text ?? '').trim();
            if (candidateText) {
              responseText = candidateText;
              console.log(`[Gemini Parse Resume] Succeeded with model=${modelName}`);
              break;
            }
            lastError = new Error(`Model ${modelName} returned an empty response.`);
          } catch (attemptErr: unknown) {
            lastError = attemptErr;
            const errMsg = attemptErr instanceof Error ? attemptErr.message : String(attemptErr);
            console.warn(`[Gemini Parse Resume] Attempt failed on model=${modelName}:`, errMsg);
            // Stop retrying immediately on invalid API key or quota exhaustion
            if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED|429|RESOURCE_EXHAUSTED/i.test(errMsg)) {
              throw attemptErr;
            }
          }
        }

        console.log('Gemini raw extraction:', responseText);

        if (!responseText) {
          if (lastError instanceof Error) {
            throw lastError;
          }
          res.status(502).json({
            error: inlineFile
              ? 'Could not read text from the uploaded resume. Please check that the PDF is not password-protected or paste the CV text directly.'
              : 'Could not extract candidate details from the pasted resume text. Please try again.',
          });
          return;
        }

        const cleanedJsonText = responseText
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();

        let rawParsed: unknown;
        try {
          rawParsed = JSON.parse(cleanedJsonText);
        } catch {
          const objMatch = cleanedJsonText.match(/\{[\s\S]*\}/);
          if (!objMatch) {
            res.status(502).json({
              error: 'Gemini AI returned malformed JSON. Please retry resume analysis.',
            });
            return;
          }
          try {
            rawParsed = JSON.parse(objMatch[0]);
          } catch {
            res.status(502).json({
              error: 'Gemini AI returned malformed JSON. Please retry resume analysis.',
            });
            return;
          }
        }

        const unwrapped = Array.isArray(rawParsed)
          ? (rawParsed[0] as Record<string, unknown> | undefined) ?? {}
          : (rawParsed as Record<string, unknown>);
        const parsed = (
          (unwrapped.extracted as Record<string, unknown> | undefined) ||
          (unwrapped.data as Record<string, unknown> | undefined) ||
          (unwrapped.result as Record<string, unknown> | undefined) ||
          (unwrapped.candidate as Record<string, unknown> | undefined) ||
          unwrapped
        );

        const fullName = String(parsed.full_name ?? parsed.fullName ?? parsed.name ?? '').trim().slice(0, 140);
        const email = String(parsed.email ?? '').trim().slice(0, 254);
        const phone = formatMalaysianPhone(String(parsed.phone ?? parsed.contact_number ?? ''));
        const location = String(parsed.location ?? '').trim().slice(0, 120);
        const education = String(parsed.education ?? parsed.education_summary ?? parsed.educationSummary ?? '')
          .trim()
          .slice(0, 600);
        const experience = String(parsed.experience ?? parsed.experience_summary ?? parsed.experienceSummary ?? '')
          .trim()
          .slice(0, 800);
        const skills = Array.isArray(parsed.skills)
          ? parsed.skills.map((s: unknown) => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 20)
          : typeof parsed.skills === 'string'
            ? parsed.skills
                .split(',')
                .map((s) => s.trim().slice(0, 60))
                .filter(Boolean)
                .slice(0, 20)
            : [];
        const rawScore = Number(parsed.ai_score ?? parsed.aiMatchScore ?? parsed.match_score ?? parsed.score);
        const aiScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;
        const aiSummary = String(parsed.ai_summary ?? parsed.aiSummary ?? '').trim().slice(0, 1200);
        const rawYears = Number(parsed.years_experience ?? parsed.yearsExperience);
        const yearsExperience = Number.isFinite(rawYears)
          ? Math.max(0, Math.min(60, Math.round(rawYears * 2) / 2))
          : 0;
        const hasUec =
          Boolean(parsed.has_uec ?? parsed.hasUec ?? parsed.detected_uec_mention ?? parsed.detectedUecMention) ||
          /\buec\b/i.test(`${education} ${resumeText}`);

        const extractedFieldCount = [
          fullName,
          email,
          phone,
          location,
          education,
          experience,
          skills.length > 0 ? 'skills' : '',
          aiSummary,
        ].filter(Boolean).length;

        if (extractedFieldCount === 0) {
          res.status(422).json({
            error: inlineFile
              ? 'Could not read text from the uploaded resume. Please check that the PDF is not password-protected or paste the CV text directly.'
              : 'Could not extract candidate profile fields from the pasted resume text. Please include more candidate details and try again.',
          });
          return;
        }

        res.json({
          full_name: fullName,
          email,
          phone,
          location,
          years_experience: yearsExperience,
          has_uec: hasUec,
          skills,
          education,
          experience,
          ai_score: aiScore,
          ai_summary: aiSummary,
        });
      } catch (err: unknown) {
        const rawMessage = err instanceof Error ? err.message : 'Failed to analyze resume with Gemini AI.';
        console.error('Gemini resume parse error:', err);

        let statusCode = 500;
        let userMessage = rawMessage;
        if (/timed out/i.test(rawMessage)) {
          statusCode = 504;
          userMessage = 'Gemini AI resume analysis timed out. Please retry or paste the plain resume text.';
        } else if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(rawMessage)) {
          userMessage =
            'Invalid or unauthorized GEMINI_API_KEY on the server. Please verify your Gemini API key in Settings > Secrets.';
        } else if (/429|RESOURCE_EXHAUSTED|quota/i.test(rawMessage)) {
          statusCode = 429;
          userMessage = 'Gemini API rate limit or quota reached. Please wait a moment and try again.';
        }

        res.status(statusCode).json({ error: userMessage });
      }
    }
  );

  // ===========================================================================
  // 3. CANDIDATE CRUD, WORKFLOW TRANSITIONS & DOCUMENT UPLOADS
  // ===========================================================================
  app.get('/api/candidates', requireAuth, (req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare('SELECT * FROM candidates ORDER BY applied_date DESC, id DESC')
      .all() as Array<Record<string, unknown>>;
    const role = req.user!.role;
    const candidates = rows.map((r) => hydrateCandidate(r, role));
    res.json({ candidates });
  });

  app.get('/api/candidates/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Candidate not found.' });
      return;
    }
    res.json({ candidate: hydrateCandidate(row, req.user!.role) });
  });

  app.post('/api/candidates', requireAuth, requireRole('administrator'), upload.single('resumeFile'), (req: AuthedRequest, res: Response) => {
    const body = req.body ?? {};
    const fullName = String(body.full_name || body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim();
    const location = String(body.location || 'Kuala Lumpur, Malaysia').trim();
    const position = String(body.position || body.positionApplied || '').trim();
    const department = String(body.department || '').trim();
    const source = body.source === 'Email' ? 'Email' : 'JobStreet';
    const education = String(body.education || body.educationSummary || '').trim();
    const experience = String(body.experience || body.experienceSummary || '').trim();
    const yearsExperience = Math.max(0, Math.min(60, Number(body.years_experience ?? body.yearsExperience ?? 0) || 0));
    const aiScore = Math.max(0, Math.min(100, Math.round(Number(body.ai_score ?? body.aiMatchScore ?? 0) || 0)));
    const aiSummary = String(body.ai_summary || body.aiSummary || '').trim();
    const hasUec = body.hasUec === true || body.hasUec === 'true';

    let skillsArr: string[] = [];
    if (Array.isArray(body.skills)) {
      skillsArr = body.skills.map(String).filter(Boolean).slice(0, 20);
    } else if (typeof body.skills === 'string' && body.skills.trim()) {
      try {
        const parsed = JSON.parse(body.skills);
        skillsArr = Array.isArray(parsed) ? parsed.map(String) : body.skills.split(',').map((s: string) => s.trim()).filter(Boolean);
      } catch {
        skillsArr = body.skills.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    }

    if (!fullName || !email || !phone || !position || !department) {
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(400).json({ error: 'Full name, email, phone, position, and department are required.' });
      return;
    }

    // Duplicate check by email OR normalized phone
    const emailDup = db.prepare('SELECT id, candidate_code, full_name FROM candidates WHERE lower(email) = ?').get(email) as
      | { id: number; candidate_code: string; full_name: string }
      | undefined;
    if (emailDup) {
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(409).json({
        error: `Duplicate candidate blocked: ${emailDup.full_name} (${emailDup.candidate_code}) already exists with email ${email}.`,
      });
      return;
    }

    const normPhone = normalizePhone(phone);
    const allPhones = db.prepare('SELECT id, candidate_code, full_name, phone FROM candidates').all() as Array<{
      id: number;
      candidate_code: string;
      full_name: string;
      phone: string;
    }>;
    const phoneDup = allPhones.find((c) => normalizePhone(c.phone) === normPhone && normPhone.length >= 7);
    if (phoneDup) {
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(409).json({
        error: `Duplicate candidate blocked: ${phoneDup.full_name} (${phoneDup.candidate_code}) already exists with matching phone number.`,
      });
      return;
    }

    const candidateCode = generateCandidateCode();
    const portalToken = generatePortalToken();
    const appliedDate = String(body.applied_date || new Date().toISOString().slice(0, 10));

    const info = db
      .prepare(`
        INSERT INTO candidates (
          candidate_code, full_name, phone, email, location, position, department, source,
          applied_date, stage, status, education, experience, years_experience, skills,
          ai_score, ai_summary, portal_token
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 3, 'pending_screening', ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        candidateCode,
        fullName,
        phone,
        email,
        location,
        position,
        department,
        source,
        appliedDate,
        education,
        experience,
        yearsExperience,
        JSON.stringify(skillsArr),
        aiScore,
        aiSummary,
        portalToken
      );

    const candidateId = Number(info.lastInsertRowid);
    ensureCandidateDocumentRows(candidateId, hasUec);

    if (req.file) {
      db.prepare(`
        UPDATE candidate_documents
        SET completed = 1, verified = 1, file_name = ?, file_path = ?, uploaded_at = datetime('now')
        WHERE candidate_id = ? AND doc_type = 'RESUME'
      `).run(req.file.originalname, req.file.filename, candidateId);
    } else if (body.resumeFileName) {
      db.prepare(`
        UPDATE candidate_documents
        SET completed = 1, verified = 1, file_name = ?, uploaded_at = datetime('now')
        WHERE candidate_id = ? AND doc_type = 'RESUME'
      `).run(String(body.resumeFileName), candidateId);
    }

    logAudit({
      actor: req.user,
      action: 'CANDIDATE_REGISTERED',
      targetType: 'candidate',
      targetId: candidateId,
      details: `Registered ${fullName} (${candidateCode}) via ${source} for ${position} (AI Score: ${aiScore}%).`,
    });

    const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as Record<string, unknown>;
    res.status(201).json({ candidate: hydrateCandidate(row, req.user!.role) });
  });

  // Update candidate workflow stages, screening decision, docs verification, qualification, panel evaluation
  app.patch('/api/candidates/:id', requireAuth, requireRole('administrator'), async (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Candidate not found.' });
      return;
    }

    const body = req.body ?? {};
    const actionType = String(body.actionType || 'generic');
    const portalUrl = `${getAppBaseUrl(req)}/?portal=${String(existing.portal_token)}`;

    // 1. Stage 4 Screening Decision
    if (actionType === 'screening_decision') {
      const decision = String(body.screening_decision || 'pending');
      const remarks = String(body.screening_remarks || '').trim();
      if (decision === 'reject' && !remarks) {
        res.status(400).json({ error: 'A mandatory rejection reason is required when rejecting a candidate.' });
        return;
      }
      const nextStage = decision === 'proceed' ? 5 : decision === 'reject' ? 4 : 3;
      const nextStatus =
        decision === 'proceed'
          ? 'shortlisted_docs'
          : decision === 'reject'
            ? 'rejected_screening'
            : 'pending_screening';

      db.prepare(`
        UPDATE candidates
        SET stage = ?, status = ?, screening_decision = ?, screening_remarks = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(nextStage, nextStatus, decision, remarks, id);

      if (decision === 'proceed') {
        await dispatchEmail({
          candidateId: id,
          candidateName: String(existing.full_name),
          recipientEmail: String(existing.email),
          templateType: 'shortlist_forms_disc',
          subject: `[TalentFlow MY] Shortlisted for ${existing.position} — Complete Application & DISC Assessment`,
          bodyText: [
            `Dear ${existing.full_name},`,
            '',
            `Congratulations! Your application for ${existing.position} (${existing.department}) has progressed to the next stage.`,
            '',
            'Please complete both official forms below:',
            `1. Employment Application Form: ${EMPLOYMENT_FORM_URL}`,
            `2. DISC Personality Assessment: ${DISC_FORM_URL}`,
            '',
            'Required Malaysian Academic Documents to Upload via Your Self-Service Portal:',
            '- SPM Examination Results (Mandatory)',
            '- UEC Examination Results (If applicable)',
            '- University Degree Certificate (Mandatory)',
            '- University Academic Transcript (Mandatory)',
            '',
            `Candidate Self-Service Portal Link: ${portalUrl}`,
            '',
            'Best regards,',
            'TalentFlow MY HR Recruitment Team',
          ].join('\n'),
          stageTriggered: 5,
          triggeredBy: req.user!.email,
        });
      } else if (decision === 'reject') {
        await dispatchEmail({
          candidateId: id,
          candidateName: String(existing.full_name),
          recipientEmail: String(existing.email),
          templateType: 'rejection_notice',
          subject: `Application Update — ${existing.position}`,
          bodyText: `Dear ${existing.full_name},\n\nThank you for applying for the ${existing.position} position (${existing.department}). After careful review, we will not be moving forward at this stage.\n\nWe appreciate your interest and wish you every success.\n\nTalentFlow MY HR Team`,
          stageTriggered: 4,
          triggeredBy: req.user!.email,
        });
      }

      logAudit({
        actor: req.user,
        action: `SCREENING_${decision.toUpperCase()}`,
        targetType: 'candidate',
        targetId: id,
        details:
          decision === 'proceed'
            ? `Shortlisted ${existing.full_name} (Stage 5) & sent Employment Form + DISC Assessment links.`
            : `Updated screening decision for ${existing.full_name} to ${decision}. Remarks: ${remarks}`,
      });
    }
    // 2. Stage 6-7 Document Checklist & Google Apps Script Verification
    else if (actionType === 'docs_verification') {
      const docsUpdates = Array.isArray(body.documents) ? body.documents : [];
      const discProfile = String(body.disc_profile ?? existing.disc_profile ?? '').trim();

      const updateDocStmt = db.prepare(`
        UPDATE candidate_documents
        SET completed = ?, verified = ?, not_applicable = ?
        WHERE candidate_id = ? AND doc_type = ?
      `);

      for (const item of docsUpdates) {
        updateDocStmt.run(
          item.completed ? 1 : 0,
          item.verified ? 1 : 0,
          item.not_applicable ? 1 : 0,
          id,
          String(item.doc_type)
        );
      }

      const missing = getMissingDocsForCandidate(id);
      const currentStage = Number(existing.stage);
      const nextStage = currentStage < 7 ? (missing.length === 0 ? 7 : 6) : currentStage;
      const nextStatus =
        currentStage <= 7 ? (missing.length === 0 ? 'docs_under_review' : 'shortlisted_docs') : String(existing.status);

      db.prepare(`
        UPDATE candidates
        SET stage = ?, status = ?, disc_profile = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(nextStage, nextStatus, discProfile, id);

      logAudit({
        actor: req.user,
        action: 'DOCS_CHECKLIST_UPDATED',
        targetType: 'candidate',
        targetId: id,
        details: `Verified forms & academic documents for ${existing.full_name} (Remaining missing: ${missing.length}).`,
      });
    }
    // 3. Stage 8 -> 9 Qualification Decision + Auto Interview Invite
    else if (actionType === 'qualification_decision') {
      const qualStatus = String(body.qualification_status || 'pending');
      const qualRemarks = String(body.qualification_remarks || '').trim();

      const nextStage = qualStatus === 'qualified' ? 9 : qualStatus === 'not_qualified' ? 8 : 7;
      const nextStatus =
        qualStatus === 'qualified'
          ? 'interview_invited'
          : qualStatus === 'not_qualified'
            ? 'not_qualified'
            : 'docs_under_review';

      db.prepare(`
        UPDATE candidates
        SET stage = ?, status = ?, qualification_status = ?, qualification_remarks = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(nextStage, nextStatus, qualStatus, qualRemarks, id);

      if (qualStatus === 'qualified') {
        await dispatchEmail({
          candidateId: id,
          candidateName: String(existing.full_name),
          recipientEmail: String(existing.email),
          templateType: 'interview_invite',
          subject: `[Interview Invitation] Select Your Interview Slot — ${existing.position}`,
          bodyText: [
            `Dear ${existing.full_name},`,
            '',
            `Great news! Your forms and academic credentials for ${existing.position} (${existing.department}) have been verified and you are Qualified for the interview stage.`,
            '',
            'Please open your personal Self-Service Interview Portal link below to reserve an available date and time slot:',
            portalUrl,
            '',
            'Slots are reserved atomically on a first-come basis and you will receive an instant confirmation email upon booking.',
            '',
            'Best regards,',
            'TalentFlow MY Recruitment Team',
          ].join('\n'),
          stageTriggered: 9,
          triggeredBy: req.user!.email,
        });
      } else if (qualStatus === 'not_qualified') {
        await dispatchEmail({
          candidateId: id,
          candidateName: String(existing.full_name),
          recipientEmail: String(existing.email),
          templateType: 'rejection_notice',
          subject: `Application Update — ${existing.position}`,
          bodyText: `Dear ${existing.full_name},\n\nThank you for submitting your assessments and academic documents for ${existing.position}. After review, we will not be advancing to the interview stage at this time.\n\nBest wishes,\nTalentFlow MY HR Team`,
          stageTriggered: 8,
          triggeredBy: req.user!.email,
        });
      }

      logAudit({
        actor: req.user,
        action: `QUALIFICATION_${qualStatus.toUpperCase()}`,
        targetType: 'candidate',
        targetId: id,
        details: `Classified ${existing.full_name} as ${qualStatus}. Remarks: ${qualRemarks}`,
      });
    }
    // 4. Stage 11-12 Post-Interview Evaluation & Decision
    else if (actionType === 'post_interview') {
      const feedback = String(body.interview_feedback || '').trim();
      const rating = Math.max(0, Math.min(5, Math.round(Number(body.interview_rating) || 0)));
      const decision = String(body.post_interview_decision || 'pending');
      const notes = String(body.final_decision_notes || '').trim();

      const nextStatus = decision === 'reject' ? 'rejected_post_interview' : 'interview_completed';
      db.prepare(`
        UPDATE candidates
        SET stage = 12, status = ?, interview_feedback = ?, interview_rating = ?,
            post_interview_decision = ?, final_decision_notes = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(nextStatus, feedback, rating, decision, notes, id);

      if (decision === 'reject') {
        await dispatchEmail({
          candidateId: id,
          candidateName: String(existing.full_name),
          recipientEmail: String(existing.email),
          templateType: 'rejection_notice',
          subject: `Interview Outcome — ${existing.position}`,
          bodyText: `Dear ${existing.full_name},\n\nThank you for interviewing with our team for ${existing.position} (${existing.department}). While we appreciated meeting you, we have decided to proceed with another candidate at this time.\n\nWarm regards,\nTalentFlow MY HR Team`,
          stageTriggered: 12,
          triggeredBy: req.user!.email,
        });
      }

      logAudit({
        actor: req.user,
        action: `POST_INTERVIEW_${decision.toUpperCase()}`,
        targetType: 'candidate',
        targetId: id,
        details: `Recorded panel rating ${rating}/5 and post-interview decision "${decision}" for ${existing.full_name}.`,
      });
    }
    // Generic profile update
    else {
      const fullName = String(body.full_name ?? existing.full_name).trim();
      const position = String(body.position ?? existing.position).trim();
      const department = String(body.department ?? existing.department).trim();
      db.prepare(`
        UPDATE candidates SET full_name = ?, position = ?, department = ?, updated_at = datetime('now') WHERE id = ?
      `).run(fullName, position, department, id);
    }

    const updated = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ candidate: hydrateCandidate(updated, req.user!.role) });
  });

  // Upload a candidate document file (HR staff)
  app.post(
    '/api/candidates/:id/documents',
    requireAuth,
    requireRole('administrator'),
    upload.single('file'),
    (req: AuthedRequest, res: Response) => {
      const candidateId = Number(req.params.id);
      const docType = String(req.body?.doc_type || '').toUpperCase();
      const allowedTypes = ['RESUME', 'SPM', 'UEC', 'DEGREE', 'TRANSCRIPT'];

      if (!allowedTypes.includes(docType)) {
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(400).json({ error: 'Invalid document type.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'Please select a file to upload.' });
        return;
      }

      const candidate = db.prepare('SELECT id, full_name FROM candidates WHERE id = ?').get(candidateId) as
        | { id: number; full_name: string }
        | undefined;
      if (!candidate) {
        fs.unlink(req.file.path, () => {});
        res.status(404).json({ error: 'Candidate not found.' });
        return;
      }

      ensureCandidateDocumentRows(candidateId);
      db.prepare(`
        UPDATE candidate_documents
        SET completed = 1, not_applicable = 0, file_name = ?, file_path = ?, uploaded_at = datetime('now')
        WHERE candidate_id = ? AND doc_type = ?
      `).run(req.file.originalname, req.file.filename, candidateId, docType);

      logAudit({
        actor: req.user,
        action: 'DOCUMENT_UPLOADED',
        targetType: 'document',
        targetId: `${candidateId}:${docType}`,
        details: `Uploaded ${docType} (${req.file.originalname}) for ${candidate.full_name}.`,
      });

      const updated = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as Record<string, unknown>;
      res.json({ candidate: hydrateCandidate(updated, req.user!.role) });
    }
  );

  // Stage 6: Automated Document Reminder Email (Single)
  app.post('/api/candidates/:id/remind-docs', requireAuth, requireRole('administrator'), async (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!candidate) {
      res.status(404).json({ error: 'Candidate not found.' });
      return;
    }

    const missing = getMissingDocsForCandidate(id);
    const portalUrl = `${getAppBaseUrl(req)}/?portal=${String(candidate.portal_token)}`;
    const nowIso = new Date().toISOString().slice(0, 19);

    db.prepare(`
      UPDATE candidates
      SET last_doc_reminder_at = ?, stage = CASE WHEN stage < 6 THEN 6 ELSE stage END, updated_at = datetime('now')
      WHERE id = ?
    `).run(nowIso, id);

    await dispatchEmail({
      candidateId: id,
      candidateName: String(candidate.full_name),
      recipientEmail: String(candidate.email),
      templateType: 'docs_reminder_48h',
      subject: `[Reminder] Pending Forms & Academic Documents — ${candidate.position}`,
      bodyText: [
        `Dear ${candidate.full_name},`,
        '',
        `This is a reminder for your ${candidate.position} application. We are still awaiting the following items:`,
        ...(missing.length > 0 ? missing.map((m) => `- ${m}`) : ['- Outstanding academic documents / assessments']),
        '',
        `Employment Application Form: ${EMPLOYMENT_FORM_URL}`,
        `DISC Personality Assessment: ${DISC_FORM_URL}`,
        `Upload Academic Docs (SPM, UEC if applicable, Degree, Transcript): ${portalUrl}`,
        '',
        'Thank you,',
        'TalentFlow MY HR Team',
      ].join('\n'),
      stageTriggered: 6,
      triggeredBy: req.user!.email,
    });

    logAudit({
      actor: req.user,
      action: 'DOCS_REMINDER_DISPATCHED',
      targetType: 'candidate',
      targetId: id,
      details: `Sent document reminder to ${candidate.full_name} (${missing.length} outstanding items).`,
    });

    const updated = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ candidate: hydrateCandidate(updated, req.user!.role) });
  });

  // Batch 48h Missing-Docs Reminder
  app.post('/api/candidates/remind-docs-batch', requireAuth, requireRole('administrator'), async (req: AuthedRequest, res: Response) => {
    const ids = Array.isArray(req.body?.candidateIds) ? req.body.candidateIds.map(Number) : [];
    let sentCount = 0;

    for (const id of ids) {
      const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined;
      if (!candidate) continue;
      const missing = getMissingDocsForCandidate(id);
      if (missing.length === 0) continue;

      const portalUrl = `${getAppBaseUrl(req)}/?portal=${String(candidate.portal_token)}`;
      db.prepare(`
        UPDATE candidates
        SET last_doc_reminder_at = ?, stage = CASE WHEN stage < 6 THEN 6 ELSE stage END, updated_at = datetime('now')
        WHERE id = ?
      `).run(new Date().toISOString().slice(0, 19), id);

      await dispatchEmail({
        candidateId: id,
        candidateName: String(candidate.full_name),
        recipientEmail: String(candidate.email),
        templateType: 'docs_reminder_48h',
        subject: `[Reminder] Pending Forms & Academic Documents — ${candidate.position}`,
        bodyText: [
          `Dear ${candidate.full_name},`,
          '',
          `This is a 48-hour follow-up reminder for your ${candidate.position} application. Outstanding items:`,
          ...missing.map((m) => `- ${m}`),
          '',
          `Employment Application Form: ${EMPLOYMENT_FORM_URL}`,
          `DISC Personality Assessment: ${DISC_FORM_URL}`,
          `Upload Portal: ${portalUrl}`,
          '',
          'Regards,\nTalentFlow MY HR Team',
        ].join('\n'),
        stageTriggered: 6,
        triggeredBy: req.user!.email,
      });
      sentCount++;
    }

    logAudit({
      actor: req.user,
      action: 'BATCH_DOCS_REMINDER',
      targetType: 'candidate',
      targetId: `batch_${sentCount}`,
      details: `Dispatched batch document reminders to ${sentCount} candidate(s).`,
    });

    res.json({ sentCount });
  });

  // Stage 13: Create/Send Employment Offer (HR Admin only, optional offer letter PDF)
  app.post(
    '/api/candidates/:id/offer',
    requireAuth,
    requireRole('administrator'),
    upload.single('offerLetter'),
    async (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined;
      if (!candidate) {
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(404).json({ error: 'Candidate not found.' });
        return;
      }

      const body = req.body ?? {};
      const position = String(body.position || candidate.position).trim();
      const department = String(body.department || candidate.department).trim();
      const salaryMyr = Math.max(0, Number(body.salary_myr) || 0);
      const allowanceMyr = Math.max(0, Number(body.allowance_myr) || 0);
      const probationMonths = Math.max(0, Math.min(24, Math.round(Number(body.probation_months) || 3)));
      const startDate = String(body.start_date || '').trim();
      const deadlineDate = String(body.deadline_date || '').trim();
      const issueDate = new Date().toISOString().slice(0, 10);
      const termsSummary = String(body.offer_terms_summary || '').trim();

      const existingOffer = db.prepare('SELECT id, offer_letter_path FROM offers WHERE candidate_id = ?').get(id) as
        | { id: number; offer_letter_path: string }
        | undefined;

      const offerLetterPath = req.file ? req.file.filename : existingOffer?.offer_letter_path || '';

      if (existingOffer) {
        db.prepare(`
          UPDATE offers
          SET position = ?, department = ?, salary_myr = ?, allowance_myr = ?, probation_months = ?,
              start_date = ?, issue_date = ?, deadline_date = ?, offer_letter_path = ?,
              offer_terms_summary = ?, status = 'Offer Sent', candidate_response_note = '', responded_at = ''
          WHERE candidate_id = ?
        `).run(
          position,
          department,
          salaryMyr,
          allowanceMyr,
          probationMonths,
          startDate,
          issueDate,
          deadlineDate,
          offerLetterPath,
          termsSummary,
          id
        );
      } else {
        db.prepare(`
          INSERT INTO offers (
            candidate_id, position, department, salary_myr, allowance_myr, probation_months,
            start_date, issue_date, deadline_date, offer_letter_path, offer_terms_summary, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Offer Sent')
        `).run(
          id,
          position,
          department,
          salaryMyr,
          allowanceMyr,
          probationMonths,
          startDate,
          issueDate,
          deadlineDate,
          offerLetterPath,
          termsSummary
        );
      }

      db.prepare(`
        UPDATE candidates
        SET stage = 13, status = 'offer_sent', final_decision_notes = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(`Official MYR offer dispatched on ${issueDate}.`, id);

      const portalUrl = `${getAppBaseUrl(req)}/?portal=${String(candidate.portal_token)}`;
      await dispatchEmail({
        candidateId: id,
        candidateName: String(candidate.full_name),
        recipientEmail: String(candidate.email),
        templateType: 'employment_offer',
        subject: `[Employment Offer] ${position} — TalentFlow MY`,
        bodyText: [
          `Dear ${candidate.full_name},`,
          '',
          `We are delighted to extend an official Offer of Employment for the role of ${position} (${department}).`,
          `- Monthly Base Salary: RM ${salaryMyr.toLocaleString('en-MY')}`,
          allowanceMyr > 0 ? `- Monthly Fixed Allowance: RM ${allowanceMyr.toLocaleString('en-MY')}` : '',
          `- Proposed Start Date: ${startDate || 'TBD'}`,
          `- Offer Response Deadline: ${deadlineDate || 'Within 5 working days'}`,
          '',
          `Review your offer and confirm acceptance via your Candidate Self-Service Portal:`,
          portalUrl,
          '',
          'Warm regards,\nTalentFlow MY HR Admin',
        ]
          .filter(Boolean)
          .join('\n'),
        stageTriggered: 13,
        triggeredBy: req.user!.email,
      });

      logAudit({
        actor: req.user,
        action: 'EMPLOYMENT_OFFER_SENT',
        targetType: 'offer',
        targetId: id,
        details: `Generated & dispatched MYR offer (RM ${salaryMyr}/mo) to ${candidate.full_name}.`,
      });

      const updated = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown>;
      res.json({ candidate: hydrateCandidate(updated, req.user!.role) });
    }
  );

  // Stage 14-15: Update Offer Status (HR Admin)
  app.patch('/api/candidates/:id/offer-status', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status || 'Pending Response');
    const note = String(req.body?.candidate_response_note || '').trim();
    const validStatuses = ['Offer Sent', 'Pending Response', 'Accepted', 'Rejected', 'Expired'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid offer status.' });
      return;
    }

    const offer = db.prepare('SELECT id FROM offers WHERE candidate_id = ?').get(id);
    if (!offer) {
      res.status(404).json({ error: 'No employment offer exists for this candidate yet.' });
      return;
    }

    const isFinal = status === 'Accepted' || status === 'Rejected' || status === 'Expired';
    const nextStage = isFinal ? 15 : 14;
    const candStatus =
      status === 'Accepted'
        ? 'offer_accepted'
        : status === 'Rejected'
          ? 'offer_rejected'
          : status === 'Expired'
            ? 'offer_expired'
            : status === 'Offer Sent'
              ? 'offer_sent'
              : 'offer_pending';

    db.prepare(`
      UPDATE offers
      SET status = ?, candidate_response_note = ?, responded_at = CASE WHEN ? = 1 THEN datetime('now') ELSE responded_at END
      WHERE candidate_id = ?
    `).run(status, note, isFinal ? 1 : 0, id);

    db.prepare(`
      UPDATE candidates SET stage = ?, status = ?, final_decision_notes = ?, updated_at = datetime('now') WHERE id = ?
    `).run(nextStage, candStatus, note || `Offer status updated to ${status}.`, id);

    logAudit({
      actor: req.user,
      action: `OFFER_${status.toUpperCase().replace(/\s+/g, '_')}`,
      targetType: 'offer',
      targetId: id,
      details: `Updated offer status for candidate #${id} to "${status}" (Stage ${nextStage}).`,
    });

    const updated = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ candidate: hydrateCandidate(updated, req.user!.role) });
  });

  app.delete('/api/candidates/:id', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id, full_name, candidate_code FROM candidates WHERE id = ?').get(id) as
      | { id: number; full_name: string; candidate_code: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Candidate not found.' });
      return;
    }

    // Release any confirmed bookings atomically
    const deleteTx = db.transaction((candId: number) => {
      const bookings = db
        .prepare(`SELECT slot_id FROM interview_bookings WHERE candidate_id = ? AND status = 'CONFIRMED'`)
        .all(candId) as Array<{ slot_id: number }>;
      for (const b of bookings) {
        db.prepare('UPDATE interview_slots SET booked_count = MAX(0, booked_count - 1) WHERE id = ?').run(b.slot_id);
      }
      db.prepare('DELETE FROM candidates WHERE id = ?').run(candId);
    });
    deleteTx(id);

    logAudit({
      actor: req.user,
      action: 'CANDIDATE_DELETED',
      targetType: 'candidate',
      targetId: id,
      details: `Deleted candidate ${existing.full_name} (${existing.candidate_code}).`,
    });

    res.json({ deleted: true });
  });

  // ===========================================================================
  // 4. INTERVIEW SLOTS & ATOMIC BOOKING CALENDAR
  // ===========================================================================
  app.get('/api/interview-slots', requireAuth, (_req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare('SELECT * FROM interview_slots ORDER BY date ASC, start_time ASC')
      .all() as Array<Record<string, unknown>>;
    res.json({ slots: rows.map(hydrateSlot) });
  });

  app.post('/api/interview-slots', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    const body = req.body ?? {};
    const date = String(body.date || '').trim();
    const startTime = String(body.start_time || '').trim();
    const endTime = String(body.end_time || '').trim();
    const capacity = Math.max(1, Math.min(20, Math.round(Number(body.capacity) || 1)));
    const locationOrLink = String(body.location_or_link || '').trim();
    const interviewerName = String(body.interviewer_name || 'Hiring Panel').trim();
    const department = String(body.department || 'Human Resources').trim();
    const mode = String(body.mode || 'Google Meet').trim();

    if (!date || !startTime || !endTime) {
      res.status(400).json({ error: 'Date, start time, and end time are required.' });
      return;
    }

    const info = db
      .prepare(`
        INSERT INTO interview_slots (
          date, start_time, end_time, capacity, booked_count,
          location_or_link, interviewer_name, department, mode, status
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'ACTIVE')
      `)
      .run(date, startTime, endTime, capacity, locationOrLink, interviewerName, department, mode);

    const slotId = Number(info.lastInsertRowid);
    logAudit({
      actor: req.user,
      action: 'INTERVIEW_SLOT_CREATED',
      targetType: 'interview_slot',
      targetId: slotId,
      details: `Created slot ${date} ${startTime}-${endTime} (capacity ${capacity}) with ${interviewerName}.`,
    });

    const row = db.prepare('SELECT * FROM interview_slots WHERE id = ?').get(slotId) as Record<string, unknown>;
    res.status(201).json({ slot: hydrateSlot(row) });
  });

  app.patch('/api/interview-slots/:id', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    const slotId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM interview_slots WHERE id = ?').get(slotId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Interview slot not found.' });
      return;
    }

    const body = req.body ?? {};
    const date = String(body.date ?? existing.date);
    const startTime = String(body.start_time ?? existing.start_time);
    const endTime = String(body.end_time ?? existing.end_time);
    const capacity = Math.max(Number(existing.booked_count) || 1, Math.min(20, Math.round(Number(body.capacity ?? existing.capacity) || 1)));
    const locationOrLink = String(body.location_or_link ?? existing.location_or_link);
    const interviewerName = String(body.interviewer_name ?? existing.interviewer_name);
    const status = body.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE';

    db.prepare(`
      UPDATE interview_slots
      SET date = ?, start_time = ?, end_time = ?, capacity = ?, location_or_link = ?, interviewer_name = ?, status = ?
      WHERE id = ?
    `).run(date, startTime, endTime, capacity, locationOrLink, interviewerName, status, slotId);

    logAudit({
      actor: req.user,
      action: status === 'CANCELLED' ? 'INTERVIEW_SLOT_CANCELLED' : 'INTERVIEW_SLOT_UPDATED',
      targetType: 'interview_slot',
      targetId: slotId,
      details: `Updated slot #${slotId} (${date} ${startTime}-${endTime}, capacity ${capacity}, status ${status}).`,
    });

    const updated = db.prepare('SELECT * FROM interview_slots WHERE id = ?').get(slotId) as Record<string, unknown>;
    res.json({ slot: hydrateSlot(updated) });
  });

  app.delete('/api/interview-slots/:id', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    const slotId = Number(req.params.id);
    const existing = db.prepare('SELECT id, date, start_time, booked_count FROM interview_slots WHERE id = ?').get(slotId) as
      | { id: number; date: string; start_time: string; booked_count: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Interview slot not found.' });
      return;
    }
    if (existing.booked_count > 0) {
      res.status(400).json({ error: 'Cancel active bookings before deleting this slot.' });
      return;
    }
    db.prepare('DELETE FROM interview_slots WHERE id = ?').run(slotId);
    logAudit({
      actor: req.user,
      action: 'INTERVIEW_SLOT_DELETED',
      targetType: 'interview_slot',
      targetId: slotId,
      details: `Deleted interview slot ${existing.date} ${existing.start_time}.`,
    });
    res.json({ deleted: true });
  });

  // HR-initiated atomic slot booking
  app.post('/api/interview-slots/:id/book', requireAuth, requireRole('administrator'), async (req: AuthedRequest, res: Response) => {
    const slotId = Number(req.params.id);
    const candidateId = Number(req.body?.candidateId);
    if (!candidateId) {
      res.status(400).json({ error: 'candidateId is required.' });
      return;
    }

    try {
      const result = reserveSlotTransaction(slotId, candidateId);
      await dispatchEmail({
        candidateId: result.candidate.id,
        candidateName: result.candidate.full_name,
        recipientEmail: result.candidate.email,
        templateType: 'interview_confirmation',
        subject: `[Confirmed] Interview Schedule for ${result.candidate.position} on ${result.slot.date}`,
        bodyText: [
          `Dear ${result.candidate.full_name},`,
          '',
          `Your interview for ${result.candidate.position} (${result.candidate.department}) is confirmed:`,
          `- Date: ${result.slot.date}`,
          `- Time: ${result.slot.start_time} - ${result.slot.end_time} MYT`,
          `- Mode: ${result.slot.mode}`,
          `- Panelist: ${result.slot.interviewer_name}`,
          `- Location / Link: ${result.slot.location_or_link || 'Provided by HR'}`,
          '',
          'We look forward to speaking with you.',
          '',
          'Regards,\nTalentFlow MY HR Team',
        ].join('\n'),
        stageTriggered: 10,
        triggeredBy: req.user!.email,
      });

      logAudit({
        actor: req.user,
        action: 'INTERVIEW_SLOT_BOOKED_ATOMIC',
        targetType: 'interview_slot',
        targetId: slotId,
        details: `Atomically booked slot #${slotId} (${result.slot.date} ${result.slot.start_time}) for ${result.candidate.full_name}.`,
      });

      const slotRow = db.prepare('SELECT * FROM interview_slots WHERE id = ?').get(slotId) as Record<string, unknown>;
      const candRow = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as Record<string, unknown>;
      res.json({
        slot: hydrateSlot(slotRow),
        candidate: hydrateCandidate(candRow, req.user!.role),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to book slot.';
      res.status(409).json({ error: msg });
    }
  });

  // Update booking status (COMPLETE / CANCEL / RESCHEDULE)
  app.patch('/api/interview-bookings/:id', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    const bookingId = Number(req.params.id);
    const nextStatus = String(req.body?.status || '');
    const valid = ['CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED'];
    if (!valid.includes(nextStatus)) {
      res.status(400).json({ error: 'Invalid booking status.' });
      return;
    }

    const tx = db.transaction(() => {
      const booking = db.prepare('SELECT * FROM interview_bookings WHERE id = ?').get(bookingId) as
        | { id: number; slot_id: number; candidate_id: number; status: string }
        | undefined;
      if (!booking) throw new Error('Booking not found.');

      db.prepare('UPDATE interview_bookings SET status = ? WHERE id = ?').run(nextStatus, bookingId);

      if ((nextStatus === 'CANCELLED' || nextStatus === 'RESCHEDULED') && booking.status === 'CONFIRMED') {
        db.prepare('UPDATE interview_slots SET booked_count = MAX(0, booked_count - 1) WHERE id = ?').run(
          booking.slot_id
        );
        db.prepare(`UPDATE candidates SET stage = 9, status = 'interview_invited', updated_at = datetime('now') WHERE id = ?`).run(
          booking.candidate_id
        );
      } else if (nextStatus === 'COMPLETED') {
        db.prepare(`UPDATE candidates SET stage = 11, status = 'interview_completed', updated_at = datetime('now') WHERE id = ?`).run(
          booking.candidate_id
        );
      }

      return booking;
    });

    try {
      const booking = tx();
      logAudit({
        actor: req.user,
        action: `INTERVIEW_BOOKING_${nextStatus}`,
        targetType: 'interview_slot',
        targetId: booking.slot_id,
        details: `Updated booking #${bookingId} (candidate #${booking.candidate_id}) to ${nextStatus}.`,
      });
      res.json({ updated: true });
    } catch (err: unknown) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Booking update failed.' });
    }
  });

  // ===========================================================================
  // 5. PUBLIC CANDIDATE SELF-SERVICE PORTAL (/api/portal/:token)
  // ===========================================================================
  app.get('/api/portal/:token', (req: Request, res: Response) => {
    const token = String(req.params.token || '').trim();
    const row = db.prepare('SELECT * FROM candidates WHERE portal_token = ?').get(token) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Invalid or expired candidate portal token.' });
      return;
    }

    const availableSlots = db
      .prepare(`
        SELECT * FROM interview_slots
        WHERE status = 'ACTIVE' AND booked_count < capacity
        ORDER BY date ASC, start_time ASC
      `)
      .all();

    res.json({
      candidate: hydrateCandidate(row, 'CANDIDATE'),
      availableSlots,
    });
  });

  // Candidate portal actions: upload doc, mark Google Apps Script forms done, book slot, respond to offer
  app.post('/api/portal/:token', upload.single('file'), async (req: Request, res: Response) => {
    const token = String(req.params.token || '').trim();
    const row = db.prepare('SELECT * FROM candidates WHERE portal_token = ?').get(token) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(404).json({ error: 'Invalid or expired candidate portal token.' });
      return;
    }

    const candidateId = Number(row.id);
    const action = String(req.body?.action || '');

    // Action A: Upload academic document (SPM, UEC, DEGREE, TRANSCRIPT)
    if (action === 'upload_document') {
      const docType = String(req.body?.doc_type || '').toUpperCase();
      if (!['SPM', 'UEC', 'DEGREE', 'TRANSCRIPT'].includes(docType)) {
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(400).json({ error: 'Invalid academic document type.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'Please attach a document file (PDF/Image).' });
        return;
      }

      ensureCandidateDocumentRows(candidateId);
      db.prepare(`
        UPDATE candidate_documents
        SET completed = 1, not_applicable = 0, file_name = ?, file_path = ?, uploaded_at = datetime('now')
        WHERE candidate_id = ? AND doc_type = ?
      `).run(req.file.originalname, req.file.filename, candidateId, docType);

      const missing = getMissingDocsForCandidate(candidateId);
      const nextStage = Number(row.stage) < 7 ? (missing.length === 0 ? 7 : 6) : Number(row.stage);
      const nextStatus =
        Number(row.stage) <= 7 ? (missing.length === 0 ? 'docs_under_review' : 'shortlisted_docs') : String(row.status);

      db.prepare(`UPDATE candidates SET stage = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(
        nextStage,
        nextStatus,
        candidateId
      );

      logAudit({
        actorEmail: String(row.email),
        actorRole: 'CANDIDATE',
        action: 'PORTAL_DOCUMENT_UPLOADED',
        targetType: 'document',
        targetId: `${candidateId}:${docType}`,
        details: `Candidate ${row.full_name} uploaded ${docType} (${req.file.originalname}) via self-service portal.`,
      });
    }
    // Action B: Mark Google Apps Script forms (APP_FORM, DISC) complete
    else if (action === 'complete_forms') {
      const appForm = req.body?.app_form_completed === true || req.body?.app_form_completed === 'true';
      const discForm = req.body?.disc_completed === true || req.body?.disc_completed === 'true';

      ensureCandidateDocumentRows(candidateId);
      if (appForm) {
        db.prepare(`
          UPDATE candidate_documents SET completed = 1, uploaded_at = datetime('now')
          WHERE candidate_id = ? AND doc_type = 'APP_FORM'
        `).run(candidateId);
      }
      if (discForm) {
        db.prepare(`
          UPDATE candidate_documents SET completed = 1, uploaded_at = datetime('now')
          WHERE candidate_id = ? AND doc_type = 'DISC'
        `).run(candidateId);
      }

      const missing = getMissingDocsForCandidate(candidateId);
      const nextStage = Number(row.stage) < 7 ? (missing.length === 0 ? 7 : 6) : Number(row.stage);
      const nextStatus =
        Number(row.stage) <= 7 ? (missing.length === 0 ? 'docs_under_review' : 'shortlisted_docs') : String(row.status);

      db.prepare(`UPDATE candidates SET stage = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(
        nextStage,
        nextStatus,
        candidateId
      );

      logAudit({
        actorEmail: String(row.email),
        actorRole: 'CANDIDATE',
        action: 'PORTAL_FORMS_COMPLETED',
        targetType: 'candidate',
        targetId: candidateId,
        details: `Candidate ${row.full_name} confirmed Google Apps Script form completion via portal.`,
      });
    }
    // Action C: Atomic Self-Service Interview Slot Booking
    else if (action === 'book_slot') {
      const slotId = Number(req.body?.slot_id);
      if (!slotId) {
        res.status(400).json({ error: 'Please select an interview slot.' });
        return;
      }
      if (String(row.qualification_status) !== 'qualified') {
        res.status(403).json({ error: 'Interview booking is only available once HR qualifies your application.' });
        return;
      }

      try {
        const result = reserveSlotTransaction(slotId, candidateId);
        await dispatchEmail({
          candidateId: result.candidate.id,
          candidateName: result.candidate.full_name,
          recipientEmail: result.candidate.email,
          templateType: 'interview_confirmation',
          subject: `[Confirmed] Interview Schedule for ${result.candidate.position} on ${result.slot.date}`,
          bodyText: [
            `Dear ${result.candidate.full_name},`,
            '',
            `Your self-scheduled interview slot for ${result.candidate.position} is confirmed:`,
            `- Date: ${result.slot.date}`,
            `- Time: ${result.slot.start_time} - ${result.slot.end_time} MYT`,
            `- Mode: ${result.slot.mode}`,
            `- Panelist: ${result.slot.interviewer_name}`,
            `- Location / Link: ${result.slot.location_or_link || 'Provided by HR'}`,
            '',
            'Your slot has been atomically reserved. We look forward to speaking with you.',
            '',
            'Regards,\nTalentFlow MY HR Team',
          ].join('\n'),
          stageTriggered: 10,
          triggeredBy: 'candidate-portal',
        });

        logAudit({
          actorEmail: String(row.email),
          actorRole: 'CANDIDATE',
          action: 'PORTAL_SLOT_BOOKED_ATOMIC',
          targetType: 'interview_slot',
          targetId: slotId,
          details: `Candidate ${row.full_name} self-booked slot #${slotId} (${result.slot.date} ${result.slot.start_time}).`,
        });
      } catch (err: unknown) {
        res.status(409).json({ error: err instanceof Error ? err.message : 'Slot reservation conflict.' });
        return;
      }
    }
    // Action D: Stage 15 Employment Offer Acceptance / Rejection
    else if (action === 'offer_response') {
      const accepted = req.body?.accepted === true || req.body?.accepted === 'true';
      const responseNote = String(req.body?.note || '').trim();
      const offer = db.prepare('SELECT id FROM offers WHERE candidate_id = ?').get(candidateId);
      if (!offer) {
        res.status(404).json({ error: 'No employment offer found for this candidate.' });
        return;
      }

      const offerStatus = accepted ? 'Accepted' : 'Rejected';
      const candStatus = accepted ? 'offer_accepted' : 'offer_rejected';

      db.prepare(`
        UPDATE offers SET status = ?, candidate_response_note = ?, responded_at = datetime('now')
        WHERE candidate_id = ?
      `).run(offerStatus, responseNote || `Candidate ${offerStatus.toLowerCase()} offer via portal.`, candidateId);

      db.prepare(`
        UPDATE candidates SET stage = 15, status = ?, final_decision_notes = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(candStatus, responseNote || `Offer ${offerStatus} via Candidate Portal.`, candidateId);

      logAudit({
        actorEmail: String(row.email),
        actorRole: 'CANDIDATE',
        action: `PORTAL_OFFER_${offerStatus.toUpperCase()}`,
        targetType: 'offer',
        targetId: candidateId,
        details: `Candidate ${row.full_name} ${offerStatus.toLowerCase()} employment offer via portal.`,
      });
    } else {
      res.status(400).json({ error: 'Unsupported portal action.' });
      return;
    }

    const refreshed = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as Record<string, unknown>;
    const availableSlots = db
      .prepare(`SELECT * FROM interview_slots WHERE status = 'ACTIVE' AND booked_count < capacity ORDER BY date ASC, start_time ASC`)
      .all();

    res.json({
      candidate: hydrateCandidate(refreshed, 'CANDIDATE'),
      availableSlots,
    });
  });

  // ===========================================================================
  // 6. PROTECTED FILE DOWNLOADS (/api/files/:filename)
  // ===========================================================================
  app.get('/api/files/:filename', (req: Request, res: Response) => {
    const safeFilename = path.basename(String(req.params.filename || ''));
    if (!safeFilename) {
      res.status(400).json({ error: 'Invalid filename.' });
      return;
    }

    // Authorize either via HR JWT (Header or query param) OR matching candidate portal_token
    const authHeader = req.headers.authorization || '';
    const jwtRaw = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : String(req.query.auth || '').trim();
    const portalToken = String(req.query.portal_token || '').trim();

    let authorized = false;

    if (jwtRaw && verifyJwtToken(jwtRaw)) {
      authorized = true;
    } else if (portalToken) {
      const cand = db.prepare('SELECT id FROM candidates WHERE portal_token = ?').get(portalToken) as
        | { id: number }
        | undefined;
      if (cand) {
        const docMatch = db
          .prepare('SELECT id FROM candidate_documents WHERE candidate_id = ? AND file_path = ?')
          .get(cand.id, safeFilename);
        const offerMatch = db
          .prepare('SELECT id FROM offers WHERE candidate_id = ? AND offer_letter_path = ?')
          .get(cand.id, safeFilename);
        if (docMatch || offerMatch) {
          authorized = true;
        }
      }
    }

    if (!authorized) {
      res.status(401).json({ error: 'Unauthorized file access. Provide a valid HR token or candidate portal token.' });
      return;
    }

    const fullPath = path.join(UPLOADS_ROOT, safeFilename);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'File not found on server storage.' });
      return;
    }

    res.sendFile(fullPath);
  });

  // ===========================================================================
  // 7. EMAIL LOGS & AUDIT LOGS
  // ===========================================================================
  app.get('/api/email-logs', requireAuth, (_req: AuthedRequest, res: Response) => {
    const emailLogs = db.prepare('SELECT * FROM email_logs ORDER BY id DESC LIMIT 200').all();
    res.json({ emailLogs });
  });

  app.get('/api/audit-logs', requireAuth, (_req: AuthedRequest, res: Response) => {
    const auditLogs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300').all();
    res.json({ auditLogs });
  });

  app.post('/api/audit-logs/export', requireAuth, (req: AuthedRequest, res: Response) => {
    const count = Number(req.body?.count) || 0;
    logAudit({
      actor: req.user,
      action: 'EXCEL_CSV_EXPORTED',
      targetType: 'export',
      targetId: `csv_${count}`,
      details: `Exported Excel-compatible CSV report covering ${count} filtered candidate record(s).`,
    });
    res.json({ logged: true });
  });

  // ===========================================================================
  // VITE DEV MIDDLEWARE / PRODUCTION STATIC SPA
  // ===========================================================================
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TalentFlow MY Express + SQLite server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
