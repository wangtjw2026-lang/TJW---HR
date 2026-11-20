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

export function formatAuditTimestamp(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const myt = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} MYT`;
  return `${myt} (${date.toISOString()})`;
}

export function getMalaysiaDateStamp(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function mapLegacyAuditRow(row: Record<string, unknown>) {
  const legacyAction = String(row.action || 'SYSTEM_EVENT');
  const legacyRole = String(row.actor_role || 'system');
  const legacyTargetType = String(row.target_type || '');
  const legacyCreated = String(row.created_at || '');

  let parsedDate = new Date();
  if (legacyCreated) {
    const isoCandidate = legacyCreated.includes('T')
      ? legacyCreated
      : `${legacyCreated.replace(' ', 'T')}Z`;
    const d = new Date(isoCandidate);
    if (!Number.isNaN(d.getTime())) parsedDate = d;
  }

  const actorRole =
    legacyRole === 'administrator' || legacyRole === 'manager'
      ? legacyRole
      : legacyRole.toUpperCase() === 'CANDIDATE' || legacyRole === 'candidate_portal'
        ? 'candidate_portal'
        : 'system';

  const actionMap: Record<string, string> = {
    INITIAL_ADMIN_CREATED: 'CREATE_USER',
    STAFF_LOGIN: 'LOGIN_SUCCESS',
    STAFF_USER_CREATED: 'CREATE_USER',
    STAFF_USER_DELETED: 'DELETE_USER',
    RBAC_ROLE_UPDATED: 'UPDATE_USER_ROLE',
    CANDIDATE_REGISTERED: 'CREATE_CANDIDATE',
    SCREENING_PROCEED: 'UPDATE_SCREENING_DECISION',
    SCREENING_REJECT: 'UPDATE_SCREENING_DECISION',
    SCREENING_PENDING: 'UPDATE_SCREENING_DECISION',
    DOCS_CHECKLIST_UPDATED: 'VERIFY_DOCUMENT',
    DOCUMENT_UPLOADED: 'UPLOAD_DOCUMENT',
    PORTAL_DOCUMENT_UPLOADED: 'UPLOAD_DOCUMENT',
    PORTAL_FORMS_COMPLETED: 'VERIFY_DOCUMENT',
    QUALIFICATION_QUALIFIED: 'UPDATE_QUALIFICATION',
    QUALIFICATION_NOT_QUALIFIED: 'UPDATE_QUALIFICATION',
    QUALIFICATION_PENDING: 'UPDATE_QUALIFICATION',
    INTERVIEW_SLOT_CREATED: 'CREATE_INTERVIEW_SLOT',
    INTERVIEW_SLOT_BOOKED_ATOMIC: 'BOOK_INTERVIEW_SLOT',
    PORTAL_SLOT_BOOKED_ATOMIC: 'BOOK_INTERVIEW_SLOT',
    INTERVIEW_SLOT_CANCELLED: 'CANCEL_INTERVIEW',
    INTERVIEW_SLOT_DELETED: 'CANCEL_INTERVIEW',
    INTERVIEW_BOOKING_CANCELLED: 'CANCEL_INTERVIEW',
    INTERVIEW_BOOKING_RESCHEDULED: 'RESCHEDULE_INTERVIEW',
    INTERVIEW_BOOKING_COMPLETED: 'RECORD_INTERVIEW_FEEDBACK',
    POST_INTERVIEW_OFFER: 'RECORD_INTERVIEW_FEEDBACK',
    POST_INTERVIEW_REJECT: 'RECORD_INTERVIEW_FEEDBACK',
    EMPLOYMENT_OFFER_SENT: 'ISSUE_OFFER',
    DOCS_REMINDER_DISPATCHED: 'SEND_EMAIL',
    BATCH_DOCS_REMINDER: 'SEND_EMAIL',
    EXCEL_CSV_EXPORTED: 'EXPORT_REPORT',
  };

  const pageMap: Record<string, string> = {
    auth: 'Login Gate',
    rbac: 'Team & Access Management',
    candidate: 'Candidate Detail Drawer',
    document: actorRole === 'candidate_portal' ? 'Candidate Self-Service Portal' : 'Candidate Detail Drawer',
    interview_slot: actorRole === 'candidate_portal' ? 'Candidate Self-Service Portal' : 'Interview Calendar',
    offer: actorRole === 'candidate_portal' ? 'Candidate Self-Service Portal' : 'Candidate Detail Drawer',
    export: 'Candidate Database',
  };

  return {
    timestamp: formatAuditTimestamp(parsedDate),
    actor_id: row.actor_id !== null && row.actor_id !== undefined ? Number(row.actor_id) : null,
    actor_name: String(row.actor_email || 'System'),
    actor_role: actorRole,
    page_visited: pageMap[legacyTargetType] || 'Pipeline Dashboard',
    action_taken: actionMap[legacyAction] || legacyAction,
    target_entity: String(row.target_id || ''),
    details: String(row.details || ''),
    ip_address: '',
    user_agent: '',
  };
}

function ensureImmutableAuditLogsTable() {
  const columns = db.prepare(`PRAGMA table_info(audit_logs)`).all() as Array<{ name: string }>;
  const hasNewSchema =
    columns.some((c) => c.name === 'timestamp') &&
    columns.some((c) => c.name === 'page_visited') &&
    columns.some((c) => c.name === 'action_taken') &&
    columns.some((c) => c.name === 'ip_address');

  if (columns.length > 0 && !hasNewSchema) {
    // One-time atomic migration from legacy audit_logs schema preserving existing real records
    const migrate = db.transaction(() => {
      db.exec(`
        DROP TRIGGER IF EXISTS prevent_audit_log_delete;
        DROP TRIGGER IF EXISTS prevent_audit_log_update;
        ALTER TABLE audit_logs RENAME TO audit_logs_legacy;

        CREATE TABLE audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          actor_id INTEGER,
          actor_name TEXT NOT NULL,
          actor_role TEXT NOT NULL CHECK(actor_role IN ('administrator', 'manager', 'candidate_portal', 'system')),
          page_visited TEXT NOT NULL,
          action_taken TEXT NOT NULL,
          target_entity TEXT NOT NULL DEFAULT '',
          details TEXT NOT NULL,
          ip_address TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT ''
        );
      `);

      const legacyRows = db
        .prepare('SELECT * FROM audit_logs_legacy ORDER BY id ASC')
        .all() as Array<Record<string, unknown>>;

      const insertStmt = db.prepare(`
        INSERT INTO audit_logs (
          timestamp, actor_id, actor_name, actor_role, page_visited,
          action_taken, target_entity, details, ip_address, user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const r of legacyRows) {
        const mapped = mapLegacyAuditRow(r);
        insertStmt.run(
          mapped.timestamp,
          mapped.actor_id,
          mapped.actor_name,
          mapped.actor_role,
          mapped.page_visited,
          mapped.action_taken,
          mapped.target_entity,
          mapped.details,
          mapped.ip_address,
          mapped.user_agent
        );
      }

      db.exec('DROP TABLE audit_logs_legacy;');
    });
    migrate();
  } else if (columns.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        actor_id INTEGER,
        actor_name TEXT NOT NULL,
        actor_role TEXT NOT NULL CHECK(actor_role IN ('administrator', 'manager', 'candidate_portal', 'system')),
        page_visited TEXT NOT NULL,
        action_taken TEXT NOT NULL,
        target_entity TEXT NOT NULL DEFAULT '',
        details TEXT NOT NULL,
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT ''
      );
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_role ON audit_logs(actor_role);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action_taken);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_page ON audit_logs(page_visited);

    CREATE TRIGGER IF NOT EXISTS prevent_audit_log_delete
    BEFORE DELETE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit logs cannot be deleted');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_audit_log_update
    BEFORE UPDATE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit logs cannot be modified');
    END;
  `);
}

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('administrator', 'manager')),
      department TEXT NOT NULL DEFAULT 'HR',
      status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending', 'approved', 'rejected')),
      approved_by TEXT NOT NULL DEFAULT '',
      approved_at TEXT NOT NULL DEFAULT '',
      last_active_at TEXT NOT NULL DEFAULT '',
      two_fa_enabled INTEGER NOT NULL DEFAULT 1,
      two_fa_method TEXT NOT NULL DEFAULT 'EMAIL_OTP',
      two_fa_change_status TEXT NOT NULL DEFAULT 'locked' CHECK(two_fa_change_status IN ('locked', 'pending_admin_approval')),
      two_fa_requested_state TEXT NOT NULL DEFAULT '',
      two_fa_approved_by TEXT NOT NULL DEFAULT '',
      token_version INTEGER NOT NULL DEFAULT 1,
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
      doc_type TEXT NOT NULL CHECK(doc_type IN ('RESUME', 'APPLICATION_FORM', 'DISC', 'VAKAD', 'SPM', 'UEC', 'DEGREE', 'TRANSCRIPT')),
      completed INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      not_applicable INTEGER NOT NULL DEFAULT 0,
      file_name TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '',
      uploaded_at TEXT NOT NULL DEFAULT '',
      ai_extracted_json TEXT NOT NULL DEFAULT '',
      ai_verified_status TEXT NOT NULL DEFAULT '',
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
      department TEXT NOT NULL DEFAULT 'HR',
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
      delivery_status TEXT NOT NULL DEFAULT 'LOGGED_LOCAL',
      smtp_error TEXT NOT NULL DEFAULT '',
      message_id TEXT NOT NULL DEFAULT '',
      triggered_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE SET NULL
    );
  `);

  ensureUsersSecurityColumns();
  ensureCandidateDocumentsAiColumns();
  ensureCandidateDocumentsSchemaAndTypes();
  ensureEmailLogsDeliveryColumns();
  ensureImmutableAuditLogsTable();
}

