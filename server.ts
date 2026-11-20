import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import mammoth from 'mammoth';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  db,
  ensureCandidateDocumentRows,
  formatAuditTimestamp,
  generateCandidateCode,
  generatePortalToken,
  getMalaysiaDateStamp,
  UPLOADS_ROOT,
} from './src/db/database.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'talentflow-my-dev-jwt-secret-change-in-prod';
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes of inactivity

const ALLOWED_DEPARTMENTS = ['HR', 'Finance', 'Audit', 'Tax', 'Secretarial', 'Account'] as const;
const ALLOWED_DEPARTMENTS_MAP = new Map<string, (typeof ALLOWED_DEPARTMENTS)[number]>(
  ALLOWED_DEPARTMENTS.map((dept) => [dept.toLowerCase(), dept])
);

function normalizeDepartment(raw: unknown, fallback: (typeof ALLOWED_DEPARTMENTS)[number] = 'HR'): string {
  const cleaned = String(raw || '').trim();
  if (!cleaned) return fallback;
  const exact = ALLOWED_DEPARTMENTS_MAP.get(cleaned.toLowerCase());
  if (exact) return exact;
  if (/human\s*resource|\bhr\b/i.test(cleaned)) return 'HR';
  if (/audit/i.test(cleaned)) return 'Audit';
  if (/\btax/i.test(cleaned)) return 'Tax';
  if (/secretar/i.test(cleaned)) return 'Secretarial';
  if (/account/i.test(cleaned)) return 'Account';
  if (/finance/i.test(cleaned)) return 'Finance';
  return fallback;
}

type StaffRole = 'administrator' | 'manager';
type UserApprovalStatus = 'pending' | 'approved' | 'rejected';
type TwoFaMethod = 'EMAIL_OTP' | 'AUTHENTICATOR_APP';
type TwoFaChangeStatus = 'locked' | 'pending_admin_approval';
type TwoFaRequestedAction =
  | 'RESET_2FA'
  | 'DISABLE_2FA'
  | 'ENABLE_2FA'
  | 'SWITCH_TO_AUTHENTICATOR_APP'
  | 'SWITCH_TO_EMAIL_OTP';
type AuditActorRole = 'administrator' | 'manager' | 'candidate_portal' | 'system';

const VALID_TWO_FA_ACTIONS = new Set<TwoFaRequestedAction>([
  'RESET_2FA',
  'DISABLE_2FA',
  'ENABLE_2FA',
  'SWITCH_TO_AUTHENTICATOR_APP',
  'SWITCH_TO_EMAIL_OTP',
]);

const PUBLIC_USER_SELECT = `id, name, email, role, department, status, approved_by, approved_at, two_fa_enabled, two_fa_method, two_fa_change_status, two_fa_requested_state, two_fa_approved_by, created_at`;

function serializePublicUser(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    email: String(row.email || ''),
    role: (row.role === 'administrator' ? 'administrator' : 'manager') as StaffRole,
    department: normalizeDepartment(row.department, 'HR'),
    status: (row.status === 'pending' || row.status === 'rejected' ? row.status : 'approved') as UserApprovalStatus,
    approved_by: String(row.approved_by || ''),
    approved_at: String(row.approved_at || ''),
    two_fa_enabled: Boolean(row.two_fa_enabled ?? 1),
    two_fa_method: (row.two_fa_method === 'AUTHENTICATOR_APP' ? 'AUTHENTICATOR_APP' : 'EMAIL_OTP') as TwoFaMethod,
    two_fa_change_status: (row.two_fa_change_status === 'pending_admin_approval'
      ? 'pending_admin_approval'
      : 'locked') as TwoFaChangeStatus,
    two_fa_requested_state: String(row.two_fa_requested_state || ''),
    two_fa_approved_by: String(row.two_fa_approved_by || ''),
    created_at: row.created_at ? String(row.created_at) : undefined,
  };
}

interface AuthPayload {
  id: number;
  email: string;
  name: string;
  role: StaffRole;
  department: string;
  status?: UserApprovalStatus;
  approved_by?: string;
  approved_at?: string;
  two_fa_enabled?: boolean;
  two_fa_method?: TwoFaMethod;
  two_fa_change_status?: TwoFaChangeStatus;
  two_fa_requested_state?: string;
  two_fa_approved_by?: string;
  created_at?: string;
  sid?: string;
  tv?: number;
  iat?: number;
}

interface AuthedRequest extends Request {
  user?: AuthPayload;
  sessionId?: string;
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
// LIVE GMAIL / SMTP EMAIL AUTOMATION (Nodemailer + SQLite email_logs)
// =============================================================================
interface SmtpRuntimeConfig {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  reason: string;
}

interface EmailDeliveryResult {
  id: number;
  delivery_status: 'SENT_SMTP' | 'SMTP_FAILED' | 'LOGGED_LOCAL';
  smtp_error: string;
  message_id: string;
  recipient_email: string;
  subject: string;
  template_type: string;
}

function cleanEnvValue(val: unknown): string {
  return String(val ?? '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function maskEmailUser(email: string): string {
  const clean = email.trim();
  if (!clean) return '';
  const atIdx = clean.indexOf('@');
  if (atIdx <= 2) return clean;
  return `${clean.slice(0, 2)}***${clean.slice(atIdx)}`;
}

function getSmtpRuntimeConfig(): SmtpRuntimeConfig {
  const rawHost = cleanEnvValue(process.env.SMTP_HOST);
  const smtpUser = cleanEnvValue(process.env.SMTP_USER);
  const rawPass = cleanEnvValue(process.env.SMTP_PASS);
  const rawPort = cleanEnvValue(process.env.SMTP_PORT);
  const rawSecure = cleanEnvValue(process.env.SMTP_SECURE).toLowerCase();
  const rawFrom = cleanEnvValue(process.env.SMTP_FROM);

  const nonRoutableHosts = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'smtp.example.com']);
  const isGmailUser = /@(gmail|googlemail)\.com$/i.test(smtpUser);

  // If SMTP_HOST is omitted but a Gmail user+pass is set, default cleanly to smtp.gmail.com
  const host =
    rawHost && !nonRoutableHosts.has(rawHost.toLowerCase())
      ? rawHost
      : isGmailUser && rawPass
        ? 'smtp.gmail.com'
        : '';

  const isGmailHost = /gmail\.com$/i.test(host);
  const port = Number(rawPort) || (rawSecure === 'true' ? 465 : 587);
  const secure = rawSecure === 'true' || port === 465;

  // Google displays 16-char App Passwords with spaces ("xxxx xxxx xxxx xxxx"); strip spaces for Gmail SMTP
  const pass = isGmailHost ? rawPass.replace(/\s+/g, '') : rawPass;
  const from =
    rawFrom && !/your-email@gmail\.com|hr@company\.com/i.test(rawFrom)
      ? rawFrom
      : smtpUser
        ? `TalentFlow MY HR <${smtpUser}>`
        : 'TalentFlow MY HR <hr@company.com>';

  if (!host) {
    return {
      configured: false,
      host: rawHost || '',
      port,
      secure,
      user: smtpUser,
      pass: '',
      from,
      reason: rawHost && nonRoutableHosts.has(rawHost.toLowerCase())
        ? `SMTP_HOST is set to "${rawHost}" which is not reachable. Set SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER, SMTP_PASS (16-char Gmail App Password), and SMTP_FROM in Settings > Secrets.`
        : 'Gmail SMTP is not configured. Set SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER, SMTP_PASS (16-char Gmail App Password), and SMTP_FROM in Settings > Secrets.',
    };
  }

  if (isGmailHost && (!smtpUser || !pass)) {
    return {
      configured: false,
      host,
      port,
      secure,
      user: smtpUser,
      pass: '',
      from,
      reason:
        'Gmail SMTP requires both SMTP_USER (your Gmail address) and SMTP_PASS (16-character Google App Password) in Settings > Secrets.',
    };
  }

  return {
    configured: true,
    host,
    port,
    secure,
    user: smtpUser,
    pass,
    from,
    reason: '',
  };
}

function getPublicSmtpStatus() {
  const cfg = getSmtpRuntimeConfig();
  return {
    configured: cfg.configured,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    from: cfg.from,
    userMasked: maskEmailUser(cfg.user),
    ...(cfg.reason ? { reason: cfg.reason } : {}),
  };
}

function createLiveMailTransporter() {
  const cfg = getSmtpRuntimeConfig();
  if (!cfg.configured) {
    return { transporter: null, config: cfg };
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure && cfg.port === 587,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    tls: {
      minVersion: 'TLSv1.2',
    },
    auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
  });

  return { transporter, config: cfg };
}

function formatSmtpError(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return String(err || 'Unknown SMTP delivery error.');
  }
  const e = err as {
    code?: string;
    responseCode?: number;
    response?: string;
    command?: string;
    message?: string;
  };
  const raw = String(e.response || e.message || 'SMTP delivery failed.').trim();
  if (e.responseCode === 535 || /535|Username and Password not accepted|BadCredentials/i.test(raw)) {
    return `Gmail SMTP authentication failed (535): ${raw}. Ensure 2-Step Verification is enabled and SMTP_PASS is a 16-character Google App Password (not your regular Gmail password).`;
  }
  if (e.code === 'ECONNREFUSED') {
    return `SMTP connection refused (${raw}). Verify SMTP_HOST (smtp.gmail.com) and SMTP_PORT (587 or 465).`;
  }
  if (e.code === 'ETIMEDOUT' || /timeout/i.test(raw)) {
    return `SMTP connection timed out (${raw}). Check SMTP_HOST, SMTP_PORT (587 or 465), and firewall rules.`;
  }
  const prefix = e.code ? `[${e.code}] ` : e.responseCode ? `[SMTP ${e.responseCode}] ` : '';
  return `${prefix}${raw}`.slice(0, 600);
}

function extractClientContext(req?: Request): { ipAddress: string; userAgent: string } {
  if (!req) {
    return { ipAddress: '', userAgent: '' };
  }
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string' && forwarded.trim()
      ? forwarded.split(',')[0].trim()
      : req.socket?.remoteAddress || req.ip || '';
  const ipAddress = String(rawIp || '').replace(/^::ffff:/, '').trim().slice(0, 100);
  const userAgent = String(req.headers['user-agent'] || '').trim().slice(0, 300);
  return { ipAddress, userAgent };
}

function formatActorDisplay(actor?: AuthPayload | null, fallbackName?: string): string {
  if (actor) {
    const name = String(actor.name || '').trim();
    const email = String(actor.email || '').trim();
    if (name && email) return `${name} (${email})`;
    return name || email || 'Staff User';
  }
  return String(fallbackName || 'System').trim() || 'System';
}

