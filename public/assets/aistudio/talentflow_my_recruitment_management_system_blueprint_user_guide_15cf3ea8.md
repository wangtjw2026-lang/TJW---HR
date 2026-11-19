# TalentFlow MY — Enterprise Recruitment Management System (ATS)

## 1. Executive Summary
**TalentFlow MY** is an end-to-end Recruitment Management System designed for Malaysian HR teams to manage the complete 15-stage hiring lifecycle—from initial resume intake (**JobStreet** and **Email**) through AI-assisted screening, automated Google Apps Script form dispatch, Malaysian academic credential verification (**SPM, UEC, University Degree, Transcript**), self-service interview booking, and final employment offer acceptance.

---

## 2. Complete 15-Stage Recruitment Workflow

| Stage | Workflow Milestone | System Automation & HR Actions |
| :--- | :--- | :--- |
| **1** | **Receive Resume** | Intake applications from **JobStreet** or **Email**. |
| **2** | **Register Candidate** | Upload resume file or paste text; **Gemini AI** extracts contact info, education, experience, skills, and calculates a job-fit match score (`0–100%`). Prevents duplicate records by email/phone. |
| **3** | **Initial Resume Screening** | HR reviews candidate summary and AI scorecard on the screening dashboard. |
| **4** | **HR Screening Decision** | Choose **Proceed to Next Stage**, **Reject Candidate** (with mandatory rejection reason), or **Pending Review**. |
| **5** | **Auto-Send Forms & Links** | Selecting *Proceed to Next Stage* triggers an automated email with direct links to the **Employment Application Form** and **DISC Personality Assessment**. |
| **6** | **Collect Academic Docs** | Candidate submits **SPM**, **UEC** (if applicable), **University Degree Certificate**, and **University Academic Transcript**. Automated reminder emails can be sent for missing items. |
| **7** | **HR Document Review** | HR verifies completion of Google Apps Script forms, DISC profile, and uploaded PDFs. |
| **8** | **Qualification Decision** | HR classifies candidate as **Qualified** or **Not Qualified** with evaluation remarks. |
| **9** | **Send Interview Invite** | Qualified candidates automatically receive an interview self-scheduling invitation. |
| **10** | **Candidate Slot Selection** | Candidate selects an available date and time slot via the self-service portal. Atomic slot locking prevents double-booking, and an automatic confirmation email is sent. |
| **11** | **Conduct Interview** | HR and Hiring Managers view confirmed appointments on the calendar and conduct the interview. |
| **12** | **Post-Interview Decision** | Record panel feedback and select **Offer Employment**, **Reject Candidate**, or **Pending Decision**. |
| **13** | **Send Employment Offer** | Generate and send offer details (Position, Department, Salary in **MYR**, Start Date, Deadline, Offer Letter PDF). |
| **14** | **Track Offer Response** | Monitor status across `Offer Sent`, `Pending Response`, `Accepted`, `Rejected`, and `Expired`. |
| **15** | **Final Status Recorded** | Candidate confirms acceptance or rejection via online link or HR updates the final status. |

---

## 3. Integrated Google Apps Script Forms

When a candidate is shortlisted (**Stage 5**), the system automatically dispatches the following official assessment links:

* **A. Employment Application Form:**
  `https://script.google.com/macros/s/AKfycbzmwDILioaOGbozPl9t13wCJLpdF_T99WHAglBDJJXvEZTmWIt2oilSNYLyyatK6cG0/exec`
* **B. DISC Personality Assessment Form:**
  `https://script.google.com/macros/s/AKfycby-lUFDHSd2NmbiS3Gbg8Y22Ql8smy3XjatCdIs3s5AZ2yeqTBUB6dBQbhgt5EpDt1W/exec`

### Required Academic Document Checklist
1. **SPM Examination Results** (Mandatory)
2. **UEC Examination Results** (If applicable)
3. **University Degree Certificate** (Mandatory)
4. **University Academic Transcript** (Mandatory)

---

## 4. Recommended Production Backend & Security Architecture

To run this application in production with full email automation, candidate self-scheduling, and Malaysian **Personal Data Protection Act (PDPA)** compliance, the following cloud architecture is implemented and recommended:

1. **Database & Real-Time Sync (`Cloud Firestore`)**
   * Stores candidate profiles, checklist states, email audit logs, and interview slots.
   * Uses atomic transactions when candidates reserve interview slots to guarantee zero double-booking.
2. **File Storage (`Firebase Cloud Storage`)**
   * Stores uploaded resumes, SPM/UEC certificates, university scrolls, transcripts, and signed offer letters in encrypted buckets.
   * Access is governed by signed, time-limited URLs.
3. **Email Automation & Scheduled Reminders (`Cloud Functions + Resend / SendGrid`)**
   * Event-driven triggers fire transactional emails immediately upon stage transitions (Shortlisted, Interview Invite, Booking Confirmation, Offer Sent).
   * Scheduled cron jobs check candidates in `shortlisted_docs` every 48 hours and dispatch automated reminder emails for outstanding documents.
4. **Role-Based Access Control (RBAC) & PDPA Compliance**
   * **HR Admin:** Full access to all candidate PII, academic transcripts, salary packages, offer letters, and Excel/CSV exports.
   * **Recruiter:** Operational access to screening, document verification, and interview scheduling; salary fields are masked.
   * **Hiring Manager:** Restricted access to interview schedules and evaluation scorecards; raw academic certificates and salary figures are masked.
   * Every view or update of sensitive candidate records is logged in the **PDPA Security Audit Log**.

---

## 5. Dashboard KPIs & Reporting Capabilities

The **Executive Dashboard** tracks all 15 real-time metrics:
* Total Applications Received
* New Candidates
* Pending Resume Screening
* Shortlisted Candidates
* Rejected Candidates
* Pending Documents
* Qualified Candidates
* Not Qualified Candidates
* Interview Invitations Sent
* Confirmed Interviews
* Pending Interview Evaluations
* Employment Offers Sent
* Offers Accepted
* Offers Rejected
* Pending Offer Responses

### Filtering & Excel Export
HR personnel can filter the candidate database by **Application Date**, **Position Applied For**, **Department**, **Application Source (`JobStreet` / `Email`)**, **Recruitment Stage**, **Candidate Status**, **Interview Date**, and **Offer Status**, and export the filtered dataset to an **Excel-compatible CSV report** with one click.