function ensureUsersSecurityColumns() {
  const columns = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));

  if (!colNames.has('status')) {
    db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'`);
  }
  if (!colNames.has('approved_by')) {
    db.exec(`ALTER TABLE users ADD COLUMN approved_by TEXT NOT NULL DEFAULT ''`);
  }
  if (!colNames.has('approved_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN approved_at TEXT NOT NULL DEFAULT ''`);
  }
  if (!colNames.has('last_active_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN last_active_at TEXT NOT NULL DEFAULT ''`);
  }
  if (!colNames.has('two_fa_enabled')) {
    db.exec(`ALTER TABLE users ADD COLUMN two_fa_enabled INTEGER NOT NULL DEFAULT 1`);
  }
  if (!colNames.has('two_fa_method')) {
    db.exec(`ALTER TABLE users ADD COLUMN two_fa_method TEXT NOT NULL DEFAULT 'EMAIL_OTP'`);
  }
  if (!colNames.has('two_fa_change_status')) {
    db.exec(`ALTER TABLE users ADD COLUMN two_fa_change_status TEXT NOT NULL DEFAULT 'locked'`);
  }
  if (!colNames.has('two_fa_requested_state')) {
    db.exec(`ALTER TABLE users ADD COLUMN two_fa_requested_state TEXT NOT NULL DEFAULT ''`);
  }
  if (!colNames.has('two_fa_approved_by')) {
    db.exec(`ALTER TABLE users ADD COLUMN two_fa_approved_by TEXT NOT NULL DEFAULT ''`);
  }
  if (!colNames.has('token_version')) {
    db.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1`);
  }

  // Backfill approval metadata for pre-existing initial admin/approved accounts only (zero dummy data)
  const legacyApproved = db
    .prepare(`SELECT id, created_at FROM users WHERE status = 'approved' AND (approved_by IS NULL OR approved_by = '')`)
    .all() as Array<{ id: number; created_at: string }>;

  if (legacyApproved.length > 0) {
    const updateStmt = db.prepare(`
      UPDATE users
      SET approved_by = 'Initial System Setup',
          approved_at = CASE WHEN approved_at = '' THEN ? ELSE approved_at END
      WHERE id = ?
    `);
    for (const row of legacyApproved) {
      let parsedDate = new Date();
      if (row.created_at) {
        const isoCandidate = row.created_at.includes('T')
          ? row.created_at
          : `${row.created_at.replace(' ', 'T')}Z`;
        const d = new Date(isoCandidate);
        if (!Number.isNaN(d.getTime())) parsedDate = d;
      }
      updateStmt.run(formatAuditTimestamp(parsedDate), row.id);
    }
  }
}

function ensureCandidateDocumentsAiColumns() {
  const columns = db.prepare(`PRAGMA table_info(candidate_documents)`).all() as Array<{ name: string }>;
  const hasJson = columns.some((c) => c.name === 'ai_extracted_json');
  const hasStatus = columns.some((c) => c.name === 'ai_verified_status');

  if (!hasJson) {
    db.exec(`ALTER TABLE candidate_documents ADD COLUMN ai_extracted_json TEXT NOT NULL DEFAULT ''`);
  }
  if (!hasStatus) {
    db.exec(`ALTER TABLE candidate_documents ADD COLUMN ai_verified_status TEXT NOT NULL DEFAULT ''`);
  }
}

function ensureCandidateDocumentsSchemaAndTypes() {
  const tableDef = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'candidate_documents'`)
    .get() as { sql?: string } | undefined;
  const sql = String(tableDef?.sql || '');

  const needsMigration =
    sql.includes("'APP_FORM'") || !sql.includes("'APPLICATION_FORM'") || !sql.includes("'VAKAD'");

  if (needsMigration) {
    db.pragma('foreign_keys = OFF');
    try {
      const migrateDocs = db.transaction(() => {
        db.exec(`
          CREATE TABLE candidate_documents_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id INTEGER NOT NULL,
            doc_type TEXT NOT NULL CHECK(doc_type IN ('RESUME', 'APPLICATION_FORM', 'DISC', 'VAKAD', 'SPM', 'UEC', 'DEGREE', 'TRANSCRIPT')),
            completed INTEGER NOT NULL DEFAULT 0,
            verified INTEGER NOT NULL DEFAULT 0,
            not_applicable INTEGER NOT NULL DEFAULT 0,
            file_name TEXT NOT NULL DEFAULT '',
            file_path TEXT NOT NULL DEFAULT '',
            uploaded_at TEXT NOT NULL DEFAULT '',
            ai_extracted_json TEXT NOT NULL DEFAULT '',
            ai_verified_status TEXT NOT NULL DEFAULT '',
            UNIQUE(candidate_id, doc_type),
            FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
          );

          INSERT OR IGNORE INTO candidate_documents_v2 (
            id, candidate_id, doc_type, completed, verified, not_applicable,
            file_name, file_path, uploaded_at, ai_extracted_json, ai_verified_status
          )
          SELECT
            id,
            candidate_id,
            CASE WHEN doc_type = 'APP_FORM' THEN 'APPLICATION_FORM' ELSE doc_type END,
            completed,
            verified,
            not_applicable,
            file_name,
            file_path,
            uploaded_at,
            ai_extracted_json,
            ai_verified_status
          FROM candidate_documents;

          DROP TABLE candidate_documents;
          ALTER TABLE candidate_documents_v2 RENAME TO candidate_documents;
        `);

        // Ensure every existing candidate has rows for APPLICATION_FORM and VAKAD
        const candidateRows = db.prepare(`SELECT id FROM candidates`).all() as Array<{ id: number }>;
        const insertMissing = db.prepare(`
          INSERT OR IGNORE INTO candidate_documents (
            candidate_id, doc_type, completed, verified, not_applicable, file_name, file_path, uploaded_at
          ) VALUES (?, ?, 0, 0, 0, '', '', '')
        `);
        for (const c of candidateRows) {
          insertMissing.run(c.id, 'APPLICATION_FORM');
          insertMissing.run(c.id, 'VAKAD');
        }
      });
      migrateDocs();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}

function ensureEmailLogsDeliveryColumns() {
  const columns = db.prepare(`PRAGMA table_info(email_logs)`).all() as Array<{ name: string }>;
  const hasSmtpError = columns.some((c) => c.name === 'smtp_error');
  const hasMessageId = columns.some((c) => c.name === 'message_id');

  if (!hasSmtpError) {
    db.exec(`ALTER TABLE email_logs ADD COLUMN smtp_error TEXT NOT NULL DEFAULT ''`);
  }
  if (!hasMessageId) {
    db.exec(`ALTER TABLE email_logs ADD COLUMN message_id TEXT NOT NULL DEFAULT ''`);
  }
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
  const docTypes = [
    'RESUME',
    'APPLICATION_FORM',
    'DISC',
    'VAKAD',
    'SPM',
    'UEC',
    'DEGREE',
    'TRANSCRIPT',
  ] as const;
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