function logAudit(params: {
  req?: Request;
  actor?: AuthPayload | null;
  actorId?: number | null;
  actorName?: string;
  actorRole?: AuditActorRole;
  pageVisited: string;
  actionTaken: string;
  targetEntity?: string;
  details: string;
}) {
  const { ipAddress, userAgent } = extractClientContext(params.req);
  const timestamp = formatAuditTimestamp(new Date());
  const actorId = params.actor?.id ?? params.actorId ?? null;
  const actorName = formatActorDisplay(params.actor, params.actorName);
  const actorRole: AuditActorRole = params.actor?.role ?? params.actorRole ?? 'system';

  db.prepare(`
    INSERT INTO audit_logs (
      timestamp, actor_id, actor_name, actor_role, page_visited,
      action_taken, target_entity, details, ip_address, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    timestamp,
    actorId,
    actorName,
    actorRole,
    String(params.pageVisited || 'Pipeline Dashboard').trim().slice(0, 140),
    String(params.actionTaken || 'SYSTEM_EVENT').trim().slice(0, 100),
    String(params.targetEntity || '').trim().slice(0, 200),
    String(params.details || '').trim().slice(0, 1000),
    ipAddress,
    userAgent
  );
}

function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildAuditLogFilterSql(query: Record<string, unknown>) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const search = String(query.search || '').trim();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      `(actor_name LIKE ? OR page_visited LIKE ? OR action_taken LIKE ? OR target_entity LIKE ? OR details LIKE ? OR ip_address LIKE ? OR user_agent LIKE ?)`
    );
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }

  const actor = String(query.actor || '').trim();
  if (actor) {
    conditions.push(`actor_name LIKE ?`);
    params.push(`%${actor}%`);
  }

  const role = String(query.role || '').trim();
  if (role && ['administrator', 'manager', 'candidate_portal', 'system'].includes(role)) {
    conditions.push(`actor_role = ?`);
    params.push(role);
  }

  const pageVisited = String(query.page_visited || '').trim();
  if (pageVisited) {
    conditions.push(`page_visited = ?`);
    params.push(pageVisited);
  }

  const actionTaken = String(query.action_taken || '').trim();
  if (actionTaken) {
    conditions.push(`action_taken = ?`);
    params.push(actionTaken);
  }

  const dateFrom = String(query.date_from || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    conditions.push(`substr(timestamp, 1, 10) >= ?`);
    params.push(dateFrom);
  }

  const dateTo = String(query.date_to || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    conditions.push(`substr(timestamp, 1, 10) <= ?`);
    params.push(dateTo);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

async function dispatchEmail(params: {
  candidateId: number | null;
  candidateName: string;
  recipientEmail: string;
  templateType: string;
  subject: string;
  bodyText: string;
  stageTriggered: number;
  triggeredBy: string;
  req?: Request;
  actor?: AuthPayload | null;
  actorName?: string;
  actorRole?: AuditActorRole;
  pageVisited?: string;
  skipAuditLog?: boolean;
}): Promise<EmailDeliveryResult> {
  const { transporter, config } = createLiveMailTransporter();
  let deliveryStatus: 'SENT_SMTP' | 'SMTP_FAILED' | 'LOGGED_LOCAL' = 'SMTP_FAILED';
  let smtpError = '';
  let messageId = '';

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: config.from,
        to: params.recipientEmail,
        subject: params.subject,
        text: params.bodyText,
      });
      deliveryStatus = 'SENT_SMTP';
      messageId = String(info?.messageId || '').trim().slice(0, 200);
      console.log(
        `[Email Automation] SENT_SMTP via ${config.host}:${config.port} -> ${params.recipientEmail} (messageId=${messageId || 'n/a'})`
      );
    } catch (err) {
      deliveryStatus = 'SMTP_FAILED';
      smtpError = formatSmtpError(err);
      console.log(
        `[Email Automation] SMTP_FAILED via ${config.host}:${config.port} -> ${params.recipientEmail}: ${smtpError}`
      );
    }
  } else {
    deliveryStatus = 'SMTP_FAILED';
    smtpError = config.reason;
    console.log(
      `[Email Automation] SMTP_FAILED (not configured) -> ${params.recipientEmail}: ${smtpError}`
    );
  }

  const insertInfo = db.prepare(`
    INSERT INTO email_logs (
      candidate_id, candidate_name, recipient_email, template_type,
      subject, body_preview, stage_triggered, delivery_status, smtp_error, message_id, triggered_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.candidateId,
    params.candidateName,
    params.recipientEmail,
    params.templateType,
    params.subject,
    params.bodyText,
    params.stageTriggered,
    deliveryStatus,
    smtpError,
    messageId,
    params.triggeredBy
  );

  const logId = Number(insertInfo.lastInsertRowid);

  if (!params.skipAuditLog) {
    logAudit({
      req: params.req,
      actor: params.actor,
      actorName: params.actorName || params.triggeredBy,
      actorRole: params.actorRole || (params.actor ? params.actor.role : 'system'),
      pageVisited: params.pageVisited || 'Email Automation & Audit Trail',
      actionTaken: 'SEND_EMAIL',
      targetEntity: params.candidateName
        ? `${params.candidateName} <${params.recipientEmail}>`
        : params.recipientEmail,
      details:
        deliveryStatus === 'SENT_SMTP'
          ? `Sent "${params.templateType}" email via SMTP (${config.host}) — Subject: ${params.subject}${messageId ? ` (Message-ID: ${messageId})` : ''}`
          : `Failed to send "${params.templateType}" email via SMTP — Subject: ${params.subject}. Error: ${smtpError}`,
    });
  }

  return {
    id: logId,
    delivery_status: deliveryStatus,
    smtp_error: smtpError,
    message_id: messageId,
    recipient_email: params.recipientEmail,
    subject: params.subject,
    template_type: params.templateType,
  };
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
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
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
// UNIFIED GEMINI MULTIMODAL DOCUMENT EXTRACTION ENGINE
// =============================================================================
type ExtractableDocType =
  | 'RESUME'
  | 'APPLICATION_FORM'
  | 'DISC'
  | 'VAKAD'
  | 'SPM'
  | 'UEC'
  | 'DEGREE'
  | 'TRANSCRIPT';
type AiDocumentVerificationStatus = '' | 'VERIFIED_MATCH' | 'NAME_MISMATCH' | 'REVIEW_NEEDED' | 'AI_FAILED';

const EXTRACTABLE_DOC_TYPES = new Set<ExtractableDocType>([
  'RESUME',
  'APPLICATION_FORM',
  'DISC',
  'VAKAD',
  'SPM',
  'UEC',
  'DEGREE',
  'TRANSCRIPT',
]);

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const SUPPORTED_INLINE_DOCUMENT_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

function isExtractableDocType(docType: string): docType is ExtractableDocType {
  return EXTRACTABLE_DOC_TYPES.has(docType as ExtractableDocType);
}

function getGeminiModelCandidates(): string[] {
  const configuredModel = String(process.env.GEMINI_MODEL || '')
    .replace(/^["']|["']$/g, '')
    .trim();
  // Skip non-generateContent / stalling alias gemini-3.8-flash if left in env
  const validConfigured =
    configuredModel && !/^gemini-3\.8-flash$/i.test(configuredModel) ? configuredModel : '';

  return Array.from(
    new Set([
      ...(validConfigured ? [validConfigured] : []),
      'gemini-3.1-flash-lite',
      'gemini-4-hydrogen',
    ])
  );
}

function getPerAttemptTimeoutMs(modelName: string): number {
  if (modelName === 'gemini-3.1-flash-lite') {
    return 35_000;
  }
  return 45_000;
}

function formatGeminiError(err: unknown): { statusCode: number; userMessage: string } {
  const rawMessage = err instanceof Error ? err.message : 'Failed to analyze document with Gemini AI.';
  if (/timed out/i.test(rawMessage)) {
    return {
      statusCode: 504,
      userMessage: 'Gemini AI document analysis timed out. Please retry with Re-Analyze with Gemini AI.',
    };
  }
  if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(rawMessage)) {
    return {
      statusCode: 500,
      userMessage:
        'Invalid or unauthorized GEMINI_API_KEY on the server. Please verify your Gemini API key in Settings > Secrets.',
    };
  }
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(rawMessage)) {
    return {
      statusCode: 429,
      userMessage: 'Gemini API rate limit or quota reached. Please wait a moment and try again.',
    };
  }
  if (/GEMINI_API_KEY is not configured/i.test(rawMessage)) {
    return { statusCode: 500, userMessage: rawMessage };
  }
  return { statusCode: 500, userMessage: rawMessage };
}

function buildDocumentPromptAndSchema(params: {
  docType: ExtractableDocType;
  candidateName?: string;
  position?: string;
  department?: string;
  rubric?: string;
}) {
  const { docType, candidateName = '', position = 'General Role', department = 'HR', rubric = '' } = params;
  const candidateContext = candidateName
    ? `Expected candidate full name on file: "${candidateName}". Compare the name printed on the document carefully (accounting for Malaysian naming conventions such as bin/binti/a/l/a/p, Chinese surname order, initials, or minor casing differences).`
    : 'No reference candidate name was provided; set name_matches_candidate to true if a clear candidate name is printed on the document, otherwise false.';

  if (docType === 'RESUME') {
    return {
      prompt: [
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
        .join('\n'),
      responseSchema: {
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
      },
    };
  }

  if (docType === 'APPLICATION_FORM') {
    return {
      prompt: [
        'You are a Malaysian enterprise HR recruitment specialist.',
        'Inspect this uploaded document expecting a completed Employment Application Form.',
        candidateContext,
        'Return strictly valid flat JSON with these exact keys:',
        '- document_detected: Set to "Employment Application Form" if this is an employment application form, otherwise state concisely what document was actually detected.',
        '- candidate_name_on_doc: Exact candidate full name written on the form (empty string if not visible).',
        '- name_matches_candidate: Boolean true only if candidate_name_on_doc matches the expected candidate name.',
        '- expected_salary_myr: Candidate expected monthly salary in MYR as written on the form (e.g. "RM 4,500" or "5000"; empty string if not stated).',
        '- notice_period: Candidate current notice period (e.g. "1 month", "2 months", "Immediate"; empty string if not stated).',
        '- availability_date: Earliest available start date if written on the form (e.g. "2026-06-01" or "Immediately"; empty string if not stated).',
        '- verification_notes: Concise HR verification notes covering form completeness, signature/date presence, key declarations, and any discrepancies or missing sections.',
      ].join('\n'),
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          document_detected: { type: Type.STRING },
          candidate_name_on_doc: { type: Type.STRING },
          name_matches_candidate: { type: Type.BOOLEAN },
          expected_salary_myr: { type: Type.STRING },
          notice_period: { type: Type.STRING },
          availability_date: { type: Type.STRING },
          verification_notes: { type: Type.STRING },
        },
        required: [
          'document_detected',
          'candidate_name_on_doc',
          'name_matches_candidate',
          'expected_salary_myr',
          'notice_period',
          'availability_date',
          'verification_notes',
        ],
      },
    };
  }

  if (docType === 'DISC') {
    return {
      prompt: [
        'You are a Malaysian enterprise HR assessment specialist.',
        'Inspect this uploaded document expecting a DISC Personality Assessment Report or completed DISC Answer Sheet.',
        candidateContext,
        'Return strictly valid flat JSON with these exact keys:',
        '- document_detected: Set to "DISC Personality Assessment" if this is a DISC assessment sheet/report, otherwise state concisely what document was actually detected.',
        '- candidate_name_on_doc: Exact candidate name printed on the DISC report/sheet (empty string if not visible).',
        '- name_matches_candidate: Boolean true only if candidate_name_on_doc matches the expected candidate name.',
        '- disc_profile_type: Dominant DISC profile combination (e.g. "High D / C", "S/C — Steady Conscientious", "D/I", or scores like "D: 28, I: 18, S: 22, C: 32"; empty string if unreadable).',
        '- key_traits_summary: Concise summary of work style, communication strengths, and behavioral traits indicated by the DISC results.',
        '- verification_notes: Concise HR verification notes covering assessment completeness, legibility, and any discrepancies.',
      ].join('\n'),
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          document_detected: { type: Type.STRING },
          candidate_name_on_doc: { type: Type.STRING },
          name_matches_candidate: { type: Type.BOOLEAN },
          disc_profile_type: { type: Type.STRING },
          key_traits_summary: { type: Type.STRING },
          verification_notes: { type: Type.STRING },
        },
        required: [
          'document_detected',
          'candidate_name_on_doc',
          'name_matches_candidate',
          'disc_profile_type',
          'key_traits_summary',
          'verification_notes',
        ],
      },
    };
  }

  if (docType === 'VAKAD') {
    return {
      prompt: [
        'You are a Malaysian enterprise HR assessment specialist.',
        'Inspect this uploaded document expecting a VAKAD (Visual, Auditory, Kinesthetic, Auditory Digital) Assessment Report or Sheet.',
        candidateContext,
        'Return strictly valid flat JSON with these exact keys:',
        '- document_detected: Set to "VAKAD Assessment" if this is a VAKAD assessment sheet/report, otherwise state concisely what document was actually detected.',
        '- candidate_name_on_doc: Exact candidate name printed on the VAKAD report/sheet (empty string if not visible).',
        '- name_matches_candidate: Boolean true only if candidate_name_on_doc matches the expected candidate name.',
        '- vakad_dominant_style: Dominant representational/learning style detected among Visual, Auditory, Kinesthetic, and/or Auditory Digital (e.g. "Visual & Auditory Digital" or "Kinesthetic"; empty string if unreadable).',
        '- scores_summary: Breakdown of VAKAD scores or percentages if shown (e.g. "Visual: 34, Auditory: 22, Kinesthetic: 26, Auditory Digital: 38"; empty string if not shown).',
        '- verification_notes: Concise HR verification notes covering assessment completeness, legibility, and any discrepancies.',
      ].join('\n'),
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          document_detected: { type: Type.STRING },
          candidate_name_on_doc: { type: Type.STRING },
          name_matches_candidate: { type: Type.BOOLEAN },
          vakad_dominant_style: { type: Type.STRING },
          scores_summary: { type: Type.STRING },
          verification_notes: { type: Type.STRING },
        },
        required: [
          'document_detected',
          'candidate_name_on_doc',
          'name_matches_candidate',
          'vakad_dominant_style',
          'scores_summary',
          'verification_notes',
        ],
      },
    };
  }

  if (docType === 'SPM') {
    return {
      prompt: [
        'You are a Malaysian HR academic credential verification specialist.',
        'Inspect this uploaded document expecting a Malaysian SPM (Sijil Pelajaran Malaysia) Certificate or Examination Result Slip.',
        candidateContext,
        'Return strictly valid flat JSON with these exact keys:',
        '- document_detected: Set to "SPM Certificate / Slip" if this is an SPM certificate/slip, otherwise state concisely what document was actually detected (e.g. "Unrelated Document", "Blurry / Unreadable Scan", "University Transcript").',
        '- candidate_name_on_doc: Exact candidate name printed on the document (empty string if not visible).',
        '- name_matches_candidate: Boolean true only if candidate_name_on_doc matches the expected candidate name.',
        '- exam_year: 4-digit examination year (e.g. "2018") or empty string if not visible.',
        '- school_name: Secondary school or examination centre name (empty string if not visible).',
        '- grades_summary: Concise comma-separated summary of subjects and grades (e.g. "BM: A, English: A-, Maths: A+, Sejarah: A, Add Maths: B+").',
        '- total_credits: Summary of total distinctions/credits/passes (e.g. "9 Credits (6A, 3B)" or numeric credit count).',
        '- verification_notes: Concise HR verification notes covering legibility, document authenticity indicators, BM/Sejarah pass status, and any discrepancies or mismatches.',
      ].join('\n'),
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          document_detected: { type: Type.STRING },
          candidate_name_on_doc: { type: Type.STRING },
          name_matches_candidate: { type: Type.BOOLEAN },
          exam_year: { type: Type.STRING },
          school_name: { type: Type.STRING },
          grades_summary: { type: Type.STRING },
          total_credits: { type: Type.STRING },
          verification_notes: { type: Type.STRING },
        },
        required: [
          'document_detected',
          'candidate_name_on_doc',
          'name_matches_candidate',
          'exam_year',
          'school_name',
          'grades_summary',
          'total_credits',
          'verification_notes',
        ],
      },
    };
  }

  if (docType === 'UEC') {
    return {
      prompt: [
        'You are a Malaysian HR academic credential verification specialist.',
        'Inspect this uploaded document expecting a Malaysian UEC (Unified Examination Certificate / Dong Zong) Certificate or Transcript.',
        candidateContext,
        'Return strictly valid flat JSON with these exact keys:',
        '- document_detected: Set to "UEC Certificate / Transcript" if this is a UEC document, otherwise state concisely what document was actually detected.',
        '- candidate_name_on_doc: Exact candidate name printed on the document (empty string if not visible).',
        '- name_matches_candidate: Boolean true only if candidate_name_on_doc matches the expected candidate name.',
        '- exam_year: 4-digit examination year (e.g. "2019") or empty string if not visible.',
        '- school_name: Independent Chinese High School name (empty string if not visible).',
        '- grades_summary: Concise comma-separated summary of UEC subjects and grades (e.g. "Chinese: A1, English: A2, Mathematics: A1, Accounting: B3").',
        '- verification_notes: Concise HR verification notes covering legibility, Senior/Junior UEC level, and any discrepancies or mismatches.',
      ].join('\n'),
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          document_detected: { type: Type.STRING },
          candidate_name_on_doc: { type: Type.STRING },
          name_matches_candidate: { type: Type.BOOLEAN },
          exam_year: { type: Type.STRING },
          school_name: { type: Type.STRING },
          grades_summary: { type: Type.STRING },
          verification_notes: { type: Type.STRING },
        },
        required: [
          'document_detected',
          'candidate_name_on_doc',
          'name_matches_candidate',
          'exam_year',
          'school_name',
          'grades_summary',
          'verification_notes',
        ],
      },
    };
  }

  if (docType === 'DEGREE') {
    return {
      prompt: [
        'You are a Malaysian HR academic credential verification specialist.',
        'Inspect this uploaded document expecting a University Degree Certificate (scroll or official convocation certificate).',
        candidateContext,
        'Return strictly valid flat JSON with these exact keys:',
        '- document_detected: Set to "University Degree Certificate" if this is a university degree certificate/scroll, otherwise state concisely what document was actually detected.',
        '- candidate_name_on_doc: Exact graduate name printed on the certificate (empty string if not visible).',
        '- name_matches_candidate: Boolean true only if candidate_name_on_doc matches the expected candidate name.',
        '- university_name: Awarding university or institution name (empty string if not visible).',
        '- degree_title: Full degree title (e.g. "Bachelor of Computer Science (Hons) in Software Engineering").',
        '- honours_class: Honours classification or distinction if printed (e.g. "First Class Honours", "Second Class Upper (2:1)", or "Not Stated").',
        '- graduation_year: 4-digit conferral / graduation year (empty string if not visible).',
        '- verification_notes: Concise HR verification notes covering legibility, seal/signatory visibility, and any discrepancies or mismatches.',
      ].join('\n'),
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          document_detected: { type: Type.STRING },
          candidate_name_on_doc: { type: Type.STRING },
          name_matches_candidate: { type: Type.BOOLEAN },
          university_name: { type: Type.STRING },
          degree_title: { type: Type.STRING },
          honours_class: { type: Type.STRING },
          graduation_year: { type: Type.STRING },
          verification_notes: { type: Type.STRING },
        },
        required: [
          'document_detected',
          'candidate_name_on_doc',
          'name_matches_candidate',
          'university_name',
          'degree_title',
          'honours_class',
          'graduation_year',
          'verification_notes',
        ],
      },
    };
  }

  // TRANSCRIPT
  return {
    prompt: [
      'You are a Malaysian HR academic credential verification specialist.',
      'Inspect this uploaded document expecting a University Academic Transcript showing course grades and CGPA.',
      candidateContext,
      'Return strictly valid flat JSON with these exact keys:',
      '- document_detected: Set to "University Academic Transcript" if this is an academic transcript, otherwise state concisely what document was actually detected.',
      '- candidate_name_on_doc: Exact student name printed on the transcript (empty string if not visible).',
      '- name_matches_candidate: Boolean true only if candidate_name_on_doc matches the expected candidate name.',
      '- university_name: University or college name (empty string if not visible).',
      '- program_name: Degree / diploma program name (empty string if not visible).',
      '- cgpa: Cumulative GPA as printed (e.g. "3.78 / 4.00" or "3.65"; empty string if not visible).',
      '- semesters_completed: Number or summary of semesters/trimesters completed (e.g. "8 Semesters (Complete)" or "6 Semesters").',
      '- verification_notes: Concise HR verification notes covering transcript completeness, legibility, standing/dean list, and any discrepancies or mismatches.',
    ].join('\n'),
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        document_detected: { type: Type.STRING },
        candidate_name_on_doc: { type: Type.STRING },
        name_matches_candidate: { type: Type.BOOLEAN },
        university_name: { type: Type.STRING },
        program_name: { type: Type.STRING },
        cgpa: { type: Type.STRING },
        semesters_completed: { type: Type.STRING },
        verification_notes: { type: Type.STRING },
      },
      required: [
        'document_detected',
        'candidate_name_on_doc',
        'name_matches_candidate',
        'university_name',
        'program_name',
        'cgpa',
        'semesters_completed',
        'verification_notes',
      ],
    },
  };
}

