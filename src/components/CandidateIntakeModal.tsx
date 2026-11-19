import React, { useState } from 'react';
import { AlertCircle, FileUp, Sparkles, X, CheckCircle2 } from 'lucide-react';
import {
  ApplicationSource,
  CandidateRecord,
  DEPARTMENTS,
  ParsedResumeResult,
  POSITIONS,
  StaffUser,
} from '../types/ats';
import { hashContactValue } from '../lib/atsHelpers';
import { registerCandidate } from '../lib/firestoreService';

interface CandidateIntakeModalProps {
  actor: StaffUser;
  existingCandidates: CandidateRecord[];
  onClose: () => void;
  onRegistered: (candidateId: string) => void;
}

const SAMPLE_RESUME_TEXT = `AMIRUL HAKIM BIN ZULKIFLI
Petaling Jaya, Selangor | +60 12-648 7721 | amirul.hakim.dev@gmail.com

EDUCATION
- Bachelor of Computer Science (Hons), Universiti Teknologi Malaysia (UTM), CGPA 3.74 (2018 - 2022)
- SPM: 8A 1B, SMK Bandar Utama Damansara (2016)

EXPERIENCE
Full-Stack Software Engineer — FinCore Sdn Bhd, Kuala Lumpur (2022 - Present, 4 years)
- Built React, TypeScript, and Node.js enterprise banking portals serving 180k Malaysian SMEs.
- Designed Cloud Firestore real-time ledgers and PostgreSQL reporting pipelines.
- Led PDPA encryption compliance and automated CI/CD on Google Cloud Run.

SKILLS
TypeScript, React, Node.js, Express, Firebase, PostgreSQL, Tailwind CSS, REST APIs, Git`;

