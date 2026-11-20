import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const DB_PATH = path.join(DATA_DIR, 'talentflow.db');

export function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

ensureDirectories();

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const UPLOADS_ROOT = UPLOADS_DIR;

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('administrator', 'manager')),
      department TEXT NOT NULL DEFAULT 'Human Resources',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_code TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      location TEXT NOT NULL DEFAULT 'Kuala Lumpur, Malaysia',
      position TEXT NOT NULL,
      department TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('JobStreet', 'Email')),
      applied_date TEXT NOT NULL,
      stage INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'pending_screening',
      education TEXT NOT NULL DEFAULT '',
      experience TEXT NOT NULL DEFAULT '',
      years_experience REAL NOT NULL DEFAULT 0,
      skills TEXT NOT NULL DEFAULT '[]',
      ai_score INTEGER NOT NULL DEFAULT 0,
      ai_summary TEXT NOT NULL DEFAULT '',
      screening_decision TEXT NOT NULL DEFAULT 'pending',
      screening_remarks TEXT NOT NULL DEFAULT '',
      disc_profile TEXT NOT NULL DEFAULT '',
      last_doc_reminder_at TEXT NOT NULL DEFAULT '',
      qualification_status TEXT NOT NULL DEFAULT 'pending',
      qualification_remarks TEXT NOT NULL DEFAULT '',
      interview_feedback TEXT NOT NULL DEFAULT '',
      interview_rating INTEGER NOT NULL DEFAULT 0,
      post_interview_decision TEXT NOT NULL DEFAULT 'pending',
      final_decision_notes TEXT NOT NULL DEFAULT '',
      portal_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS candidate_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL CHECK(doc_type IN ('RESUME', 'APP_FORM', 'DISC', 'SPM', 'UEC', 'DEGREE', 'TRANSCRIPT')),
      completed INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      not_applicable INTEGER NOT NULL DEFAULT 0,
      file_name TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '',
      uploaded_at TEXT NOT NULL DEFAULT '',
      UNIQUE(candidate_id, doc_type),
      FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS interview_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1,
      booked_count INTEGER NOT NULL DEFAULT 0,
      location_or_link TEXT NOT NULL DEFAULT '',
      interviewer_name TEXT NOT NULL DEFAULT 'Hiring Panel',
      department TEXT NOT NULL DEFAULT 'Human Resources',
      mode TEXT NOT NULL DEFAULT 'Google Meet',
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'CANCELLED')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS interview_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id INTEGER NOT NULL,
      candidate_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status IN ('CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED')),
      booked_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (slot_id) REFERENCES interview_slots(id) ON DELETE CASCADE,
      FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL UNIQUE,
      position TEXT NOT NULL,
      department TEXT NOT NULL,
      salary_myr REAL NOT NULL DEFAULT 0,
      allowance_myr REAL NOT NULL DEFAULT 0,
      probation_months INTEGER NOT NULL DEFAULT 3,
      start_date TEXT NOT NULL DEFAULT '',
      issue_date TEXT NOT NULL DEFAULT '',
      deadline_date TEXT NOT NULL DEFAULT '',
      offer_letter_path TEXT NOT NULL DEFAULT '',
      offer_terms_summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Offer Sent' CHECK(status IN ('Offer Sent', 'Accepted', 'Rejected', 'Pending Response', 'Expired')),
      candidate_response_note TEXT NOT NULL DEFAULT '',
      responded_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER,
      candidate_name TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      template_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_preview TEXT NOT NULL,
      stage_triggered INTEGER NOT NULL DEFAULT 1,
      delivery_status TEXT NOT NULL DEFAULT 'LOGGED',
      triggered_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      actor_email TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function generatePortalToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function generateCandidateCode(): string {
  const now = new Date();
  const ym = `${now.getFullYear().toString().slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TFMY-${ym}-${rand}`;
}

export function ensureCandidateDocumentRows(candidateId: number, hasUec = false) {
  const docTypes = ['RESUME', 'APP_FORM', 'DISC', 'SPM', 'UEC', 'DEGREE', 'TRANSCRIPT'] as const;
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO candidate_documents (candidate_id, doc_type, completed, verified, not_applicable, file_name, file_path, uploaded_at)
    VALUES (?, ?, 0, 0, ?, '', '', '')
  `);
  for (const dt of docTypes) {
    const notApplicable = dt === 'UEC' && !hasUec ? 1 : 0;
    stmt.run(candidateId, dt, notApplicable);
  }
}

initializeDatabase();