function normalizeAcademicExtraction(
  docType: Exclude<ExtractableDocType, 'RESUME'>,
  parsed: Record<string, unknown>
): { data: Record<string, unknown>; status: AiDocumentVerificationStatus; extractedFieldCount: number } {
  const defaultLabels: Record<Exclude<ExtractableDocType, 'RESUME'>, string> = {
    APPLICATION_FORM: 'Employment Application Form',
    DISC: 'DISC Personality Assessment',
    VAKAD: 'VAKAD Assessment',
    SPM: 'SPM Certificate / Slip',
    UEC: 'UEC Certificate / Transcript',
    DEGREE: 'University Degree Certificate',
    TRANSCRIPT: 'University Academic Transcript',
  };

  const documentDetected = String(parsed.document_detected ?? '').trim().slice(0, 140) || defaultLabels[docType];
  const candidateNameOnDoc = String(parsed.candidate_name_on_doc ?? '').trim().slice(0, 140);
  const nameMatchesCandidate = Boolean(parsed.name_matches_candidate);
  const verificationNotes = String(parsed.verification_notes ?? '').trim().slice(0, 800);

  let data: Record<string, unknown>;
  let keyValues: string[] = [];

  if (docType === 'APPLICATION_FORM') {
    const expectedSalaryMyr = String(parsed.expected_salary_myr ?? '').trim().slice(0, 80);
    const noticePeriod = String(parsed.notice_period ?? '').trim().slice(0, 80);
    const availabilityDate = String(parsed.availability_date ?? '').trim().slice(0, 80);
    data = {
      document_detected: documentDetected,
      candidate_name_on_doc: candidateNameOnDoc,
      name_matches_candidate: nameMatchesCandidate,
      expected_salary_myr: expectedSalaryMyr,
      notice_period: noticePeriod,
      availability_date: availabilityDate,
      verification_notes: verificationNotes,
    };
    keyValues = [candidateNameOnDoc, expectedSalaryMyr, noticePeriod, availabilityDate, verificationNotes];
  } else if (docType === 'DISC') {
    const discProfileType = String(parsed.disc_profile_type ?? '').trim().slice(0, 160);
    const keyTraitsSummary = String(parsed.key_traits_summary ?? '').trim().slice(0, 600);
    data = {
      document_detected: documentDetected,
      candidate_name_on_doc: candidateNameOnDoc,
      name_matches_candidate: nameMatchesCandidate,
      disc_profile_type: discProfileType,
      key_traits_summary: keyTraitsSummary,
      verification_notes: verificationNotes,
    };
    keyValues = [candidateNameOnDoc, discProfileType, keyTraitsSummary];
  } else if (docType === 'VAKAD') {
    const vakadDominantStyle = String(parsed.vakad_dominant_style ?? '').trim().slice(0, 160);
    const scoresSummary = String(parsed.scores_summary ?? '').trim().slice(0, 400);
    data = {
      document_detected: documentDetected,
      candidate_name_on_doc: candidateNameOnDoc,
      name_matches_candidate: nameMatchesCandidate,
      vakad_dominant_style: vakadDominantStyle,
      scores_summary: scoresSummary,
      verification_notes: verificationNotes,
    };
    keyValues = [candidateNameOnDoc, vakadDominantStyle, scoresSummary];
  } else if (docType === 'SPM') {
    const examYear = String(parsed.exam_year ?? '').trim().slice(0, 20);
    const schoolName = String(parsed.school_name ?? '').trim().slice(0, 200);
    const gradesSummary = String(parsed.grades_summary ?? '').trim().slice(0, 600);
    const totalCredits = String(parsed.total_credits ?? '').trim().slice(0, 100);
    data = {
      document_detected: documentDetected,
      candidate_name_on_doc: candidateNameOnDoc,
      name_matches_candidate: nameMatchesCandidate,
      exam_year: examYear,
      school_name: schoolName,
      grades_summary: gradesSummary,
      total_credits: totalCredits,
      verification_notes: verificationNotes,
    };
    keyValues = [candidateNameOnDoc, examYear, schoolName, gradesSummary, totalCredits];
  } else if (docType === 'UEC') {
    const examYear = String(parsed.exam_year ?? '').trim().slice(0, 20);
    const schoolName = String(parsed.school_name ?? '').trim().slice(0, 200);
    const gradesSummary = String(parsed.grades_summary ?? '').trim().slice(0, 600);
    data = {
      document_detected: documentDetected,
      candidate_name_on_doc: candidateNameOnDoc,
      name_matches_candidate: nameMatchesCandidate,
      exam_year: examYear,
      school_name: schoolName,
      grades_summary: gradesSummary,
      verification_notes: verificationNotes,
    };
    keyValues = [candidateNameOnDoc, examYear, schoolName, gradesSummary];
  } else if (docType === 'DEGREE') {
    const universityName = String(parsed.university_name ?? '').trim().slice(0, 200);
    const degreeTitle = String(parsed.degree_title ?? '').trim().slice(0, 240);
    const honoursClass = String(parsed.honours_class ?? '').trim().slice(0, 120);
    const graduationYear = String(parsed.graduation_year ?? '').trim().slice(0, 20);
    data = {
      document_detected: documentDetected,
      candidate_name_on_doc: candidateNameOnDoc,
      name_matches_candidate: nameMatchesCandidate,
      university_name: universityName,
      degree_title: degreeTitle,
      honours_class: honoursClass,
      graduation_year: graduationYear,
      verification_notes: verificationNotes,
    };
    keyValues = [candidateNameOnDoc, universityName, degreeTitle, honoursClass, graduationYear];
  } else {
    const universityName = String(parsed.university_name ?? '').trim().slice(0, 200);
    const programName = String(parsed.program_name ?? '').trim().slice(0, 240);
    const cgpa = String(parsed.cgpa ?? '').trim().slice(0, 40);
    const semestersCompleted = String(parsed.semesters_completed ?? '').trim().slice(0, 80);
    data = {
      document_detected: documentDetected,
      candidate_name_on_doc: candidateNameOnDoc,
      name_matches_candidate: nameMatchesCandidate,
      university_name: universityName,
      program_name: programName,
      cgpa,
      semesters_completed: semestersCompleted,
      verification_notes: verificationNotes,
    };
    keyValues = [candidateNameOnDoc, universityName, programName, cgpa, semestersCompleted];
  }

  const extractedFieldCount = keyValues.filter(Boolean).length;
  const looksUnrelated = /unrelated|unreadable|blurry|not a |wrong document|blank|invoice|receipt/i.test(
    documentDetected
  );

  let status: AiDocumentVerificationStatus;
  if (candidateNameOnDoc && !nameMatchesCandidate) {
    status = 'NAME_MISMATCH';
  } else if (looksUnrelated || extractedFieldCount < 2 || !candidateNameOnDoc) {
    status = 'REVIEW_NEEDED';
  } else if (nameMatchesCandidate) {
    status = 'VERIFIED_MATCH';
  } else {
    status = 'REVIEW_NEEDED';
  }

  return { data, status, extractedFieldCount };
}

async function extractDocumentWithGemini(params: {
  filePath?: string;
  fileBuffer?: Buffer;
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
  rawText?: string;
  docType: ExtractableDocType;
  candidateName?: string;
  position?: string;
  department?: string;
  rubric?: string;
}): Promise<{
  data: Record<string, unknown>;
  status: AiDocumentVerificationStatus;
  modelUsed: string;
  extractedFieldCount: number;
}> {
  let cleanText = sanitizeResumeText(params.rawText);
  let inlineFile: { mimeType: string; data: string } | null = null;
  const fileName = params.fileName || (params.filePath ? path.basename(params.filePath) : '');

  let fileBuffer: Buffer | null = null;
  if (params.fileBuffer && params.fileBuffer.length > 0) {
    fileBuffer = params.fileBuffer;
  } else if (params.filePath && fs.existsSync(params.filePath)) {
    fileBuffer = fs.readFileSync(params.filePath);
  }

  if (fileBuffer) {
    if (fileBuffer.length === 0) {
      throw new Error(`Uploaded file "${fileName || params.docType}" appears to be empty (0 bytes).`);
    }
    const resolvedMime = inferResumeMimeType(params.mimeType || '', fileName);
    if (resolvedMime === 'text/plain') {
      const decodedText = sanitizeResumeText(fileBuffer.toString('utf8'));
      if (decodedText) {
        cleanText = cleanText ? `${cleanText}\n\n${decodedText}` : decodedText;
      }
    } else if (resolvedMime === DOCX_MIME) {
      const docxExtracted = await mammoth.extractRawText({ buffer: fileBuffer });
      const decodedText = sanitizeResumeText(docxExtracted.value);
      if (!decodedText) {
        throw new Error(`Could not extract readable text from DOCX file "${fileName || params.docType}".`);
      }
      cleanText = cleanText ? `${cleanText}\n\n${decodedText}` : decodedText;
    } else if (SUPPORTED_INLINE_DOCUMENT_MIMES.has(resolvedMime)) {
      inlineFile = {
        mimeType: resolvedMime,
        data: fileBuffer.toString('base64'),
      };
    } else {
      throw new Error(
        `Unsupported file format (${fileName || resolvedMime}). Please upload a PDF, PNG, JPG, WEBP, DOCX, or TXT document.`
      );
    }
  } else if (params.fileBase64) {
    const cleanBase64 = params.fileBase64.includes(',')
      ? params.fileBase64.split(',')[1]
      : params.fileBase64;
    const resolvedMime = inferResumeMimeType(params.mimeType || '', fileName);
    if (resolvedMime === 'text/plain') {
      const decodedText = sanitizeResumeText(Buffer.from(cleanBase64, 'base64').toString('utf8'));
      if (decodedText) {
        cleanText = cleanText ? `${cleanText}\n\n${decodedText}` : decodedText;
      }
    } else if (resolvedMime === DOCX_MIME) {
      const docxExtracted = await mammoth.extractRawText({ buffer: Buffer.from(cleanBase64, 'base64') });
      const decodedText = sanitizeResumeText(docxExtracted.value);
      if (!decodedText) {
        throw new Error('Could not extract readable text from the uploaded DOCX file.');
      }
      cleanText = cleanText ? `${cleanText}\n\n${decodedText}` : decodedText;
    } else if (SUPPORTED_INLINE_DOCUMENT_MIMES.has(resolvedMime)) {
      inlineFile = {
        mimeType: resolvedMime,
        data: cleanBase64,
      };
    } else {
      throw new Error(
        'Unsupported document file type. Please upload a PDF, PNG, JPG, WEBP, DOCX, or TXT file.'
      );
    }
  }

  if (!inlineFile && !cleanText) {
    throw new Error(
      params.docType === 'RESUME'
        ? 'No resume file or text provided.'
        : `No readable ${params.docType} document file provided.`
    );
  }

  const ai = getGeminiClient();
  const modelCandidates = getGeminiModelCandidates();
  const { prompt, responseSchema } = buildDocumentPromptAndSchema({
    docType: params.docType,
    candidateName: params.candidateName,
    position: params.position,
    department: params.department,
    rubric: params.rubric,
  });

  console.log(`[Gemini Document Engine] Request (${params.docType}):`, {
    models: modelCandidates,
    hasInlineFile: Boolean(inlineFile),
    inlineMimeType: inlineFile?.mimeType || null,
    inlineBase64Length: inlineFile?.data.length || 0,
    textLength: cleanText.length,
    fileName: fileName || null,
    candidateName: params.candidateName || null,
  });

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

  if (cleanText) {
    parts.push({
      text: `${params.docType === 'RESUME' ? 'Resume Content' : `${params.docType} Document Text`}:\n${cleanText.slice(0, 60_000)}`,
    });
  }

  let responseText = '';
  let modelUsed = modelCandidates[0] || 'gemini-3.1-flash-lite';
  let lastError: unknown = null;

  for (let i = 0; i < modelCandidates.length; i++) {
    const modelName = modelCandidates[i];
    const hasNextFallback = i < modelCandidates.length - 1;
    const attemptTimeoutMs = getPerAttemptTimeoutMs(modelName);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const abortController = new AbortController();
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        abortController.abort();
        reject(new Error(`Model ${modelName} timed out after ${attemptTimeoutMs / 1000}s.`));
      }, attemptTimeoutMs);
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
              'Return strictly valid flat JSON matching the provided schema. Never wrap the JSON inside an extra key or array. Never fabricate personal details, grades, or qualifications that are not visibly present in the document.',
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
        modelUsed = modelName;
        console.log(`[Gemini Document Engine] Succeeded (${params.docType}) with model=${modelName}`);
        break;
      }
      lastError = new Error(`Model ${modelName} returned an empty response.`);
    } catch (attemptErr: unknown) {
      lastError = attemptErr;
      const errMsg = attemptErr instanceof Error ? attemptErr.message : String(attemptErr);
      if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED|429|RESOURCE_EXHAUSTED/i.test(errMsg)) {
        throw attemptErr;
      }
      if (hasNextFallback) {
        console.log(
          `[Gemini Document Engine] Switching to fallback after ${modelName} (${params.docType}): ${errMsg}`
        );
      } else {
        console.error(`[Gemini Document Engine] Final model ${modelName} failed (${params.docType}):`, errMsg);
      }
    }
  }

  console.log(`Gemini raw extraction (${params.docType}):`, responseText);

  if (!responseText) {
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error(
      inlineFile
        ? `Could not read text from the uploaded ${params.docType} document. Please check that the file is legible and not password-protected.`
        : 'Could not extract details from the provided document text. Please try again.'
    );
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
      throw new Error('Gemini AI returned malformed JSON. Please retry analysis.');
    }
    try {
      rawParsed = JSON.parse(objMatch[0]);
    } catch {
      throw new Error('Gemini AI returned malformed JSON. Please retry analysis.');
    }
  }

  const unwrapped = Array.isArray(rawParsed)
    ? ((rawParsed[0] as Record<string, unknown> | undefined) ?? {})
    : (rawParsed as Record<string, unknown>);
  const parsed =
    (unwrapped.extracted as Record<string, unknown> | undefined) ||
    (unwrapped.data as Record<string, unknown> | undefined) ||
    (unwrapped.result as Record<string, unknown> | undefined) ||
    (unwrapped.candidate as Record<string, unknown> | undefined) ||
    unwrapped;

  if (params.docType === 'RESUME') {
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
      /\buec\b/i.test(`${education} ${cleanText}`);

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

    const resumeData = {
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
    };

    const status: AiDocumentVerificationStatus =
      extractedFieldCount >= 3 ? 'VERIFIED_MATCH' : extractedFieldCount > 0 ? 'REVIEW_NEEDED' : 'AI_FAILED';

    return { data: resumeData, status, modelUsed, extractedFieldCount };
  }

  const normalized = normalizeAcademicExtraction(params.docType, parsed);
  return {
    data: normalized.data,
    status: normalized.status,
    modelUsed,
    extractedFieldCount: normalized.extractedFieldCount,
  };
}

