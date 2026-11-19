# TalentFlow MY — Firestore Security Specification (Phase 0 TDD)

## 1. Core Data Invariants
1. **Master Gate & Zero-Trust Default**: All unspecified paths default-deny (`allow read, write: if false`). Every write requires verified authentication (`request.auth != null && request.auth.token.email_verified == true`).
2. **PDPA Split-Collection Isolation**:
   - Raw candidate PII (`email`, `phone`, academic file names) lives strictly in `/candidates/{candidateId}/private/pii` and is inaccessible to `hiring_manager` users.
   - MYR salary & offer compensation lives strictly in `/candidates/{candidateId}/private/compensation` and is accessible ONLY to `hr_admin` (or the bootstrapped workspace admin).
   - Every access to `/candidates/{candidateId}/private/*` validates parent `/candidates/{candidateId}` existence via `get()`.
3. **RBAC Privilege Escalation Prevention**:
   - Users creating their own `/users/{userId}` document CANNOT assign `role == 'hr_admin'` unless they are the bootstrapped admin.
   - Users updating their own `/users/{userId}` document CANNOT alter `role`, `uid`, `email`, or `createdAt`.
   - Only `isHrAdmin()` can write to `/admins/{userId}` or modify staff roles.
4. **Atomic Interview Slot Booking**:
   - Booking an interview slot updates `/interviewSlots/{slotId}` from `status == 'available'` to `status == 'booked'` and atomically verifies via `getAfter()` that `/candidates/{candidateId}` links to `interviewSlotId == slotId`.
5. **Terminal State Locking**:
   - Once a candidate reaches a terminal outcome (`offer_accepted`, `offer_rejected`, `offer_expired`, `rejected_screening`, `not_qualified`, `rejected_post_interview`), non-admin users cannot mutate the record further.
6. **Immutable Audit & Email Logs**:
   - `/auditLogs/{logId}` and `/emailLogs/{logId}` are strictly append-only (`allow update, delete: if false`).
7. **Temporal Integrity**:
   - All `createdAt` and `updatedAt` fields must equal `request.time` via Firestore `serverTimestamp()`.
8. **Secure List Queries (Zero `get()` in `allow list`)**:
   - Every `allow list` validates `isBootstrappedAdmin() || resource.data.ownerId == request.auth.uid || request.auth.uid in resource.data.assignedStaffIds` without any `get()` or `exists()` reads.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Self-Admin Escalation**: Unprivileged user creates `/users/{uid}` with `role: "hr_admin"`.
2. **Ghost / Shadow Field Injection**: Authenticated user updates `/candidates/{id}` adding an undeclared field `isVerified: true`.
3. **Unverified Email Spoofing**: Request with `request.auth.token.email == "wangtjw2026@gmail.com"` but `email_verified: false`.
4. **Hiring Manager PII Breach**: User with `role: "hiring_manager"` attempts `get` on `/candidates/{id}/private/pii`.
5. **Recruiter Salary Breach**: User with `role: "recruiter"` attempts `get` on `/candidates/{id}/private/compensation`.
6. **ID Poisoning Attack**: Create `/candidates/{1500-char-invalid-id}` with junk characters failing `isValidId()`.
7. **Denial-of-Wallet String Overflow**: Create `/candidates/{id}` with `aiSummary` exceeding 1200 characters.
8. **Unbounded Array Injection**: Create `/candidates/{id}` with `skills` array containing 25 elements (limit 20).
9. **Identity Spoofing on Create**: User A attempts to create `/candidates/{id}` with `ownerId: "userB"`.
10. **Audit Log Tampering**: Any user (even admin) attempts `update` or `delete` on `/auditLogs/{logId}`.
11. **Terminal State Override by Non-Admin**: Recruiter attempts to update a candidate whose `status == "offer_accepted"`.
12. **Client Timestamp Forgery**: Create `/candidates/{id}` with client-supplied `createdAt` instead of `request.time`.