export const CandidateIntakeModal: React.FC<CandidateIntakeModalProps> = ({
  actor,
  existingCandidates,
  onClose,
  onRegistered,
}) => {
  const [source, setSource] = useState<ApplicationSource>('JobStreet');
  const [positionApplied, setPositionApplied] = useState<string>(POSITIONS[0]);
  const [department, setDepartment] = useState<string>(DEPARTMENTS[0]);
  const [jobRequirements, setJobRequirements] = useState<string>(
    '3+ years relevant experience, strong Malaysian corporate communication, recognized University Degree & SPM/UEC results.'
  );

  const [resumeText, setResumeText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileBase64, setFileBase64] = useState('');
  const [fileMimeType, setFileMimeType] = useState('');

  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Extracted / editable registration fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('Kuala Lumpur, Malaysia');
  const [educationSummary, setEducationSummary] = useState('');
  const [experienceSummary, setExperienceSummary] = useState('');
  const [yearsExperience, setYearsExperience] = useState<number>(0);
  const [skillsText, setSkillsText] = useState('');
  const [aiMatchScore, setAiMatchScore] = useState<number>(75);
  const [aiSummary, setAiSummary] = useState('');
  const [hasUec, setHasUec] = useState(false);
  const [aiParsedDone, setAiParsedDone] = useState(false);

  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);

    if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
      const reader = new FileReader();
      reader.onload = () => {
        setResumeText(String(reader.result || ''));
        setFileBase64('');
        setFileMimeType('');
      };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        setFileBase64(base64);
        setFileMimeType(file.type || 'application/pdf');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyzeWithGemini = async () => {
    if (!resumeText.trim() && !fileBase64) {
      setParseError('Upload a resume file (PDF/Image/TXT) or paste resume text first.');
      return;
    }
    setParsing(true);
    setParseError(null);
    setDuplicateWarning(null);
    try {
      const res = await fetch('/api/gemini/parse-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeText: resumeText.trim() || undefined,
          fileBase64: fileBase64 || undefined,
          fileMimeType: fileMimeType || undefined,
          fileName: fileName || 'pasted_resume.txt',
          positionApplied,
          department,
          jobRequirements,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to analyze resume with Gemini AI.');
      }
      const parsed = data as ParsedResumeResult;
      setFullName(parsed.fullName);
      setEmail(parsed.email);
      setPhone(parsed.phone);
      setLocation(parsed.location || 'Kuala Lumpur, Malaysia');
      setEducationSummary(parsed.educationSummary);
      setExperienceSummary(parsed.experienceSummary);
      setYearsExperience(parsed.yearsExperience);
      setSkillsText(parsed.skills.join(', '));
      setAiMatchScore(parsed.aiMatchScore);
      setAiSummary(parsed.aiSummary);
      setHasUec(parsed.detectedUecMention);
      setAiParsedDone(true);

      // Immediate duplicate check by email / phone hash
      await checkDuplicates(parsed.email, parsed.phone);
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Gemini resume extraction failed.');
    } finally {
      setParsing(false);
    }
  };

  const checkDuplicates = async (emailVal: string, phoneVal: string): Promise<boolean> => {
    const eHash = emailVal.trim() ? await hashContactValue(emailVal) : '';
    const pHash = phoneVal.trim() ? await hashContactValue(phoneVal) : '';
    const dup = existingCandidates.find(
      (c) => (eHash && c.emailHash === eHash) || (pHash && c.phoneHash === pHash)
    );
    if (dup) {
      setDuplicateWarning(
        `Duplicate detected: ${dup.fullName} (${dup.candidateCode}) already exists in Stage ${dup.currentStage} with matching email or phone.`
      );
      return true;
    }
    setDuplicateWarning(null);
    return false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!fullName.trim() || !email.trim() || !phone.trim()) {
      setSubmitError('Full Name, Email, and Phone Number are required to register a candidate.');
      return;
    }

    const isDup = await checkDuplicates(email, phone);
    if (isDup) {
      setSubmitError('Duplicate candidate record blocked by email/phone uniqueness policy (Stage 2).');
      return;
    }

    setSubmitting(true);
    try {
      const skills = skillsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);

      const id = await registerCandidate({
        actor,
        fullName,
        email,
        phone,
        location,
        positionApplied,
        department,
        source,
        resumeFileName: fileName || 'pasted_resume.txt',
        resumeExcerpt: resumeText.slice(0, 3800) || `${educationSummary}\n${experienceSummary}`,
        educationSummary: educationSummary || 'Not specified',
        experienceSummary: experienceSummary || 'Not specified',
        yearsExperience,
        skills,
        aiMatchScore,
        aiSummary: aiSummary || 'Registered manually pending initial HR screening.',
        hasUec,
      });
      onRegistered(id);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to register candidate.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Stages 1–2 · Register Candidate & Gemini AI Resume Screening
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Intake from JobStreet or Email · Automatic extraction, 0–100% job-fit match score & duplicate prevention
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-6">
          {/* Step 1: Source & Target Role */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Application Source
              </label>
              <div className="flex gap-1 p-1 bg-slate-100 rounded-md">
                {(['JobStreet', 'Email'] as ApplicationSource[]).map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setSource(src)}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded transition-colors cursor-pointer ${
                      source === src
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {src}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Position Applied For
              </label>
              <select
                value={positionApplied}
                onChange={(e) => setPositionApplied(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
              >
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Department
              </label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Step 2: Upload Resume or Paste Text for Gemini AI Extraction */}
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Resume Input for Gemini AI Extraction
                </h3>
                <p className="text-xs text-slate-500">
                  Upload a PDF/image/text resume or paste CV content below to auto-populate and score candidate fit.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setResumeText(SAMPLE_RESUME_TEXT);
                  setFileName('Amirul_Hakim_CV.txt');
                }}
                className="text-xs font-medium text-teal-700 hover:text-teal-800 underline cursor-pointer"
              >
                Insert Sample Malaysian Resume
              </button>
            </div>

            <div className="grid sm:grid-cols-12 gap-4">
              <div className="sm:col-span-4 flex flex-col justify-between border border-dashed border-slate-300 rounded-md p-4 bg-slate-50">
                <div className="space-y-2">
                  <FileUp className="w-5 h-5 text-teal-700" />
                  <div className="text-xs font-semibold text-slate-800">Upload Resume File</div>
                  <p className="text-[11px] text-slate-500">
                    Supports PDF, PNG, JPG, or TXT up to 10MB.
                  </p>
                </div>
                <div className="mt-3">
                  <input
                    type="file"
                    accept=".pdf,.txt,.png,.jpg,.jpeg"
                    onChange={handleFileChange}
                    className="block w-full text-[11px] text-slate-600 file:mr-2 file:py-1.5 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-slate-200 file:text-slate-800 hover:file:bg-slate-300 cursor-pointer"
                  />
                  {fileName && (
                    <div className="text-[11px] font-mono text-teal-700 mt-1.5 truncate">
                      Selected: {fileName}
                    </div>
                  )}
                </div>
              </div>

              <div className="sm:col-span-8 space-y-2">
                <textarea
                  rows={5}
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  placeholder="Or paste raw resume text from JobStreet / Email here..."
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
                <input
                  type="text"
                  value={jobRequirements}
                  onChange={(e) => setJobRequirements(e.target.value)}
                  placeholder="Optional role criteria for AI match scoring..."
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:border-teal-700"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleAnalyzeWithGemini}
                disabled={parsing}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-md transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-teal-400" />
                <span>{parsing ? 'Analyzing Resume with Gemini AI...' : 'Extract & Score with Gemini AI'}</span>
              </button>

              {aiParsedDone && (
                <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Gemini extraction complete · Match Score: {aiMatchScore}%</span>
                </div>
              )}
            </div>

            {parseError && (
              <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{parseError}</span>
              </div>
            )}
          </div>

          {duplicateWarning && (
            <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{duplicateWarning}</span>
            </div>
          )}

          {/* Step 3: Candidate Profile & Scorecard Verification */}
          <div className="pt-4 border-t border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Candidate Record & AI Scorecard
              </h3>
              <span className="font-mono tabular-nums text-xs font-semibold text-teal-700">
                Job-Fit Score: {aiMatchScore} / 100%
              </span>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    void checkDuplicates(e.target.value, phone);
                  }}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Phone (MY) *</label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    void checkDuplicates(email, e.target.value);
                  }}
                  placeholder="+60 12-xxx xxxx"
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Location</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Years Experience</label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  step={0.5}
                  value={yearsExperience}
                  onChange={(e) => setYearsExperience(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">AI Match Score (0–100%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={aiMatchScore}
                  onChange={(e) => setAiMatchScore(Math.max(0, Math.min(100, Number(e.target.value))))}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasUec}
                    onChange={(e) => setHasUec(e.target.checked)}
                    className="rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                  />
                  <span>Candidate holds UEC (require UEC cert in Stage 6)</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Extracted Skills (comma-separated)
              </label>
              <input
                type="text"
                value={skillsText}
                onChange={(e) => setSkillsText(e.target.value)}
                placeholder="TypeScript, React, ACCA, MFRS, Employment Act 1955..."
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Education Summary (SPM / UEC / Degree)
                </label>
                <textarea
                  rows={2}
                  value={educationSummary}
                  onChange={(e) => setEducationSummary(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Experience Summary
                </label>
                <textarea
                  rows={2}
                  value={experienceSummary}
                  onChange={(e) => setExperienceSummary(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                AI Screening Rationale
              </label>
              <textarea
                rows={2}
                value={aiSummary}
                onChange={(e) => setAiSummary(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
              />
            </div>
          </div>

          {submitError && (
            <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
              {submitError}
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || Boolean(duplicateWarning)}
              className="px-5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-md transition-colors cursor-pointer"
            >
              {submitting ? 'Registering Candidate...' : 'Register Candidate (Stage 3 Screening)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
