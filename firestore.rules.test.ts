/**
 * TalentFlow MY — Phase 0 Security Rules TDD Specification ("Dirty Dozen")
 * Verifies all 12 adversarial payloads are blocked by firestore.rules.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  pillar: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  actor: { uid: string; email: string; emailVerified: boolean; role: string };
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_SECURITY_CASES: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Self-Admin Privilege Escalation',
    pillar: 'Pillar 4 (Tiered Identity Logic)',
    operation: 'create',
    path: '/users/attacker_uid',
    actor: { uid: 'attacker_uid', email: 'attacker@example.com', emailVerified: true, role: 'none' },
    payload: { uid: 'attacker_uid', email: 'attacker@example.com', displayName: 'Attacker', role: 'hr_admin', department: 'IT' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Ghost / Shadow Field Injection on Candidate Update',
    pillar: 'Pillar 2 (Anti-Update-Gap)',
    operation: 'update',
    path: '/candidates/cand_001',
    actor: { uid: 'recruiter_1', email: 'rec@company.my', emailVerified: true, role: 'recruiter' },
    payload: { screeningDecision: 'proceed', isVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified Email Admin Spoof',
    pillar: 'Phase 5 (Email Spoofing Test)',
    operation: 'list',
    path: '/candidates',
    actor: { uid: 'spoof_uid', email: 'wangtjw2026@gmail.com', emailVerified: false, role: 'none' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Hiring Manager PII Breach Attempt',
    pillar: 'Pillar 6 (PII Isolation)',
    operation: 'get',
    path: '/candidates/cand_001/private/pii',
    actor: { uid: 'hm_01', email: 'hm@company.my', emailVerified: true, role: 'hiring_manager' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Recruiter Salary / Compensation Breach Attempt',
    pillar: 'Pillar 6 (PII Isolation)',
    operation: 'get',
    path: '/candidates/cand_001/private/compensation',
    actor: { uid: 'rec_01', email: 'rec@company.my', emailVerified: true, role: 'recruiter' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Document ID Poisoning (1500-char ID)',
    pillar: 'Pillar 3 (Path Variable Hardening)',
    operation: 'create',
    path: `/candidates/${'a$%'.repeat(500)}`,
    actor: { uid: 'rec_01', email: 'rec@company.my', emailVerified: true, role: 'recruiter' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Denial-of-Wallet Oversized String',
    pillar: 'Pillar 3 (Mandatory Size Enforcement)',
    operation: 'create',
    path: '/candidates/cand_big',
    actor: { uid: 'rec_01', email: 'rec@company.my', emailVerified: true, role: 'recruiter' },
    payload: { aiSummary: 'x'.repeat(2500) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Unbounded Skills Array Injection (>20 items)',
    pillar: 'Pillar 5 (Total Array Guarding)',
    operation: 'create',
    path: '/candidates/cand_arr',
    actor: { uid: 'rec_01', email: 'rec@company.my', emailVerified: true, role: 'recruiter' },
    payload: { skills: Array.from({ length: 25 }, (_, i) => `Skill_${i}`) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Identity Spoofing on Create (ownerId mismatch)',
    pillar: 'Pillar 2 (Identity Integrity)',
    operation: 'create',
    path: '/candidates/cand_spoof',
    actor: { uid: 'rec_01', email: 'rec@company.my', emailVerified: true, role: 'recruiter' },
    payload: { ownerId: 'different_uid' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'PDPA Audit Log Tampering / Deletion',
    pillar: 'Immutable Audit Compliance',
    operation: 'delete',
    path: '/auditLogs/log_001',
    actor: { uid: 'admin_01', email: 'wangtjw2026@gmail.com', emailVerified: true, role: 'hr_admin' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Terminal Offer State Override by Non-Admin',
    pillar: 'Phase 4.6 (Terminal State Locking)',
    operation: 'update',
    path: '/candidates/cand_accepted',
    actor: { uid: 'rec_01', email: 'rec@company.my', emailVerified: true, role: 'recruiter' },
    payload: { status: 'offer_rejected' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Client-Forged Timestamp on Create',
    pillar: 'Phase 4.13 (Temporal Integrity)',
    operation: 'create',
    path: '/candidates/cand_time',
    actor: { uid: 'rec_01', email: 'rec@company.my', emailVerified: true, role: 'recruiter' },
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
];