async function runAndPersistDocumentExtraction(params: {
  req?: Request;
  actor?: AuthPayload | null;
  actorName?: string;
  actorRole?: AuditActorRole;
  pageVisited: string;
  candidateId: number;
  candidateCode: string;
  candidateName: string;
  position?: string;
  department?: string;
  docType: ExtractableDocType;
  filePath: string;
  fileName: string;
  mimeType?: string;
  isReanalysis?: boolean;
}): Promise<{
  status: AiDocumentVerificationStatus;
  data: Record<string, unknown>;
  modelUsed?: string;
  error?: string;
}> {
  const resolvedDiskPath = path.isAbsolute(params.filePath)
    ? params.filePath
    : path.join(UPLOADS_ROOT, path.basename(params.filePath));

  try {
    const result = await extractDocumentWithGemini({
      filePath: resolvedDiskPath,
      fileName: params.fileName,
      mimeType: params.mimeType,
      docType: params.docType,
      candidateName: params.candidateName,
      position: params.position,
      department: params.department,
    });

    const payloadWithMeta: Record<string, unknown> = {
      ...result.data,
      model_used: result.modelUsed,
      extracted_at: new Date().toISOString(),
    };

    // Never auto-set verified = 1; HR manual sign-off remains required
    db.prepare(`
      UPDATE candidate_documents
      SET ai_extracted_json = ?, ai_verified_status = ?
      WHERE candidate_id = ? AND doc_type = ?
    `).run(JSON.stringify(payloadWithMeta), result.status, params.candidateId, params.docType);

    if (params.docType === 'RESUME') {
      const score = Number(result.data.ai_score || 0);
      const summary = String(result.data.ai_summary || '').trim();
      const candRow = db
        .prepare('SELECT ai_score, ai_summary FROM candidates WHERE id = ?')
        .get(params.candidateId) as { ai_score: number; ai_summary: string } | undefined;
      if (
        candRow &&
        (params.isReanalysis || (!candRow.ai_summary && summary) || (candRow.ai_score === 0 && score > 0))
      ) {
        db.prepare(`
          UPDATE candidates
          SET ai_score = ?, ai_summary = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(score || candRow.ai_score, summary || candRow.ai_summary, params.candidateId);
      }
    } else if (params.docType === 'DISC') {
      const extractedDisc = String(result.data.disc_profile_type || '').trim();
      if (extractedDisc) {
        const candRow = db
          .prepare('SELECT disc_profile FROM candidates WHERE id = ?')
          .get(params.candidateId) as { disc_profile: string } | undefined;
        if (candRow && (!candRow.disc_profile || params.isReanalysis)) {
          db.prepare(`UPDATE candidates SET disc_profile = ?, updated_at = datetime('now') WHERE id = ?`).run(
            extractedDisc,
            params.candidateId
          );
        }
      }
    }

    const detected = String(result.data.document_detected || params.docType);
    const summaryHighlight =
      params.docType === 'RESUME'
        ? `Job-Fit Score: ${result.data.ai_score ?? 0}%`
        : `Detected: "${detected}", Name Match: ${result.data.name_matches_candidate ? 'YES' : 'NO'}, Status: ${result.status}`;

    logAudit({
      req: params.req,
      actor: params.actor,
      actorName: params.actorName,
      actorRole: params.actorRole,
      pageVisited: params.pageVisited,
      actionTaken: 'AI_DOCUMENT_EXTRACTION',
      targetEntity: `${params.candidateName} (${params.candidateCode}) — ${params.docType}`,
      details: `${params.isReanalysis ? 'Re-analyzed' : 'Auto-scanned'} ${params.docType} (${params.fileName}) via Gemini (${result.modelUsed}). ${summaryHighlight}.`,
    });

    return {
      status: result.status,
      data: payloadWithMeta,
      modelUsed: result.modelUsed,
    };
  } catch (err: unknown) {
    const { userMessage } = formatGeminiError(err);
    const errorPayload = {
      error: userMessage,
      extracted_at: new Date().toISOString(),
    };

    db.prepare(`
      UPDATE candidate_documents
      SET ai_extracted_json = ?, ai_verified_status = 'AI_FAILED'
      WHERE candidate_id = ? AND doc_type = ?
    `).run(JSON.stringify(errorPayload), params.candidateId, params.docType);

    logAudit({
      req: params.req,
      actor: params.actor,
      actorName: params.actorName,
      actorRole: params.actorRole,
      pageVisited: params.pageVisited,
      actionTaken: 'AI_DOCUMENT_EXTRACTION',
      targetEntity: `${params.candidateName} (${params.candidateCode}) — ${params.docType}`,
      details: `Gemini AI ${params.isReanalysis ? 're-analysis' : 'auto-scan'} failed for ${params.docType} (${params.fileName}): ${userMessage}`,
    });

    return {
      status: 'AI_FAILED',
      data: errorPayload,
      error: userMessage,
    };
  }
}

// =============================================================================
// AUTH, SESSION IDLE ENFORCEMENT (10 MIN) & RBAC MIDDLEWARE
// =============================================================================
interface ActiveSessionRecord {
  userId: number;
  lastActiveMs: number;
  revoked: boolean;
  idleAuditLogged: boolean;
}

const sessionActivityMap = new Map<string, ActiveSessionRecord>();
const recentIdleAuditByUser = new Map<number, number>();

function registerActiveSession(userId: number): string {
  const sid = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  sessionActivityMap.set(sid, {
    userId,
    lastActiveMs: now,
    revoked: false,
    idleAuditLogged: false,
  });
  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(new Date(now).toISOString(), userId);
  return sid;
}

function recordIdleAutoLogoutOnce(params: {
  req: Request;
  user: AuthPayload;
  sid?: string;
  pageVisited: string;
  details: string;
}) {
  const now = Date.now();
  if (params.sid) {
    const existing = sessionActivityMap.get(params.sid);
    if (existing?.idleAuditLogged) return;
    sessionActivityMap.set(params.sid, {
      userId: params.user.id,
      lastActiveMs: existing?.lastActiveMs ?? now,
      revoked: true,
      idleAuditLogged: true,
    });
  } else {
    const prev = recentIdleAuditByUser.get(params.user.id) || 0;
    if (now - prev < 10_000) return;
  }
  recentIdleAuditByUser.set(params.user.id, now);

  logAudit({
    req: params.req,
    actor: params.user,
    pageVisited: params.pageVisited,
    actionTaken: 'AUTO_LOGOUT_IDLE',
    targetEntity: `${params.user.name} (${params.user.email})`,
    details: params.details,
  });
}

function verifyJwtToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

function validateSessionAndIdle(
  decoded: AuthPayload,
  req: Request,
  touchActivity: boolean
):
  | {
      ok: true;
      user: AuthPayload;
    }
  | {
      ok: false;
      statusCode: number;
      error: string;
      code?: string;
    } {
  const dbUser = db
    .prepare(
      `SELECT ${PUBLIC_USER_SELECT}, last_active_at, token_version FROM users WHERE id = ?`
    )
    .get(decoded.id) as
    | (Record<string, unknown> & {
        id: number;
        name: string;
        email: string;
        role: StaffRole;
        department: string;
        status: UserApprovalStatus;
        last_active_at?: string;
        token_version?: number;
      })
    | undefined;

  if (!dbUser) {
    return { ok: false, statusCode: 401, error: 'Account no longer exists.' };
  }

  if (dbUser.status === 'pending') {
    return {
      ok: false,
      statusCode: 403,
      error: 'Your account is pending approval by a System Administrator.',
      code: 'PENDING_APPROVAL',
    };
  }

  if (dbUser.status !== 'approved') {
    return {
      ok: false,
      statusCode: 403,
      error: 'Your account access has been revoked or rejected. Contact a System Administrator.',
      code: 'ACCOUNT_REJECTED',
    };
  }

  const tokenTv = typeof decoded.tv === 'number' ? decoded.tv : 1;
  const currentTv = Number(dbUser.token_version ?? 1);
  if (tokenTv !== currentTv) {
    return {
      ok: false,
      statusCode: 401,
      error: 'All active sessions were revoked by a System Administrator. Please sign in again.',
      code: 'SESSION_REVOKED',
    };
  }

  const now = Date.now();
  const sid = typeof decoded.sid === 'string' ? decoded.sid : '';
  const memSession = sid ? sessionActivityMap.get(sid) : undefined;

  if (memSession?.revoked) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Session has been signed out or revoked. Please sign in again.',
      code: 'SESSION_REVOKED',
    };
  }

  let lastActiveMs: number | null = null;
  if (memSession) {
    lastActiveMs = memSession.lastActiveMs;
  } else if (dbUser.last_active_at) {
    const parsedDb = Date.parse(dbUser.last_active_at);
    if (!Number.isNaN(parsedDb)) {
      lastActiveMs = parsedDb;
    }
  } else if (decoded.iat) {
    lastActiveMs = decoded.iat * 1000;
  }

  const serializedUser = serializePublicUser(dbUser);

  if (lastActiveMs !== null && now - lastActiveMs > IDLE_TIMEOUT_MS) {
    const idleMinutes = Math.floor((now - lastActiveMs) / 60000);
    const pageHeader = String(req.headers['x-page-visited'] || 'Workspace Session').trim();
    recordIdleAutoLogoutOnce({
      req,
      user: serializedUser,
      sid: sid || undefined,
      pageVisited: pageHeader || 'Workspace Session',
      details: `Session automatically terminated after exceeding 10 minutes of inactivity (${idleMinutes} min idle).`,
    });
    return {
      ok: false,
      statusCode: 401,
      error: 'Session expired due to 10 minutes of inactivity',
      code: 'IDLE_TIMEOUT',
    };
  }

  if (touchActivity) {
    if (sid) {
      sessionActivityMap.set(sid, {
        userId: dbUser.id,
        lastActiveMs: now,
        revoked: false,
        idleAuditLogged: false,
      });
    }
    db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(new Date(now).toISOString(), dbUser.id);
  }

  return {
    ok: true,
    user: {
      ...serializedUser,
      sid,
      tv: currentTv,
    },
  };
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

  const sessionCheck = validateSessionAndIdle(decoded, req, true);
  if (!sessionCheck.ok) {
    res.status(sessionCheck.statusCode).json({
      error: sessionCheck.error,
      ...(sessionCheck.code ? { code: sessionCheck.code } : {}),
    });
    return;
  }

  req.user = sessionCheck.user;
  req.sessionId = sessionCheck.user.sid;
  next();
}

function requireRole(...allowedRoles: StaffRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error:
          'Forbidden: System Administrator privileges are required for this action. Hiring Manager accounts are restricted to View & Review Only.',
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

  const isCandidatePortal = _role === 'CANDIDATE';

  return {
    ...row,
    skills,
    documents: docs.map((d) => {
      const rawAiJson = String(d.ai_extracted_json || '');
      const aiStatus = String(d.ai_verified_status || '') as AiDocumentVerificationStatus;
      let parsedAi: Record<string, unknown> | null = null;
      if (rawAiJson) {
        try {
          const obj = JSON.parse(rawAiJson);
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            parsedAi = obj as Record<string, unknown>;
          }
        } catch {
          parsedAi = null;
        }
      }

      // Candidate portal only receives detected document type + name match status (keep grades/CGPA/HR notes private)
      const safeAiExtracted =
        parsedAi && isCandidatePortal
          ? {
              document_detected:
                typeof parsedAi.document_detected === 'string' ? parsedAi.document_detected : undefined,
              candidate_name_on_doc:
                typeof parsedAi.candidate_name_on_doc === 'string' ? parsedAi.candidate_name_on_doc : undefined,
              name_matches_candidate:
                typeof parsedAi.name_matches_candidate === 'boolean'
                  ? parsedAi.name_matches_candidate
                  : undefined,
              error: typeof parsedAi.error === 'string' ? parsedAi.error : undefined,
            }
          : parsedAi;

      return {
        id: Number(d.id),
        candidate_id: Number(d.candidate_id),
        doc_type: String(d.doc_type),
        completed: Boolean(d.completed),
        verified: Boolean(d.verified),
        not_applicable: Boolean(d.not_applicable),
        file_name: String(d.file_name || ''),
        file_path: String(d.file_path || ''),
        uploaded_at: String(d.uploaded_at || ''),
        ai_extracted_json: isCandidatePortal ? '' : rawAiJson,
        ai_verified_status: aiStatus,
        ai_extracted: safeAiExtracted,
      };
    }),
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
          salary_myr: Number(offerRow.salary_myr),
          allowance_myr: Number(offerRow.allowance_myr),
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
    recent_emails: isCandidatePortal
      ? undefined
      : (db
          .prepare('SELECT * FROM email_logs WHERE candidate_id = ? ORDER BY id DESC LIMIT 15')
          .all(candidateId) as Array<Record<string, unknown>>),
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
    APPLICATION_FORM: 'Employment Application Form (Upload)',
    DISC: 'DISC Assessment Report / Sheet (Upload)',
    VAKAD: 'VAKAD Assessment Report / Sheet (Upload)',
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
  // 1. AUTHENTICATION, FIRST-RUN ADMIN SETUP, APPROVAL WORKFLOW & RBAC ROUTES
  // ===========================================================================
  app.get('/api/auth/setup-status', (_req: Request, res: Response) => {
    const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    res.json({ needsSetup: row.count === 0 });
  });

  app.post('/api/auth/setup', (req: Request, res: Response) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const department = normalizeDepartment(req.body?.department, 'HR');

    const existingCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
    if (existingCount > 0) {
      res.status(403).json({ error: 'Initial Administrator account already exists. Please sign in.' });
      return;
    }

    if (!name || !email || !email.includes('@') || password.length < 8) {
      res.status(400).json({
        error: 'Full name, valid work email, and a password of at least 8 characters are required.',
      });
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    const approvedAt = formatAuditTimestamp(new Date());
    const nowIso = new Date().toISOString();
    const createInitialAdmin = db.transaction(() => {
      const countInsideTx = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
      if (countInsideTx > 0) {
        return null;
      }
      const info = db
        .prepare(
          `INSERT INTO users (name, email, password_hash, role, department, status, approved_by, approved_at, last_active_at)
           VALUES (?, ?, ?, 'administrator', ?, 'approved', 'Initial System Setup', ?, ?)`
        )
        .run(name, email, hash, department, approvedAt, nowIso);
      return db
        .prepare(`SELECT ${PUBLIC_USER_SELECT}, token_version FROM users WHERE id = ?`)
        .get(info.lastInsertRowid) as (Record<string, unknown> & { token_version: number }) | undefined;
    });

    const createdUserRow = createInitialAdmin();
    if (!createdUserRow) {
      res.status(403).json({ error: 'Initial Administrator account already exists. Please sign in.' });
      return;
    }

    const createdUser = serializePublicUser(createdUserRow);
    const sid = registerActiveSession(createdUser.id);
    const payload: AuthPayload = {
      id: createdUser.id,
      email: createdUser.email,
      name: createdUser.name,
      role: createdUser.role,
      department: createdUser.department,
      sid,
      tv: Number(createdUserRow.token_version ?? 1),
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

    logAudit({
      req,
      actor: payload,
      pageVisited: 'Login Gate',
      actionTaken: 'CREATE_USER',
      targetEntity: `${createdUser.name} (${createdUser.email})`,
      details: `Registered initial System Administrator account (${createdUser.email}, ${createdUser.department}). Approved by: Initial System Setup. 2FA enabled & locked (${createdUser.two_fa_method}).`,
    });

    res.status(201).json({ token, user: createdUser });
  });

  // Public staff self-registration request (creates account with status = 'pending' until approved by Administrator)
  app.post('/api/auth/register-request', (req: Request, res: Response) => {
    const existingCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
    if (existingCount === 0) {
      res.status(400).json({
        error: 'No System Administrator exists yet. Please complete Initial System Setup first.',
      });
      return;
    }

    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const requestedRole: StaffRole = req.body?.role === 'administrator' ? 'administrator' : 'manager';
    const department = normalizeDepartment(req.body?.department, 'HR');

    if (!name || !email || !email.includes('@') || password.length < 8) {
      res.status(400).json({
        error: 'Full name, valid work email, and a password of at least 8 characters are required.',
      });
      return;
    }

    const existing = db.prepare('SELECT id, status FROM users WHERE lower(email) = ?').get(email) as
      | { id: number; status: UserApprovalStatus }
      | undefined;
    if (existing) {
      const msg =
        existing.status === 'pending'
          ? 'An access request for this email is already pending approval by a System Administrator.'
          : 'A staff account with this email already exists.';
      res.status(409).json({ error: msg });
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, department, status, approved_by, approved_at, last_active_at)
         VALUES (?, ?, ?, ?, ?, 'pending', '', '', '')`
      )
      .run(name, email, hash, requestedRole, department);

    const newUserId = Number(info.lastInsertRowid);
    logAudit({
      req,
      actorId: newUserId,
      actorName: `${name} (${email})`,
      actorRole: requestedRole,
      pageVisited: 'Login Gate',
      actionTaken: 'REGISTER_ACCESS_REQUEST',
      targetEntity: `${name} (${email})`,
      details: `Submitted new staff access request for ${name} (${email}, ${department}) requesting role "${requestedRole}". Status: pending System Administrator approval.`,
    });

    const createdRow = db
      .prepare(`SELECT ${PUBLIC_USER_SELECT} FROM users WHERE id = ?`)
      .get(newUserId) as Record<string, unknown>;

    res.status(201).json({
      message:
        'Your staff access request has been submitted and is pending approval by a System Administrator.',
      user: serializePublicUser(createdRow),
    });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const userRow = db
      .prepare(`SELECT ${PUBLIC_USER_SELECT}, password_hash, token_version FROM users WHERE lower(email) = ?`)
      .get(email) as
      | (Record<string, unknown> & {
          id: number;
          name: string;
          email: string;
          password_hash: string;
          role: StaffRole;
          department: string;
          status: UserApprovalStatus;
          token_version: number;
        })
      | undefined;

    if (!userRow || !bcrypt.compareSync(password, userRow.password_hash)) {
      logAudit({
        req,
        actorId: userRow?.id ?? null,
        actorName: userRow ? `${userRow.name} (${userRow.email})` : email,
        actorRole: userRow ? userRow.role : 'system',
        pageVisited: 'Login Gate',
        actionTaken: 'LOGIN_FAILED',
        targetEntity: email,
        details: userRow
          ? `Failed login attempt for ${userRow.email}: incorrect password.`
          : `Failed login attempt for unregistered email (${email}).`,
      });
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (userRow.status === 'pending') {
      logAudit({
        req,
        actorId: userRow.id,
        actorName: `${userRow.name} (${userRow.email})`,
        actorRole: userRow.role,
        pageVisited: 'Login Gate',
        actionTaken: 'LOGIN_FAILED',
        targetEntity: `${userRow.name} (${userRow.email})`,
        details: `Blocked login attempt for ${userRow.email}: account is pending approval by a System Administrator.`,
      });
      res.status(403).json({ error: 'Your account is pending approval by a System Administrator.' });
      return;
    }

    if (userRow.status !== 'approved') {
      logAudit({
        req,
        actorId: userRow.id,
        actorName: `${userRow.name} (${userRow.email})`,
        actorRole: userRow.role,
        pageVisited: 'Login Gate',
        actionTaken: 'LOGIN_FAILED',
        targetEntity: `${userRow.name} (${userRow.email})`,
        details: `Blocked login attempt for ${userRow.email}: account status is "${userRow.status}".`,
      });
      res.status(403).json({
        error: 'Your access request was not approved. Please contact a System Administrator.',
      });
      return;
    }

    const user = serializePublicUser(userRow);
    const sid = registerActiveSession(user.id);
    const payload: AuthPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
      sid,
      tv: Number(userRow.token_version ?? 1),
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

    logAudit({
      req,
      actor: payload,
      pageVisited: 'Login Gate',
      actionTaken: 'LOGIN_SUCCESS',
      targetEntity: `${user.name} (${user.email})`,
      details: `${user.name} (${user.email}) signed in as ${user.role} (2FA: ${user.two_fa_enabled ? `Enabled · ${user.two_fa_method}` : 'Disabled'}).`,
    });

    res.json({
      token,
      user,
    });
  });

  // Explicit logout & 10-minute idle auto-logout endpoint (revokes session and logs immutable audit event)
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const reason = String(req.body?.reason || 'manual').trim().toLowerCase();
    const pageVisited = String(req.body?.page_visited || 'Pipeline Dashboard').trim() || 'Pipeline Dashboard';

    if (token) {
      const decoded = verifyJwtToken(token);
      if (decoded) {
        const dbUser = db
          .prepare('SELECT id, name, email, role, department, status, approved_by, approved_at FROM users WHERE id = ?')
          .get(decoded.id) as AuthPayload | undefined;

        const actor = dbUser || decoded;
        const sid = typeof decoded.sid === 'string' ? decoded.sid : '';

        if (reason === 'idle_timeout') {
          recordIdleAutoLogoutOnce({
            req,
            user: actor,
            sid: sid || undefined,
            pageVisited,
            details: `Automatically logged out ${actor.name} (${actor.email}) after 10 minutes of inactivity on ${pageVisited}.`,
          });
        } else {
          if (sid) {
            const existing = sessionActivityMap.get(sid);
            sessionActivityMap.set(sid, {
              userId: actor.id,
              lastActiveMs: existing?.lastActiveMs ?? Date.now(),
              revoked: true,
              idleAuditLogged: existing?.idleAuditLogged ?? false,
            });
          }
          logAudit({
            req,
            actor,
            pageVisited,
            actionTaken: 'LOGOUT',
            targetEntity: `${actor.name} (${actor.email})`,
            details: `${actor.name} (${actor.email}) signed out manually from ${pageVisited}.`,
          });
        }
      }
    }

    res.json({ loggedOut: true });
  });

  // Keep-alive heartbeat triggered only when user clicks "Stay Signed In" or has verified local activity
  app.post('/api/auth/keep-alive', requireAuth, (_req: AuthedRequest, res: Response) => {
    res.json({ ok: true, last_active_at: new Date().toISOString() });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  app.get('/api/users', requireAuth, requireRole('administrator'), (_req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT ${PUBLIC_USER_SELECT}
         FROM users
         ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, id ASC`
      )
      .all() as Array<Record<string, unknown>>;
    res.json({ users: rows.map(serializePublicUser) });
  });

  app.post('/api/users', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const role: StaffRole = req.body?.role === 'administrator' ? 'administrator' : 'manager';
    const department = normalizeDepartment(req.body?.department, 'HR');

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
    const approvedBy = `${req.user!.name} (${req.user!.email})`;
    const approvedAt = formatAuditTimestamp(new Date());

    const info = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, department, status, approved_by, approved_at, last_active_at)
         VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, '')`
      )
      .run(name, email, hash, role, department, approvedBy, approvedAt);

    logAudit({
      req,
      actor: req.user,
      pageVisited: 'Team & Access Management',
      actionTaken: 'CREATE_USER',
      targetEntity: `${name} (${email})`,
      details: `Created & approved ${role} account for ${name} (${email}, ${department}). Approved by ${approvedBy}. 2FA enabled & locked (EMAIL_OTP).`,
    });

    const createdRow = db
      .prepare(`SELECT ${PUBLIC_USER_SELECT} FROM users WHERE id = ?`)
      .get(info.lastInsertRowid) as Record<string, unknown>;
    res.status(201).json({ user: serializePublicUser(createdRow) });
  });

  app.patch(
    '/api/users/:id/approve',
    requireAuth,
    requireRole('administrator'),
    (req: AuthedRequest, res: Response) => {
      const targetId = Number(req.params.id);
      const target = db
        .prepare('SELECT id, name, email, role, department, status FROM users WHERE id = ?')
        .get(targetId) as
        | {
            id: number;
            name: string;
            email: string;
            role: StaffRole;
            department: string;
            status: UserApprovalStatus;
          }
        | undefined;

      if (!target) {
        res.status(404).json({ error: 'User account not found.' });
        return;
      }

      const assignedRole: StaffRole =
        req.body?.role === 'administrator'
          ? 'administrator'
          : req.body?.role === 'manager'
            ? 'manager'
            : target.role;
      const assignedDepartment = normalizeDepartment(req.body?.department || target.department, 'HR');

      const approvedBy = `${req.user!.name} (${req.user!.email})`;
      const approvedAt = formatAuditTimestamp(new Date());

      db.prepare(
        `UPDATE users
         SET status = 'approved', role = ?, department = ?, approved_by = ?, approved_at = ?
         WHERE id = ?`
      ).run(assignedRole, assignedDepartment, approvedBy, approvedAt, targetId);

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Team & Access Management',
        actionTaken: 'APPROVE_USER',
        targetEntity: `${target.name} (${target.email})`,
        details: `Approved staff account for ${target.name} (${target.email}) from status "${target.status}" to "approved" with assigned role "${assignedRole}" (${assignedDepartment}). Approved by ${approvedBy}.`,
      });

      const updatedRow = db
        .prepare(`SELECT ${PUBLIC_USER_SELECT} FROM users WHERE id = ?`)
        .get(targetId) as Record<string, unknown>;
      res.json({ user: serializePublicUser(updatedRow) });
    }
  );

  app.patch(
    '/api/users/:id/reject',
    requireAuth,
    requireRole('administrator'),
    (req: AuthedRequest, res: Response) => {
      const targetId = Number(req.params.id);
      if (req.user && targetId === req.user.id) {
        res.status(400).json({ error: 'You cannot reject or suspend your own currently signed-in account.' });
        return;
      }

      const target = db
        .prepare('SELECT id, name, email, role, department, status FROM users WHERE id = ?')
        .get(targetId) as
        | {
            id: number;
            name: string;
            email: string;
            role: StaffRole;
            department: string;
            status: UserApprovalStatus;
          }
        | undefined;

      if (!target) {
        res.status(404).json({ error: 'User account not found.' });
        return;
      }

      if (target.role === 'administrator' && target.status === 'approved') {
        const adminCount = (
          db
            .prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'administrator' AND status = 'approved'`)
            .get() as { count: number }
        ).count;
        if (adminCount <= 1) {
          res.status(400).json({ error: 'Cannot reject or suspend the last remaining active Administrator account.' });
          return;
        }
      }

      const reason = String(req.body?.reason || '').trim();
      const reviewedBy = `${req.user!.name} (${req.user!.email})`;
      const reviewedAt = formatAuditTimestamp(new Date());

      db.prepare(
        `UPDATE users
         SET status = 'rejected', approved_by = ?, approved_at = ?, last_active_at = '', token_version = COALESCE(token_version, 1) + 1
         WHERE id = ?`
      ).run(`Rejected by ${reviewedBy}`, reviewedAt, targetId);

      // Immediately revoke any active in-memory sessions for this user
      for (const [sid, session] of sessionActivityMap.entries()) {
        if (session.userId === targetId) {
          sessionActivityMap.set(sid, { ...session, revoked: true });
        }
      }

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Team & Access Management',
        actionTaken: 'REJECT_USER',
        targetEntity: `${target.name} (${target.email})`,
        details: `Rejected/suspended ${target.role} account ${target.name} (${target.email}) (previous status: "${target.status}")${reason ? `. Reason: ${reason}` : ''}.`,
      });

      const updatedRow = db
        .prepare(`SELECT ${PUBLIC_USER_SELECT} FROM users WHERE id = ?`)
        .get(targetId) as Record<string, unknown>;
      res.json({ user: serializePublicUser(updatedRow) });
    }
  );

  app.patch('/api/users/:id', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    if (
      req.body &&
      ('two_fa_enabled' in req.body ||
        'two_fa_method' in req.body ||
        'two_fa_change_status' in req.body)
    ) {
      res.status(403).json({
        error:
          '2FA authentication settings are locked and cannot be changed without System Administrator approval via password re-verification.',
      });
      return;
    }

    const targetId = Number(req.params.id);
    const role: StaffRole = req.body?.role === 'administrator' ? 'administrator' : 'manager';
    const department = normalizeDepartment(req.body?.department, 'HR');

    const target = db.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(targetId) as
      | { id: number; name: string; email: string; role: StaffRole; status: UserApprovalStatus }
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    if (target.role === 'administrator' && target.status === 'approved' && role !== 'administrator') {
      const adminCount = (
        db
          .prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'administrator' AND status = 'approved'`)
          .get() as { count: number }
      ).count;
      if (adminCount <= 1) {
        res.status(400).json({ error: 'Cannot demote the last remaining active Administrator account.' });
        return;
      }
    }

    db.prepare('UPDATE users SET role = ?, department = ? WHERE id = ?').run(role, department, targetId);
    logAudit({
      req,
      actor: req.user,
      pageVisited: 'Team & Access Management',
      actionTaken: 'UPDATE_USER_ROLE',
      targetEntity: `${target.name} (${target.email})`,
      details: `Updated access role for ${target.email} from ${target.role} to ${role} (${department}).`,
    });

    const updatedRow = db
      .prepare(`SELECT ${PUBLIC_USER_SELECT} FROM users WHERE id = ?`)
      .get(targetId) as Record<string, unknown>;
    res.json({ user: serializePublicUser(updatedRow) });
  });

  // ===========================================================================
  // 1B. 2FA AUTHENTICATION LOCK & ADMINISTRATOR DANGER ZONE GOVERNANCE
  // ===========================================================================
  function verifyAdminPassword(adminId: number, suppliedPassword: string): boolean {
    if (!suppliedPassword) return false;
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(adminId) as
      | { password_hash: string }
      | undefined;
    if (!row || !row.password_hash) return false;
    return bcrypt.compareSync(suppliedPassword, row.password_hash);
  }

  const REJECTED_CANDIDATE_STATUS_SQL = `LOWER(status) IN ('rejected', 'withdrawn', 'rejected_screening', 'rejected_post_interview', 'offer_rejected', 'not_qualified')`;

  function computeDangerZoneStats() {
    const totalCandidates = (
      db.prepare('SELECT COUNT(*) as count FROM candidates').get() as { count: number }
    ).count;
    const rejectedOrWithdrawn = (
      db
        .prepare(`SELECT COUNT(*) as count FROM candidates WHERE ${REJECTED_CANDIDATE_STATUS_SQL}`)
        .get() as { count: number }
    ).count;

    const dbDocumentRecords = (
      db
        .prepare(`SELECT COUNT(*) as count FROM candidate_documents WHERE file_path != ''`)
        .get() as { count: number }
    ).count;

    let filesOnDisk = 0;
    let totalDiskBytes = 0;
    try {
      const entries = fs.readdirSync(UPLOADS_ROOT);
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const full = path.join(UPLOADS_ROOT, entry);
        try {
          const stat = fs.statSync(full);
          if (stat.isFile()) {
            filesOnDisk += 1;
            totalDiskBytes += stat.size;
          }
        } catch {
          // ignore transient stat errors
        }
      }
    } catch {
      filesOnDisk = 0;
      totalDiskBytes = 0;
    }

    const rejectedDocFiles = db
      .prepare(`
        SELECT DISTINCT cd.file_path AS fp
        FROM candidate_documents cd
        JOIN candidates c ON c.id = cd.candidate_id
        WHERE cd.file_path != '' AND ${REJECTED_CANDIDATE_STATUS_SQL.replace(/status/g, 'c.status')}
        UNION
        SELECT DISTINCT o.offer_letter_path AS fp
        FROM offers o
        JOIN candidates c ON c.id = o.candidate_id
        WHERE o.offer_letter_path != '' AND ${REJECTED_CANDIDATE_STATUS_SQL.replace(/status/g, 'c.status')}
      `)
      .all() as Array<{ fp: string }>;

    const todayMyt = getMalaysiaDateStamp(new Date());
    const totalSlots = (
      db.prepare('SELECT COUNT(*) as count FROM interview_slots').get() as { count: number }
    ).count;
    const activeSlots = (
      db.prepare(`SELECT COUNT(*) as count FROM interview_slots WHERE status = 'ACTIVE'`).get() as {
        count: number;
      }
    ).count;
    const bookedSlots = (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM interview_slots WHERE booked_count > 0 OR id IN (SELECT DISTINCT slot_id FROM interview_bookings WHERE status = 'CONFIRMED')`
        )
        .get() as { count: number }
    ).count;
    const unbookedFutureSlots = (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM interview_slots WHERE date >= ? AND booked_count = 0 AND id NOT IN (SELECT DISTINCT slot_id FROM interview_bookings WHERE status = 'CONFIRMED')`
        )
        .get(todayMyt) as { count: number }
    ).count;
    const totalBookings = (
      db.prepare('SELECT COUNT(*) as count FROM interview_bookings').get() as { count: number }
    ).count;
    const confirmedBookings = (
      db
        .prepare(`SELECT COUNT(*) as count FROM interview_bookings WHERE status = 'CONFIRMED'`)
        .get() as { count: number }
    ).count;

    const totalUsers = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
    const approvedUsers = (
      db.prepare(`SELECT COUNT(*) as count FROM users WHERE status = 'approved'`).get() as { count: number }
    ).count;
    const pendingUsers = (
      db.prepare(`SELECT COUNT(*) as count FROM users WHERE status = 'pending'`).get() as { count: number }
    ).count;
    const rejectedOrLockedUsers = (
      db.prepare(`SELECT COUNT(*) as count FROM users WHERE status = 'rejected'`).get() as { count: number }
    ).count;
    const twoFaLockedUsers = (
      db
        .prepare(`SELECT COUNT(*) as count FROM users WHERE two_fa_change_status = 'locked' AND two_fa_enabled = 1`)
        .get() as { count: number }
    ).count;
    const pendingTwoFaRows = db
      .prepare(
        `SELECT ${PUBLIC_USER_SELECT} FROM users WHERE two_fa_change_status = 'pending_admin_approval' ORDER BY id ASC`
      )
      .all() as Array<Record<string, unknown>>;

    const totalAuditEntries = (
      db.prepare('SELECT COUNT(*) as count FROM audit_logs').get() as { count: number }
    ).count;
    const triggerRows = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_logs' ORDER BY name ASC`)
      .all() as Array<{ name: string }>;
    const triggers = triggerRows.map((t) => t.name);

    return {
      candidates: {
        total: totalCandidates,
        active: Math.max(0, totalCandidates - rejectedOrWithdrawn),
        rejectedOrWithdrawn,
      },
      files: {
        dbDocumentRecords,
        filesOnDisk,
        totalDiskBytes,
        rejectedCandidateFiles: rejectedDocFiles.length,
      },
      interviews: {
        totalSlots,
        activeSlots,
        bookedSlots,
        unbookedFutureSlots,
        totalBookings,
        confirmedBookings,
      },
      users: {
        totalUsers,
        approvedUsers,
        pendingUsers,
        rejectedOrLockedUsers,
        twoFaLockedUsers,
        pendingTwoFaRequests: pendingTwoFaRows.length,
      },
      auditLogs: {
        totalEntries: totalAuditEntries,
        immutableProtected:
          triggers.includes('prevent_audit_log_delete') && triggers.includes('prevent_audit_log_update'),
        triggers,
      },
      pendingTwoFaUsers: pendingTwoFaRows.map(serializePublicUser),
    };
  }

  // Strictly block ANY direct self-service 2FA modification/disable/reset without System Administrator approval
  const blockDirectTwoFaChange = (req: AuthedRequest, res: Response) => {
    const pageVisited = String(req.headers['x-page-visited'] || 'User Profile & 2FA Settings').trim();
    logAudit({
      req,
      actor: req.user,
      pageVisited,
      actionTaken: '2FA_CHANGE_BLOCKED',
      targetEntity: req.user ? `${req.user.name} (${req.user.email})` : 'Unknown User',
      details: `Blocked direct ${req.method} attempt to modify/disable 2FA settings without System Administrator approval.`,
    });
    res.status(403).json({
      error: '2FA authentication settings are locked and cannot be changed without System Administrator approval',
    });
  };
  app.patch('/api/users/me/2fa', requireAuth, blockDirectTwoFaChange);
  app.put('/api/users/me/2fa', requireAuth, blockDirectTwoFaChange);
  app.post('/api/users/me/2fa', requireAuth, blockDirectTwoFaChange);
  app.delete('/api/users/me/2fa', requireAuth, blockDirectTwoFaChange);

  // Formal 2FA change/reset request submitted by a logged-in user for System Administrator review
  app.post('/api/users/me/request-2fa-change', requireAuth, (req: AuthedRequest, res: Response) => {
    const requestedAction = String(req.body?.requested_action || '').trim().toUpperCase() as TwoFaRequestedAction;
    const reason = String(req.body?.reason || '').trim();

    if (!VALID_TWO_FA_ACTIONS.has(requestedAction)) {
      res.status(400).json({
        error:
          'Invalid 2FA requested action. Choose RESET_2FA, DISABLE_2FA, ENABLE_2FA, SWITCH_TO_AUTHENTICATOR_APP, or SWITCH_TO_EMAIL_OTP.',
      });
      return;
    }

    if (reason.length < 5) {
      res.status(400).json({
        error: 'Please provide a brief reason (at least 5 characters) for your 2FA change request.',
      });
      return;
    }

    const requestPayload = JSON.stringify({
      action: requestedAction,
      reason: reason.slice(0, 400),
      requested_at: formatAuditTimestamp(new Date()),
    });

    db.prepare(
      `UPDATE users
       SET two_fa_change_status = 'pending_admin_approval', two_fa_requested_state = ?
       WHERE id = ?`
    ).run(requestPayload, req.user!.id);

    const pageVisited = String(req.headers['x-page-visited'] || 'User Profile & 2FA Settings').trim();
    logAudit({
      req,
      actor: req.user,
      pageVisited,
      actionTaken: 'REQUEST_2FA_CHANGE',
      targetEntity: `${req.user!.name} (${req.user!.email})`,
      details: `Submitted formal 2FA change request (${requestedAction}) pending System Administrator approval. Reason: ${reason.slice(0, 300)}`,
    });

    const updatedRow = db
      .prepare(`SELECT ${PUBLIC_USER_SELECT} FROM users WHERE id = ?`)
      .get(req.user!.id) as Record<string, unknown>;
    res.status(200).json({
      message:
        'Your 2FA change request has been queued for System Administrator approval. Your current 2FA lock remains active until approved.',
      user: serializePublicUser(updatedRow),
    });
  });

  // Administrator-only 2FA approval/denial endpoint (requires Administrator role + current admin password re-verification)
  app.patch(
    '/api/admin/users/:id/2fa-approval',
    requireAuth,
    requireRole('administrator'),
    (req: AuthedRequest, res: Response) => {
      const targetId = Number(req.params.id);
      const decision = String(req.body?.decision || '').trim().toLowerCase();
      const adminPassword = String(req.body?.admin_password || '');
      const notes = String(req.body?.notes || '').trim().slice(0, 300);
      const explicitAction = String(req.body?.requested_action || '').trim().toUpperCase();

      if (decision !== 'approve' && decision !== 'deny') {
        res.status(400).json({ error: 'Decision must be either "approve" or "deny".' });
        return;
      }

      if (!verifyAdminPassword(req.user!.id, adminPassword)) {
        logAudit({
          req,
          actor: req.user,
          pageVisited: 'Team & Access Management',
          actionTaken: '2FA_APPROVAL_AUTH_FAILED',
          targetEntity: `User #${targetId}`,
          details: `Failed System Administrator password re-verification while attempting 2FA governance action ("${decision}") for user #${targetId}.`,
        });
        res.status(403).json({
          error: 'Administrator password verification failed. Please re-enter your current password.',
        });
        return;
      }

      const targetRow = db
        .prepare(`SELECT ${PUBLIC_USER_SELECT} FROM users WHERE id = ?`)
        .get(targetId) as Record<string, unknown> | undefined;

      if (!targetRow) {
        res.status(404).json({ error: 'Target user account not found.' });
        return;
      }

      const target = serializePublicUser(targetRow);
      const approverLabel = `${req.user!.name} (${req.user!.email})`;

      // Parse pending requested action if present
      let pendingAction: TwoFaRequestedAction | '' = '';
      let pendingReason = '';
      if (target.two_fa_requested_state) {
        try {
          const parsed = JSON.parse(target.two_fa_requested_state) as { action?: string; reason?: string };
          if (parsed.action && VALID_TWO_FA_ACTIONS.has(parsed.action as TwoFaRequestedAction)) {
            pendingAction = parsed.action as TwoFaRequestedAction;
          }
          pendingReason = String(parsed.reason || '');
        } catch {
          if (VALID_TWO_FA_ACTIONS.has(target.two_fa_requested_state as TwoFaRequestedAction)) {
            pendingAction = target.two_fa_requested_state as TwoFaRequestedAction;
          }
        }
      }

      if (decision === 'deny') {
        db.prepare(
          `UPDATE users
           SET two_fa_change_status = 'locked', two_fa_requested_state = ''
           WHERE id = ?`
        ).run(targetId);

        logAudit({
          req,
          actor: req.user,
          pageVisited: 'Team & Access Management',
          actionTaken: 'DENY_2FA_CHANGE',
          targetEntity: `${target.name} (${target.email})`,
          details: `Denied 2FA change request (${pendingAction || 'unspecified'}) for ${target.email}. Account remains locked on ${target.two_fa_enabled ? `Enabled (${target.two_fa_method})` : 'Disabled'}.${notes ? ` Admin notes: ${notes}` : ''}`,
        });

        const refreshed = db
          .prepare(`SELECT ${PUBLIC_USER_SELECT} FROM users WHERE id = ?`)
          .get(targetId) as Record<string, unknown>;
        res.json({ user: serializePublicUser(refreshed), stats: computeDangerZoneStats() });
        return;
      }

      // Approve and execute the 2FA state transition
      const actionToApply = (
        VALID_TWO_FA_ACTIONS.has(explicitAction as TwoFaRequestedAction) ? explicitAction : pendingAction
      ) as TwoFaRequestedAction | '';

      if (!actionToApply) {
        res.status(400).json({
          error: 'No valid pending 2FA request or requested_action provided for approval.',
        });
        return;
      }

      let nextEnabled = target.two_fa_enabled ? 1 : 0;
      let nextMethod: TwoFaMethod = target.two_fa_method;
      if (actionToApply === 'DISABLE_2FA') {
        nextEnabled = 0;
      } else if (actionToApply === 'ENABLE_2FA') {
        nextEnabled = 1;
      } else if (actionToApply === 'RESET_2FA') {
        nextEnabled = 1;
        nextMethod = 'EMAIL_OTP';
      } else if (actionToApply === 'SWITCH_TO_AUTHENTICATOR_APP') {
        nextEnabled = 1;
        nextMethod = 'AUTHENTICATOR_APP';
      } else if (actionToApply === 'SWITCH_TO_EMAIL_OTP') {
        nextEnabled = 1;
        nextMethod = 'EMAIL_OTP';
      }

      db.prepare(
        `UPDATE users
         SET two_fa_enabled = ?,
             two_fa_method = ?,
             two_fa_change_status = 'locked',
             two_fa_requested_state = '',
             two_fa_approved_by = ?
         WHERE id = ?`
      ).run(nextEnabled, nextMethod, approverLabel, targetId);

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Team & Access Management',
        actionTaken: 'APPROVE_2FA_CHANGE',
        targetEntity: `${target.name} (${target.email})`,
        details: `Approved & executed 2FA change (${actionToApply}) for ${target.email} by ${approverLabel}. Previous: ${target.two_fa_enabled ? `Enabled (${target.two_fa_method})` : 'Disabled'} -> New: ${nextEnabled ? `Enabled (${nextMethod})` : 'Disabled'} (re-locked).${pendingReason ? ` Request reason: "${pendingReason}".` : ''}${notes ? ` Admin notes: ${notes}` : ''}`,
      });

      const refreshed = db
        .prepare(`SELECT ${PUBLIC_USER_SELECT} FROM users WHERE id = ?`)
        .get(targetId) as Record<string, unknown>;
      res.json({ user: serializePublicUser(refreshed), stats: computeDangerZoneStats() });
    }
  );

  // ===========================================================================
  // 1C. REAL-DATA DANGER ZONE ROUTES (SYSTEM ADMINISTRATOR ONLY)
  // ===========================================================================
  app.get(
    '/api/admin/danger-zone/stats',
    requireAuth,
    requireRole('administrator'),
    (_req: AuthedRequest, res: Response) => {
      res.json({ stats: computeDangerZoneStats() });
    }
  );

  // Explicit guard confirming audit_logs can never be purged even from the Danger Zone
  const rejectDangerZoneAuditPurge = (req: AuthedRequest, res: Response) => {
    logAudit({
      req,
      actor: req.user,
      pageVisited: 'Team & Access Management',
      actionTaken: 'DANGER_AUDIT_PURGE_BLOCKED',
      targetEntity: 'audit_logs',
      details:
        'Blocked attempt to purge audit_logs from Danger Zone. Protected by SQLite triggers prevent_audit_log_delete and prevent_audit_log_update.',
    });
    res.status(403).json({
      error:
        'Audit logs are protected by SQLite immutability triggers (prevent_audit_log_delete, prevent_audit_log_update) and can never be purged.',
    });
  };
  app.delete('/api/admin/danger-zone/audit-logs', requireAuth, requireRole('administrator'), rejectDangerZoneAuditPurge);
  app.post('/api/admin/danger-zone/purge-audit-logs', requireAuth, requireRole('administrator'), rejectDangerZoneAuditPurge);

  // Danger Zone Action 1: Purge Rejected / Withdrawn Candidate Data (PDPA Retention Cleanup)
  app.post(
    '/api/admin/danger-zone/purge-rejected-candidates',
    requireAuth,
    requireRole('administrator'),
    (req: AuthedRequest, res: Response) => {
      const adminPassword = String(req.body?.admin_password || '');
      const confirmationPhrase = String(req.body?.confirmation_phrase || '').trim();

      if (confirmationPhrase !== 'PURGE REJECTED CANDIDATES') {
        res.status(400).json({
          error: 'Confirmation phrase mismatch. Type exactly: PURGE REJECTED CANDIDATES',
        });
        return;
      }

      if (!verifyAdminPassword(req.user!.id, adminPassword)) {
        res.status(403).json({
          error: 'Administrator password verification failed. Action aborted.',
        });
        return;
      }

      const txResult = db.transaction(() => {
        const targets = db
          .prepare(`SELECT id, candidate_code, full_name, status FROM candidates WHERE ${REJECTED_CANDIDATE_STATUS_SQL}`)
          .all() as Array<{ id: number; candidate_code: string; full_name: string; status: string }>;

        if (targets.length === 0) {
          return {
            purgedCandidates: 0,
            candidateCodes: [] as string[],
            candidateFiles: [] as string[],
          };
        }

        const ids = targets.map((t) => t.id);
        const placeholders = ids.map(() => '?').join(', ');

        const docPaths = db
          .prepare(`SELECT file_path FROM candidate_documents WHERE candidate_id IN (${placeholders}) AND file_path != ''`)
          .all(...ids) as Array<{ file_path: string }>;
        const offerPaths = db
          .prepare(`SELECT offer_letter_path FROM offers WHERE candidate_id IN (${placeholders}) AND offer_letter_path != ''`)
          .all(...ids) as Array<{ offer_letter_path: string }>;

        // Release any active confirmed slot counts if a rejected candidate somehow still held one
        const activeBookings = db
          .prepare(`SELECT slot_id FROM interview_bookings WHERE candidate_id IN (${placeholders}) AND status = 'CONFIRMED'`)
          .all(...ids) as Array<{ slot_id: number }>;
        for (const b of activeBookings) {
          db.prepare('UPDATE interview_slots SET booked_count = MAX(0, booked_count - 1) WHERE id = ?').run(b.slot_id);
        }

        db.prepare(`DELETE FROM candidates WHERE id IN (${placeholders})`).run(...ids);

        const candidateFiles = Array.from(
          new Set([
            ...docPaths.map((d) => path.basename(d.file_path)),
            ...offerPaths.map((o) => path.basename(o.offer_letter_path)),
          ].filter(Boolean))
        );

        return {
          purgedCandidates: targets.length,
          candidateCodes: targets.map((t) => `${t.full_name} (${t.candidate_code})`),
          candidateFiles,
        };
      })();

      // Remove physical files from uploads/ only if no remaining record references them
      let removedFiles = 0;
      for (const fileName of txResult.candidateFiles) {
        const stillReferencedDoc = db
          .prepare('SELECT id FROM candidate_documents WHERE file_path = ? LIMIT 1')
          .get(fileName);
        const stillReferencedOffer = db
          .prepare('SELECT id FROM offers WHERE offer_letter_path = ? LIMIT 1')
          .get(fileName);
        if (stillReferencedDoc || stillReferencedOffer) continue;

        const diskPath = path.join(UPLOADS_ROOT, fileName);
        try {
          if (fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
            fs.unlinkSync(diskPath);
            removedFiles += 1;
          }
        } catch {
          // continue removing remaining files
        }
      }

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Team & Access Management',
        actionTaken: 'DANGER_PURGE_REJECTED_CANDIDATES',
        targetEntity: `${txResult.purgedCandidates} rejected/withdrawn candidate(s)`,
        details: `PDPA Retention Cleanup executed via Danger Zone: purged ${txResult.purgedCandidates} rejected/withdrawn candidate record(s) and deleted ${removedFiles} physical file(s) from uploads/. Active pipeline candidates and immutable audit_logs preserved.${
          txResult.candidateCodes.length > 0
            ? ` Purged: ${txResult.candidateCodes.slice(0, 15).join(', ')}${txResult.candidateCodes.length > 15 ? ' ...' : ''}.`
            : ''
        }`,
      });

      res.json({
        purgedCandidates: txResult.purgedCandidates,
        removedFiles,
        stats: computeDangerZoneStats(),
      });
    }
  );

  // Danger Zone Action 2: Revoke All Active User Sessions (Force Global Logout via token_version increment)
  app.post(
    '/api/admin/danger-zone/revoke-all-sessions',
    requireAuth,
    requireRole('administrator'),
    (req: AuthedRequest, res: Response) => {
      const adminPassword = String(req.body?.admin_password || '');
      const confirmationPhrase = String(req.body?.confirmation_phrase || '').trim();

      if (confirmationPhrase !== 'REVOKE ALL SESSIONS') {
        res.status(400).json({
          error: 'Confirmation phrase mismatch. Type exactly: REVOKE ALL SESSIONS',
        });
        return;
      }

      if (!verifyAdminPassword(req.user!.id, adminPassword)) {
        res.status(403).json({
          error: 'Administrator password verification failed. Action aborted.',
        });
        return;
      }

      const info = db
        .prepare(`UPDATE users SET token_version = COALESCE(token_version, 1) + 1, last_active_at = ''`)
        .run();

      for (const [sid, session] of sessionActivityMap.entries()) {
        sessionActivityMap.set(sid, { ...session, revoked: true });
      }

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Team & Access Management',
        actionTaken: 'DANGER_REVOKE_ALL_SESSIONS',
        targetEntity: `All Staff Sessions (${info.changes} account(s))`,
        details: `Forced global logout executed via Danger Zone: incremented token_version across ${info.changes} user account(s) and revoked all active JWT sessions.`,
      });

      res.json({
        revokedAccounts: info.changes,
        forceReauth: true,
      });
    }
  );

  // Danger Zone Action 4: Reset Unbooked Future Interview Slots (Preserves Booked Candidate Interviews)
  app.post(
    '/api/admin/danger-zone/reset-interview-slots',
    requireAuth,
    requireRole('administrator'),
    (req: AuthedRequest, res: Response) => {
      const adminPassword = String(req.body?.admin_password || '');
      const confirmationPhrase = String(req.body?.confirmation_phrase || '').trim();

      if (confirmationPhrase !== 'RESET INTERVIEW SLOTS') {
        res.status(400).json({
          error: 'Confirmation phrase mismatch. Type exactly: RESET INTERVIEW SLOTS',
        });
        return;
      }

      if (!verifyAdminPassword(req.user!.id, adminPassword)) {
        res.status(403).json({
          error: 'Administrator password verification failed. Action aborted.',
        });
        return;
      }

      const todayMyt = getMalaysiaDateStamp(new Date());
      const txResult = db.transaction(() => {
        const deleteInfo = db
          .prepare(
            `DELETE FROM interview_slots
             WHERE date >= ?
               AND booked_count = 0
               AND id NOT IN (SELECT DISTINCT slot_id FROM interview_bookings WHERE status = 'CONFIRMED')`
          )
          .run(todayMyt);

        const preservedBookedSlots = (
          db
            .prepare(
              `SELECT COUNT(*) as count FROM interview_slots WHERE booked_count > 0 OR id IN (SELECT DISTINCT slot_id FROM interview_bookings WHERE status = 'CONFIRMED')`
            )
            .get() as { count: number }
        ).count;

        return {
          deletedSlots: deleteInfo.changes,
          preservedBookedSlots,
        };
      })();

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Team & Access Management',
        actionTaken: 'DANGER_RESET_INTERVIEW_SLOTS',
        targetEntity: `${txResult.deletedSlots} unbooked future slot(s)`,
        details: `Reset unbooked future interview slots (from ${todayMyt} MYT onward) via Danger Zone: deleted ${txResult.deletedSlots} unbooked slot(s) while preserving ${txResult.preservedBookedSlots} booked candidate interview slot(s).`,
      });

      res.json({
        deletedSlots: txResult.deletedSlots,
        preservedBookedSlots: txResult.preservedBookedSlots,
        stats: computeDangerZoneStats(),
      });
    }
  );

  app.delete('/api/users/:id', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    const targetId = Number(req.params.id);
    if (req.user && targetId === req.user.id) {
      res.status(400).json({ error: 'You cannot delete your own currently signed-in account.' });
      return;
    }

    const target = db.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(targetId) as
      | { id: number; name: string; email: string; role: StaffRole; status: UserApprovalStatus }
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    if (target.role === 'administrator' && target.status === 'approved') {
      const adminCount = (
        db
          .prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'administrator' AND status = 'approved'`)
          .get() as { count: number }
      ).count;
      if (adminCount <= 1) {
        res.status(400).json({ error: 'Cannot delete the last remaining active Administrator account.' });
        return;
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    for (const [sid, session] of sessionActivityMap.entries()) {
      if (session.userId === targetId) {
        sessionActivityMap.set(sid, { ...session, revoked: true });
      }
    }

    logAudit({
      req,
      actor: req.user,
      pageVisited: 'Team & Access Management',
      actionTaken: 'DELETE_USER',
      targetEntity: `${target.name} (${target.email})`,
      details: `Removed ${target.role} account (${target.email}, status: ${target.status}).`,
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

        const resumeText = sanitizeResumeText(body.resumeText ?? body.resume_text);
        const position = String(body.position ?? body.positionApplied ?? '').trim() || 'General Role';
        const department = normalizeDepartment(body.department, 'HR');
        const rubric = String(body.rubric ?? body.jobRequirements ?? '').trim();

        const rawJsonBase64 = String(body.fileBase64 ?? '').trim();
        const rawJsonMimeType = String(body.fileMimeType ?? '').trim();
        const fileName = uploadedFile?.originalname || String(body.fileName ?? '').trim();

        if (!uploadedFile && !rawJsonBase64 && !resumeText) {
          res.status(400).json({ error: 'No resume file or text provided.' });
          return;
        }

        const result = await extractDocumentWithGemini({
          filePath: uploadedFile?.path,
          fileBuffer: uploadedFile?.buffer,
          fileBase64: !uploadedFile ? rawJsonBase64 : undefined,
          fileName,
          mimeType: uploadedFile?.mimetype || rawJsonMimeType,
          rawText: resumeText,
          docType: 'RESUME',
          position,
          department,
          rubric,
        });

        if (result.extractedFieldCount === 0) {
          res.status(422).json({
            error: uploadedFile || rawJsonBase64
              ? 'Could not read text from the uploaded resume. Please check that the PDF is not password-protected or paste the CV text directly.'
              : 'Could not extract candidate profile fields from the pasted resume text. Please include more candidate details and try again.',
          });
          return;
        }

        const extracted = result.data;
        logAudit({
          req,
          actor: req.user,
          pageVisited: 'Candidate Intake Modal',
          actionTaken: 'AI_RESUME_SCREENING',
          targetEntity: String(extracted.full_name || fileName || position),
          details: `Ran Gemini AI resume screening (${uploadedFile || rawJsonBase64 ? fileName || 'uploaded file' : 'pasted text'}) via ${result.modelUsed} for ${position} — extracted ${result.extractedFieldCount} field(s), Job-Fit Score: ${extracted.ai_score ?? 0}%.`,
        });

        res.json({
          full_name: String(extracted.full_name ?? ''),
          email: String(extracted.email ?? ''),
          phone: String(extracted.phone ?? ''),
          location: String(extracted.location ?? ''),
          years_experience: Number(extracted.years_experience ?? 0),
          has_uec: Boolean(extracted.has_uec),
          skills: Array.isArray(extracted.skills) ? extracted.skills : [],
          education: String(extracted.education ?? ''),
          experience: String(extracted.experience ?? ''),
          ai_score: Number(extracted.ai_score ?? 0),
          ai_summary: String(extracted.ai_summary ?? ''),
        });
      } catch (err: unknown) {
        console.error('Gemini resume parse error:', err);
        const rawMessage = err instanceof Error ? err.message : '';
        if (/Unsupported file format|Unsupported document file type|appears to be empty|No resume file or text provided/i.test(rawMessage)) {
          res.status(400).json({ error: rawMessage });
          return;
        }
        if (/malformed JSON/i.test(rawMessage)) {
          res.status(502).json({ error: rawMessage });
          return;
        }
        const { statusCode, userMessage } = formatGeminiError(err);
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

  app.post('/api/candidates', requireAuth, requireRole('administrator'), upload.single('resumeFile'), async (req: AuthedRequest, res: Response) => {
    const body = req.body ?? {};
    const fullName = String(body.full_name || body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim();
    const location = String(body.location || 'Kuala Lumpur, Malaysia').trim();
    const position = String(body.position || body.positionApplied || '').trim();
    const department = normalizeDepartment(body.department, 'HR');
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

      if (aiSummary || aiScore > 0) {
        const intakeResumeJson = JSON.stringify({
          full_name: fullName,
          email,
          phone,
          location,
          years_experience: yearsExperience,
          has_uec: hasUec,
          skills: skillsArr,
          education,
          experience,
          ai_score: aiScore,
          ai_summary: aiSummary,
          extracted_at: new Date().toISOString(),
        });
        db.prepare(`
          UPDATE candidate_documents
          SET ai_extracted_json = ?, ai_verified_status = 'VERIFIED_MATCH'
          WHERE candidate_id = ? AND doc_type = 'RESUME'
        `).run(intakeResumeJson, candidateId);
      } else {
        await runAndPersistDocumentExtraction({
          req,
          actor: req.user,
          pageVisited: 'Candidate Intake Modal',
          candidateId,
          candidateCode,
          candidateName: fullName,
          position,
          department,
          docType: 'RESUME',
          filePath: req.file.path,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
        });
      }
    } else if (body.resumeFileName) {
      db.prepare(`
        UPDATE candidate_documents
        SET completed = 1, verified = 1, file_name = ?, uploaded_at = datetime('now')
        WHERE candidate_id = ? AND doc_type = 'RESUME'
      `).run(String(body.resumeFileName), candidateId);
    }

    logAudit({
      req,
      actor: req.user,
      pageVisited: 'Candidate Intake Modal',
      actionTaken: 'CREATE_CANDIDATE',
      targetEntity: `${fullName} (${candidateCode})`,
      details: `Registered ${fullName} (${candidateCode}) via ${source} for ${position} (${department}), AI Job-Fit Score: ${aiScore}%.`,
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
          subject: `[TalentFlow MY] Shortlisted for ${existing.position} — Upload Application Form, Assessments & Academic Docs`,
          bodyText: [
            `Dear ${existing.full_name},`,
            '',
            `Congratulations! Your application for ${existing.position} (${existing.department}) has progressed to the next stage.`,
            '',
            'Please upload the following completed documents directly via your Candidate Self-Service Portal (accepted formats: PDF, PNG, JPG, WEBP, DOCX):',
            '- Employment Application Form (Mandatory)',
            '- DISC Assessment Report / Sheet (Mandatory)',
            '- VAKAD Assessment Report / Sheet (Mandatory)',
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
          req,
          actor: req.user,
          pageVisited: 'Candidate Detail Drawer',
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
          req,
          actor: req.user,
          pageVisited: 'Candidate Detail Drawer',
        });
      }

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Candidate Detail Drawer',
        actionTaken: 'UPDATE_SCREENING_DECISION',
        targetEntity: `${existing.full_name} (${existing.candidate_code})`,
        details:
          decision === 'proceed'
            ? `Shortlisted ${existing.full_name} (Stage 5) & dispatched Candidate Portal upload request (Application Form, DISC, VAKAD & Academic Docs).`
            : `Updated screening decision for ${existing.full_name} to "${decision}". Remarks: ${remarks || 'None'}`,
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
        req,
        actor: req.user,
        pageVisited: 'Candidate Detail Drawer',
        actionTaken: 'VERIFY_DOCUMENT',
        targetEntity: `${existing.full_name} (${existing.candidate_code})`,
        details: `Verified forms & academic documents for ${existing.full_name} (Remaining missing: ${missing.length}${discProfile ? `, DISC: ${discProfile}` : ''}).`,
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
          req,
          actor: req.user,
          pageVisited: 'Candidate Detail Drawer',
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
          req,
          actor: req.user,
          pageVisited: 'Candidate Detail Drawer',
        });
      }

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Candidate Detail Drawer',
        actionTaken: 'UPDATE_QUALIFICATION',
        targetEntity: `${existing.full_name} (${existing.candidate_code})`,
        details: `Classified ${existing.full_name} as "${qualStatus}". Remarks: ${qualRemarks || 'None'}`,
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
          req,
          actor: req.user,
          pageVisited: 'Candidate Detail Drawer',
        });
      }

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Candidate Detail Drawer',
        actionTaken: 'RECORD_INTERVIEW_FEEDBACK',
        targetEntity: `${existing.full_name} (${existing.candidate_code})`,
        details: `Recorded panel rating ${rating}/5 and post-interview decision "${decision}" for ${existing.full_name}.`,
      });
    }
    // Generic profile update
    else {
      const fullName = String(body.full_name ?? existing.full_name).trim();
      const position = String(body.position ?? existing.position).trim();
      const department = normalizeDepartment(body.department ?? existing.department, 'HR');
      db.prepare(`
        UPDATE candidates SET full_name = ?, position = ?, department = ?, updated_at = datetime('now') WHERE id = ?
      `).run(fullName, position, department, id);

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Candidate Detail Drawer',
        actionTaken: 'UPDATE_CANDIDATE',
        targetEntity: `${fullName} (${existing.candidate_code})`,
        details: `Updated candidate profile (${position}, ${department}).`,
      });
    }

    const updated = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ candidate: hydrateCandidate(updated, req.user!.role) });
  });

  // Upload a candidate document file (HR staff) + automatic Gemini AI multimodal extraction
  app.post(
    '/api/candidates/:id/documents',
    requireAuth,
    requireRole('administrator'),
    upload.single('file'),
    async (req: AuthedRequest, res: Response) => {
      const candidateId = Number(req.params.id);
      const docType = String(req.body?.doc_type || '').toUpperCase();

      if (!isExtractableDocType(docType)) {
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(400).json({ error: 'Invalid document type.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'Please select a file to upload.' });
        return;
      }

      const candidate = db
        .prepare('SELECT id, candidate_code, full_name, position, department FROM candidates WHERE id = ?')
        .get(candidateId) as
        | { id: number; candidate_code: string; full_name: string; position: string; department: string }
        | undefined;
      if (!candidate) {
        fs.unlink(req.file.path, () => {});
        res.status(404).json({ error: 'Candidate not found.' });
        return;
      }

      ensureCandidateDocumentRows(candidateId);
      db.prepare(`
        UPDATE candidate_documents
        SET completed = 1, not_applicable = 0, file_name = ?, file_path = ?, uploaded_at = datetime('now'),
            ai_extracted_json = '', ai_verified_status = ''
        WHERE candidate_id = ? AND doc_type = ?
      `).run(req.file.originalname, req.file.filename, candidateId, docType);

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Candidate Detail Drawer',
        actionTaken: 'UPLOAD_DOCUMENT',
        targetEntity: `${candidate.full_name} (${candidate.candidate_code}) — ${docType}`,
        details: `Uploaded ${docType} (${req.file.originalname}) for ${candidate.full_name}.`,
      });

      const aiExtraction = await runAndPersistDocumentExtraction({
        req,
        actor: req.user,
        pageVisited: 'Candidate Detail Drawer',
        candidateId,
        candidateCode: candidate.candidate_code,
        candidateName: candidate.full_name,
        position: candidate.position,
        department: candidate.department,
        docType,
        filePath: req.file.path,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
      });

      const updated = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as Record<string, unknown>;
      res.json({
        candidate: hydrateCandidate(updated, req.user!.role),
        aiExtraction,
      });
    }
  );

  // Manual Gemini AI re-scan for any uploaded candidate document (Administrator only)
  app.post(
    '/api/documents/:docId/ai-extract',
    requireAuth,
    requireRole('administrator'),
    async (req: AuthedRequest, res: Response) => {
      const docId = Number(req.params.docId);
      if (!Number.isInteger(docId) || docId <= 0) {
        res.status(400).json({ error: 'Invalid document ID.' });
        return;
      }

      const docRow = db
        .prepare(`
          SELECT d.*, c.candidate_code, c.full_name, c.position, c.department
          FROM candidate_documents d
          JOIN candidates c ON c.id = d.candidate_id
          WHERE d.id = ?
        `)
        .get(docId) as
        | {
            id: number;
            candidate_id: number;
            doc_type: string;
            file_name: string;
            file_path: string;
            candidate_code: string;
            full_name: string;
            position: string;
            department: string;
          }
        | undefined;

      if (!docRow) {
        res.status(404).json({ error: 'Document record not found.' });
        return;
      }

      const docType = String(docRow.doc_type || '').toUpperCase();
      if (!isExtractableDocType(docType)) {
        res.status(400).json({ error: `Document type "${docType}" does not support Gemini AI file extraction.` });
        return;
      }

      const safeFile = path.basename(String(docRow.file_path || ''));
      if (!safeFile) {
        res.status(400).json({ error: 'No uploaded file is attached to this document row yet.' });
        return;
      }

      const diskPath = path.join(UPLOADS_ROOT, safeFile);
      if (!fs.existsSync(diskPath)) {
        res.status(404).json({ error: 'Stored document file could not be found on disk. Please re-upload the file.' });
        return;
      }

      const aiExtraction = await runAndPersistDocumentExtraction({
        req,
        actor: req.user,
        pageVisited: 'Candidate Detail Drawer',
        candidateId: docRow.candidate_id,
        candidateCode: docRow.candidate_code,
        candidateName: docRow.full_name,
        position: docRow.position,
        department: docRow.department,
        docType,
        filePath: diskPath,
        fileName: docRow.file_name || safeFile,
        isReanalysis: true,
      });

      const updated = db
        .prepare('SELECT * FROM candidates WHERE id = ?')
        .get(docRow.candidate_id) as Record<string, unknown>;
      res.json({
        candidate: hydrateCandidate(updated, req.user!.role),
        aiExtraction,
      });
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

    const emailDelivery = await dispatchEmail({
      candidateId: id,
      candidateName: String(candidate.full_name),
      recipientEmail: String(candidate.email),
      templateType: 'docs_reminder_48h',
      subject: `[Reminder] Pending Forms & Academic Documents — ${candidate.position}`,
      bodyText: [
        `Dear ${candidate.full_name},`,
        '',
        `This is a reminder for your ${candidate.position} application. We are still awaiting your direct portal upload for the following items:`,
        ...(missing.length > 0 ? missing.map((m) => `- ${m}`) : ['- Outstanding application form, assessments, or academic documents']),
        '',
        `Please upload your completed Application Form, DISC, VAKAD, and academic certificates (SPM, UEC if applicable, Degree, Transcript) directly via your Candidate Self-Service Portal:`,
        `${portalUrl}`,
        '',
        'Thank you,',
        'TalentFlow MY HR Team',
      ].join('\n'),
      stageTriggered: 6,
      triggeredBy: req.user!.email,
      skipAuditLog: true,
    });

    logAudit({
      req,
      actor: req.user,
      pageVisited: 'Candidate Detail Drawer',
      actionTaken: 'SEND_EMAIL',
      targetEntity: `${candidate.full_name} (${candidate.candidate_code})`,
      details:
        emailDelivery.delivery_status === 'SENT_SMTP'
          ? `Sent document reminder email via SMTP to ${candidate.email} (${missing.length} outstanding item(s)).`
          : `Attempted document reminder email to ${candidate.email} — SMTP_FAILED: ${emailDelivery.smtp_error}`,
    });

    const updated = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ candidate: hydrateCandidate(updated, req.user!.role), emailDelivery });
  });

  // WhatsApp Outreach Audit Logging (Administrator Only)
  app.post('/api/candidates/:id/whatsapp-log', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid candidate ID.' });
      return;
    }

    const candidate = db.prepare('SELECT id, candidate_code, full_name, phone FROM candidates WHERE id = ?').get(id) as
      | { id: number; candidate_code: string; full_name: string; phone: string }
      | undefined;
    if (!candidate) {
      res.status(404).json({ error: 'Candidate not found.' });
      return;
    }

    const rawPhone = String(req.body?.phone || candidate.phone || '').trim();
    const normalizedPhone = String(req.body?.normalizedPhone || '').trim();
    const templateName = String(req.body?.templateName || 'General Follow-Up').trim().slice(0, 120);
    const pageVisited = String(req.body?.pageVisited || 'Candidate Detail Drawer').trim().slice(0, 120);
    const phoneDisplay = normalizedPhone ? `${rawPhone || normalizedPhone} (+${normalizedPhone})` : rawPhone || 'N/A';

    logAudit({
      req,
      actor: req.user,
      pageVisited,
      actionTaken: 'WHATSAPP_OUTREACH',
      targetEntity: `${candidate.full_name} (${candidate.candidate_code})`,
      details: `Opened WhatsApp outreach to ${phoneDisplay} with template: ${templateName}`,
    });

    res.json({ logged: true });
  });

  // Batch 48h Missing-Docs Reminder
  app.post('/api/candidates/remind-docs-batch', requireAuth, requireRole('administrator'), async (req: AuthedRequest, res: Response) => {
    const ids = Array.isArray(req.body?.candidateIds) ? req.body.candidateIds.map(Number) : [];
    let sentCount = 0;
    let deliveredCount = 0;
    let failedCount = 0;
    let lastError = '';

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

      const delivery = await dispatchEmail({
        candidateId: id,
        candidateName: String(candidate.full_name),
        recipientEmail: String(candidate.email),
        templateType: 'docs_reminder_48h',
        subject: `[Reminder] Pending Forms & Academic Documents — ${candidate.position}`,
        bodyText: [
          `Dear ${candidate.full_name},`,
          '',
          `This is a 48-hour follow-up reminder for your ${candidate.position} application. Please upload the outstanding items via your Candidate Self-Service Portal:`,
          ...missing.map((m) => `- ${m}`),
          '',
          `Candidate Self-Service Portal Link: ${portalUrl}`,
          '',
          'Regards,\nTalentFlow MY HR Team',
        ].join('\n'),
        stageTriggered: 6,
        triggeredBy: req.user!.email,
        skipAuditLog: true,
      });
      sentCount++;
      if (delivery.delivery_status === 'SENT_SMTP') {
        deliveredCount++;
      } else {
        failedCount++;
        if (delivery.smtp_error) lastError = delivery.smtp_error;
      }
    }

    logAudit({
      req,
      actor: req.user,
      pageVisited: 'Email Automation & Audit Trail',
      actionTaken: 'SEND_EMAIL',
      targetEntity: `Batch Document Reminders (${sentCount} candidates)`,
      details: `Processed batch document reminders: ${deliveredCount} sent via SMTP, ${failedCount} failed${lastError ? ` (Last error: ${lastError})` : ''}.`,
    });

    res.json({ sentCount, deliveredCount, failedCount, lastError });
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
      const department = normalizeDepartment(body.department || candidate.department, 'HR');
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
        req,
        actor: req.user,
        pageVisited: 'Candidate Detail Drawer',
      });

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Candidate Detail Drawer',
        actionTaken: 'ISSUE_OFFER',
        targetEntity: `${candidate.full_name} (${candidate.candidate_code})`,
        details: `Issued MYR employment offer (RM ${salaryMyr.toLocaleString('en-MY')}/mo, start ${startDate || 'TBD'}) for ${position}.`,
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

    const updated = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown>;
    logAudit({
      req,
      actor: req.user,
      pageVisited: 'Candidate Detail Drawer',
      actionTaken: 'UPDATE_OFFER_STATUS',
      targetEntity: `${updated.full_name} (${updated.candidate_code})`,
      details: `Updated offer status for ${updated.full_name} to "${status}" (Stage ${nextStage}).`,
    });

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
      req,
      actor: req.user,
      pageVisited: 'Candidate Detail Drawer',
      actionTaken: 'DELETE_CANDIDATE',
      targetEntity: `${existing.full_name} (${existing.candidate_code})`,
      details: `Deleted candidate record ${existing.full_name} (${existing.candidate_code}).`,
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
    const department = normalizeDepartment(body.department, 'HR');
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
      req,
      actor: req.user,
      pageVisited: 'Interview Calendar',
      actionTaken: 'CREATE_INTERVIEW_SLOT',
      targetEntity: `Slot #${slotId} (${date} ${startTime}-${endTime})`,
      details: `Created interview slot ${date} ${startTime}-${endTime} (capacity ${capacity}, ${mode}) with ${interviewerName}.`,
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
      req,
      actor: req.user,
      pageVisited: 'Interview Calendar',
      actionTaken: status === 'CANCELLED' ? 'CANCEL_INTERVIEW' : 'RESCHEDULE_INTERVIEW',
      targetEntity: `Slot #${slotId} (${date} ${startTime}-${endTime})`,
      details: `Updated interview slot #${slotId} (${date} ${startTime}-${endTime}, capacity ${capacity}, status ${status}).`,
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
      req,
      actor: req.user,
      pageVisited: 'Interview Calendar',
      actionTaken: 'CANCEL_INTERVIEW',
      targetEntity: `Slot #${slotId} (${existing.date} ${existing.start_time})`,
      details: `Deleted interview slot #${slotId} (${existing.date} ${existing.start_time}).`,
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
        req,
        actor: req.user,
        pageVisited: 'Interview Calendar',
      });

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Interview Calendar',
        actionTaken: 'BOOK_INTERVIEW_SLOT',
        targetEntity: `${result.candidate.full_name} — Slot #${slotId}`,
        details: `Booked interview slot #${slotId} (${result.slot.date} ${result.slot.start_time}-${result.slot.end_time}) for ${result.candidate.full_name}.`,
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
      const candInfo = db
        .prepare('SELECT full_name, candidate_code FROM candidates WHERE id = ?')
        .get(booking.candidate_id) as { full_name: string; candidate_code: string } | undefined;
      const mappedAction =
        nextStatus === 'CANCELLED'
          ? 'CANCEL_INTERVIEW'
          : nextStatus === 'RESCHEDULED'
            ? 'RESCHEDULE_INTERVIEW'
            : nextStatus === 'COMPLETED'
              ? 'RECORD_INTERVIEW_FEEDBACK'
              : 'BOOK_INTERVIEW_SLOT';

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Interview Calendar',
        actionTaken: mappedAction,
        targetEntity: candInfo
          ? `${candInfo.full_name} (${candInfo.candidate_code}) — Booking #${bookingId}`
          : `Booking #${bookingId} (Slot #${booking.slot_id})`,
        details: `Updated interview booking #${bookingId} to "${nextStatus}".`,
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

  async function processPortalAcademicUpload(
    req: Request,
    row: Record<string, unknown>
  ): Promise<{ errorStatus?: number; errorMessage?: string }> {
    const candidateId = Number(row.id);
    const docType = String(req.body?.doc_type || '').toUpperCase();
    const allowedPortalDocs = ['APPLICATION_FORM', 'DISC', 'VAKAD', 'SPM', 'UEC', 'DEGREE', 'TRANSCRIPT'];
    if (!allowedPortalDocs.includes(docType)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return { errorStatus: 400, errorMessage: 'Invalid document type for portal upload.' };
    }
    if (!req.file) {
      return { errorStatus: 400, errorMessage: 'Please attach a document file (PDF, PNG, JPG, WEBP, or DOCX).' };
    }

    ensureCandidateDocumentRows(candidateId);
    // Reset verified = 0 when replacing a document so HR performs manual sign-off on the new scan
    db.prepare(`
      UPDATE candidate_documents
      SET completed = 1, verified = 0, not_applicable = 0, file_name = ?, file_path = ?, uploaded_at = datetime('now'),
          ai_extracted_json = '', ai_verified_status = ''
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

    const candidateActorName = `${row.full_name} (${row.email})`;
    logAudit({
      req,
      actorName: candidateActorName,
      actorRole: 'candidate_portal',
      pageVisited: 'Candidate Self-Service Portal',
      actionTaken: 'UPLOAD_DOCUMENT',
      targetEntity: `${row.full_name} (${row.candidate_code}) — ${docType}`,
      details: `Candidate ${row.full_name} uploaded ${docType} (${req.file.originalname}) via self-service portal.`,
    });

    await runAndPersistDocumentExtraction({
      req,
      actorName: candidateActorName,
      actorRole: 'candidate_portal',
      pageVisited: 'Candidate Self-Service Portal',
      candidateId,
      candidateCode: String(row.candidate_code),
      candidateName: String(row.full_name),
      position: String(row.position || ''),
      department: String(row.department || ''),
      docType: docType as ExtractableDocType,
      filePath: req.file.path,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    return {};
  }

  // Dedicated Candidate Portal academic document upload + automatic Gemini AI extraction
  app.post('/api/portal/:token/documents', upload.single('file'), async (req: Request, res: Response) => {
    const token = String(req.params.token || '').trim();
    const row = db.prepare('SELECT * FROM candidates WHERE portal_token = ?').get(token) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(404).json({ error: 'Invalid or expired candidate portal token.' });
      return;
    }

    const result = await processPortalAcademicUpload(req, row);
    if (result.errorStatus) {
      res.status(result.errorStatus).json({ error: result.errorMessage });
      return;
    }

    const candidateId = Number(row.id);
    const refreshed = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as Record<string, unknown>;
    const availableSlots = db
      .prepare(`SELECT * FROM interview_slots WHERE status = 'ACTIVE' AND booked_count < capacity ORDER BY date ASC, start_time ASC`)
      .all();

    res.json({
      candidate: hydrateCandidate(refreshed, 'CANDIDATE'),
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

    // Action A: Upload candidate form, assessment, or academic document
    if (action === 'upload_document') {
      const result = await processPortalAcademicUpload(req, row);
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.errorMessage });
        return;
      }
    }
    // Action B: Atomic Self-Service Interview Slot Booking
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
          req,
          actorName: `${row.full_name} (${row.email})`,
          actorRole: 'candidate_portal',
          pageVisited: 'Candidate Self-Service Portal',
        });

        logAudit({
          req,
          actorName: `${row.full_name} (${row.email})`,
          actorRole: 'candidate_portal',
          pageVisited: 'Candidate Self-Service Portal',
          actionTaken: 'BOOK_INTERVIEW_SLOT',
          targetEntity: `${row.full_name} (${row.candidate_code}) — Slot #${slotId}`,
          details: `Candidate ${row.full_name} self-booked slot #${slotId} (${result.slot.date} ${result.slot.start_time}-${result.slot.end_time}).`,
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
        req,
        actorName: `${row.full_name} (${row.email})`,
        actorRole: 'candidate_portal',
        pageVisited: 'Candidate Self-Service Portal',
        actionTaken: 'UPDATE_OFFER_STATUS',
        targetEntity: `${row.full_name} (${row.candidate_code})`,
        details: `Candidate ${row.full_name} ${offerStatus.toLowerCase()} employment offer via self-service portal.`,
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

    if (jwtRaw) {
      const decoded = verifyJwtToken(jwtRaw);
      if (decoded) {
        const sessionCheck = validateSessionAndIdle(decoded, req, true);
        if (sessionCheck.ok) {
          authorized = true;
        } else {
          res.status(sessionCheck.statusCode).json({
            error: sessionCheck.error,
            ...(sessionCheck.code ? { code: sessionCheck.code } : {}),
          });
          return;
        }
      }
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
  // 7. EMAIL LOGS & TAMPER-EVIDENT IMMUTABLE AUDIT LOGS
  // ===========================================================================
  app.get('/api/email-logs', requireAuth, (_req: AuthedRequest, res: Response) => {
    const emailLogs = db.prepare('SELECT * FROM email_logs ORDER BY id DESC LIMIT 200').all();
    res.json({ emailLogs, smtpStatus: getPublicSmtpStatus() });
  });

  // Resend any previously logged email via live Gmail SMTP (Administrator only)
  app.post(
    '/api/email-logs/:id/resend',
    requireAuth,
    requireRole('administrator'),
    async (req: AuthedRequest, res: Response) => {
      const logId = Number(req.params.id);
      if (!Number.isInteger(logId) || logId <= 0) {
        res.status(400).json({ error: 'Invalid email log ID.' });
        return;
      }

      const original = db.prepare('SELECT * FROM email_logs WHERE id = ?').get(logId) as
        | {
            id: number;
            candidate_id: number | null;
            candidate_name: string;
            recipient_email: string;
            template_type: string;
            subject: string;
            body_preview: string;
            stage_triggered: number;
          }
        | undefined;

      if (!original) {
        res.status(404).json({ error: 'Email log entry not found.' });
        return;
      }

      const pageVisited = String(req.body?.page_visited || 'Email Automation & Audit Trail').trim();

      const emailDelivery = await dispatchEmail({
        candidateId: original.candidate_id,
        candidateName: original.candidate_name,
        recipientEmail: original.recipient_email,
        templateType: original.template_type,
        subject: original.subject,
        bodyText: original.body_preview,
        stageTriggered: original.stage_triggered,
        triggeredBy: req.user!.email,
        req,
        actor: req.user,
        pageVisited,
      });

      const emailLog = db.prepare('SELECT * FROM email_logs WHERE id = ?').get(emailDelivery.id);
      const candidateRow = original.candidate_id
        ? (db.prepare('SELECT * FROM candidates WHERE id = ?').get(original.candidate_id) as
            | Record<string, unknown>
            | undefined)
        : undefined;

      res.json({
        emailDelivery,
        emailLog,
        candidate: candidateRow ? hydrateCandidate(candidateRow, req.user!.role) : null,
      });
    }
  );

  // Live Gmail SMTP connection verification check (Administrator only)
  app.post('/api/smtp/verify', requireAuth, requireRole('administrator'), async (_req: AuthedRequest, res: Response) => {
    const smtpStatus = getPublicSmtpStatus();
    const { transporter, config } = createLiveMailTransporter();
    if (!transporter) {
      res.json({
        ok: false,
        error: config.reason,
        smtpStatus,
      });
      return;
    }

    try {
      await transporter.verify();
      res.json({
        ok: true,
        error: '',
        smtpStatus,
      });
    } catch (err) {
      res.json({
        ok: false,
        error: formatSmtpError(err),
        smtpStatus,
      });
    }
  });

  // Strict immutability enforcement: explicitly reject ANY DELETE, PUT, or PATCH on audit_logs
  const rejectAuditMutation = (_req: Request, res: Response) => {
    res.status(403).json({
      error: 'Forbidden: Audit trail records are strictly immutable and cannot be modified or deleted.',
    });
  };
  app.delete('/api/audit-logs', rejectAuditMutation);
  app.delete('/api/audit-logs/:id', rejectAuditMutation);
  app.delete('/api/audit-logs/*', rejectAuditMutation);
  app.put('/api/audit-logs', rejectAuditMutation);
  app.put('/api/audit-logs/:id', rejectAuditMutation);
  app.put('/api/audit-logs/*', rejectAuditMutation);
  app.patch('/api/audit-logs', rejectAuditMutation);
  app.patch('/api/audit-logs/:id', rejectAuditMutation);
  app.patch('/api/audit-logs/*', rejectAuditMutation);

  // Query audit logs with live multi-filter support (both administrator and manager)
  app.get('/api/audit-logs', requireAuth, (req: AuthedRequest, res: Response) => {
    const { whereClause, params } = buildAuditLogFilterSql(req.query as Record<string, unknown>);
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(1000, Math.round(requestedLimit)))
      : 500;

    const totalCount = (
      db.prepare(`SELECT COUNT(*) as count FROM audit_logs ${whereClause}`).get(...params) as {
        count: number;
      }
    ).count;

    const auditLogs = db
      .prepare(`SELECT * FROM audit_logs ${whereClause} ORDER BY id DESC LIMIT ?`)
      .all(...params, limit);

    const actors = (
      db
        .prepare(`SELECT DISTINCT actor_name FROM audit_logs WHERE actor_name != '' ORDER BY actor_name ASC`)
        .all() as Array<{ actor_name: string }>
    ).map((r) => r.actor_name);

    const pages = (
      db
        .prepare(`SELECT DISTINCT page_visited FROM audit_logs WHERE page_visited != '' ORDER BY page_visited ASC`)
        .all() as Array<{ page_visited: string }>
    ).map((r) => r.page_visited);

    const actions = (
      db
        .prepare(`SELECT DISTINCT action_taken FROM audit_logs WHERE action_taken != '' ORDER BY action_taken ASC`)
        .all() as Array<{ action_taken: string }>
    ).map((r) => r.action_taken);

    res.json({
      auditLogs,
      totalCount,
      facets: { actors, pages, actions },
    });
  });

  // Record automatic frontend page/view navigation visits (administrator & manager)
  app.post('/api/audit-logs/page-visit', requireAuth, (req: AuthedRequest, res: Response) => {
    const pageVisited = String(req.body?.page_visited || '').trim();
    if (!pageVisited) {
      res.status(400).json({ error: 'page_visited is required.' });
      return;
    }
    const targetEntity = String(req.body?.target_entity || '').trim();
    const details =
      String(req.body?.details || '').trim() ||
      `Visited ${pageVisited}${targetEntity ? ` (${targetEntity})` : ''}.`;

    logAudit({
      req,
      actor: req.user,
      pageVisited,
      actionTaken: 'PAGE_VIEW',
      targetEntity,
      details,
    });
    res.status(201).json({ logged: true });
  });

  // Record candidate report CSV export (Administrator only)
  app.post('/api/audit-logs/export', requireAuth, requireRole('administrator'), (req: AuthedRequest, res: Response) => {
    const count = Number(req.body?.count) || 0;
    const filterSummary = String(req.body?.filter_summary || '').trim();
    logAudit({
      req,
      actor: req.user,
      pageVisited: 'Candidate Database',
      actionTaken: 'EXPORT_REPORT',
      targetEntity: `Candidate CSV (${count} rows)`,
      details: `Exported Excel-compatible CSV report covering ${count} candidate record(s)${filterSummary ? ` [Filters: ${filterSummary}]` : ''}.`,
    });
    res.json({ logged: true });
  });

  // Administrator-only full/filtered Audit Trail CSV download
  app.get(
    '/api/audit-logs/export',
    requireAuth,
    requireRole('administrator'),
    (req: AuthedRequest, res: Response) => {
      const query = req.query as Record<string, unknown>;
      const { whereClause, params } = buildAuditLogFilterSql(query);
      const rows = db
        .prepare(`SELECT * FROM audit_logs ${whereClause} ORDER BY id DESC LIMIT 50000`)
        .all(...params) as Array<{
        id: number;
        timestamp: string;
        actor_name: string;
        actor_role: string;
        page_visited: string;
        action_taken: string;
        target_entity: string;
        details: string;
        ip_address: string;
        user_agent: string;
      }>;

      const activeFilterParts = [
        query.search ? `search="${query.search}"` : '',
        query.actor ? `actor="${query.actor}"` : '',
        query.role ? `role="${query.role}"` : '',
        query.page_visited ? `page="${query.page_visited}"` : '',
        query.action_taken ? `action="${query.action_taken}"` : '',
        query.date_from ? `from=${query.date_from}` : '',
        query.date_to ? `to=${query.date_to}` : '',
      ].filter(Boolean);

      const filename = `TJW_HR_Audit_Trail_${getMalaysiaDateStamp()}.csv`;

      logAudit({
        req,
        actor: req.user,
        pageVisited: 'Email Automation & Audit Trail',
        actionTaken: 'EXPORT_AUDIT_LOG',
        targetEntity: filename,
        details: `Downloaded tamper-evident audit trail CSV (${rows.length} row(s))${activeFilterParts.length > 0 ? ` [${activeFilterParts.join(', ')}]` : ' [All records]'}.`,
      });

      const headers = [
        'ID',
        'Timestamp (MYT)',
        'Actor Name',
        'Role',
        'Page Visited',
        'Action Taken',
        'Target Record',
        'Details',
        'IP Address',
        'Device/Browser',
      ];

      const lines = [
        headers.map(escapeCsvCell).join(','),
        ...rows.map((r) =>
          [
            r.id,
            r.timestamp,
            r.actor_name,
            r.actor_role,
            r.page_visited,
            r.action_taken,
            r.target_entity,
            r.details,
            r.ip_address,
            r.user_agent,
          ]
            .map(escapeCsvCell)
            .join(',')
        ),
      ];

      const csvContent = `\uFEFF${lines.join('\r\n')}`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(csvContent);
    }
  );

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
