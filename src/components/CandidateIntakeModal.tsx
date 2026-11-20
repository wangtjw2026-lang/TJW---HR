import React, { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileUp, Loader2, Sparkles, X } from 'lucide-react';
import {
  ApplicationSource,
  CandidateRecord,
  DEPARTMENTS,
  POSITIONS,
} from '../types/ats';
import { parseResumeWithAi, registerCandidate } from '../lib/apiService';

interface CandidateIntakeModalProps {
  existingCandidates: CandidateRecord[];
  onClose: () => void;
  onRegistered: (candidate: CandidateRecord) => void;
}

function normalizePhone(val: string): string {
  return val.replace(/[\s\-()]/g, '').toLowerCase();
}

function inferYearsFromText(text: string): number {
  const match = text.match(/(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)/i);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(60, parsed)) : 0;
}

export const CandidateIntakeModal: React.FC<CandidateIntakeModalProps> = ({
  existingCandidates,
  onClose,
  onRegistered,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [source, setSource] = useState<ApplicationSource>('JobStreet');
  const [positionApplied, setPositionApplied] = useState<string>(POSITIONS[0]);
  const [department, setDepartment] = useState<string>(DEPARTMENTS[0]);
  const [rubric, setRubric] = useState<string>(
    '3+ years relevant experience, strong Malaysian corporate communication, recognized University Degree & SPM/UEC results.'
  );

  const [resumeText, setResumeText] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseSuccess, setParseSuccess] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [educationSummary, setEducationSummary] = useState('');
  const [experienceSummary, setExperienceSummary] = useState('');
  const [yearsExperience, setYearsExperience] = useState<number>(0);
  const [skillsText, setSkillsText] = useState('');
  const [aiMatchScore, setAiMatchScore] = useState<number | null>(null);
  const [aiSummary, setAiSummary] = useState('');
  const [hasUec, setHasUec] = useState(false);

  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const checkDuplicates = (emailVal: string, phoneVal: string): boolean => {
    const cleanEmail = emailVal.trim().toLowerCase();
    const cleanPhone = normalizePhone(phoneVal);
    const dup = existingCandidates.find(
      (c) =>
        (cleanEmail && c.email.toLowerCase() === cleanEmail) ||
        (cleanPhone.length >= 7 && normalizePhone(c.phone) === cleanPhone)
    );
    if (dup) {
      setDuplicateWarning(
        `Duplicate detected: ${dup.full_name} (${dup.candidate_code}) already exists in Stage ${dup.stage} with matching email or phone.`
      );
      return true;
    }
    setDuplicateWarning(null);
    return false;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResumeFile(file);
    setFileName(file.name);
    setParseError(null);
    setParseSuccess(null);

    if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
      const reader = new FileReader();
      reader.onload = () => {
        setResumeText(String(reader.result || ''));
      };
      reader.readAsText(file);
    }
  };

  const handleClearFile = () => {
    setResumeFile(null);
    setFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAnalyzeResume = async () => {
    if (!resumeFile && !resumeText.trim()) {
      setParseError('Please upload a resume file (PDF, PNG, JPG, or TXT) or paste resume text first.');
      setParseSuccess(null);
      return;
    }

    setIsAnalyzing(true);
    setParseError(null);
    setParseSuccess(null);
    setDuplicateWarning(null);

    try {
      const data = await parseResumeWithAi({
        file: resumeFile,
        resumeText: resumeText.trim() || undefined,
        position: positionApplied,
        department,
        rubric: rubric.trim() || undefined,
      });

      const extractedName = String(data.full_name || data.fullName || data.name || '').trim();
      const extractedEmail = String(data.email || '').trim();
      const extractedPhone = String(data.phone || data.contact_number || '').trim();
      const extractedLocation = String(data.location || '').trim();
      const extractedEducation = String(data.education || data.educationSummary || '').trim();
      const extractedExperience = String(data.experience || data.experienceSummary || '').trim();
      const extractedSkills = Array.isArray(data.skills)
        ? data.skills.map((s) => String(s).trim()).filter(Boolean)
        : [];
      const rawScore = data.ai_score ?? data.aiMatchScore;
      const extractedScore =
        typeof rawScore === 'number' && !Number.isNaN(rawScore)
          ? Math.max(0, Math.min(100, Math.round(rawScore)))
          : null;
      const extractedSummary = String(data.ai_summary || data.aiSummary || '').trim();
      const rawYears = data.years_experience ?? data.yearsExperience;
      const extractedYears =
        typeof rawYears === 'number' && !Number.isNaN(rawYears) && rawYears > 0
          ? Math.max(0, Math.min(60, rawYears))
          : inferYearsFromText(extractedExperience);
      const extractedUec =
        Boolean(data.detected_uec_mention ?? data.detectedUecMention) ||
        /\buec\b/i.test(`${extractedEducation} ${resumeText}`);

      setFullName(extractedName);
      setEmail(extractedEmail);
      setPhone(extractedPhone);
      setLocation(extractedLocation);
      setEducationSummary(extractedEducation);
      setExperienceSummary(extractedExperience);
      setYearsExperience(extractedYears);
      setSkillsText(extractedSkills.join(', '));
      setAiMatchScore(extractedScore);
      setAiSummary(extractedSummary);
      setHasUec(extractedUec);

      checkDuplicates(extractedEmail, extractedPhone);

      const filledCount = [
        extractedName,
        extractedEmail,
        extractedPhone,
        extractedLocation,
        extractedEducation,
        extractedExperience,
        extractedSkills.length > 0 ? 'skills' : '',
        extractedSummary,
      ].filter(Boolean).length;

      setParseSuccess(
        `Gemini AI extracted ${filledCount} profile fields and auto-filled the form below${
          extractedScore !== null ? ` · Job-Fit Score: ${extractedScore}%` : ''
        }.`
      );
    } catch (err: unknown) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'Gemini AI resume analysis failed. Please check the file and try again.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!fullName.trim() || !email.trim() || !phone.trim()) {
      setSubmitError('Full Name, Email, and Phone Number are required to register a candidate.');
      return;
    }
    if (checkDuplicates(email, phone)) {
      setSubmitError('Duplicate candidate record blocked by email/phone uniqueness policy.');
      return;
    }

    setSubmitting(true);
    try {
      const skills = skillsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);

      const created = await registerCandidate({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        location: location.trim() || 'Malaysia',
        positionApplied,
        department,
        source,
        educationSummary: educationSummary.trim() || 'Not specified',
        experienceSummary: experienceSummary.trim() || 'Not specified',
        yearsExperience,
        skills,
        aiMatchScore: aiMatchScore ?? 0,
        aiSummary: aiSummary.trim() || 'Registered manually pending initial HR screening.',
        hasUec,
        resumeFile,
        resumeFileName: fileName || 'pasted_resume.txt',
      });
      onRegistered(created);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to register candidate.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Stages 1–2 · Register Candidate & Gemini AI Resume Screening
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Intake from JobStreet or Email · Stores resume in local uploads/, runs Gemini AI extraction & prevents duplicates
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

        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-6">
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

          <div className="pt-4 border-t border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Resume Input for Gemini AI Extraction
                </h3>
                <p className="text-xs text-slate-500">
                  Upload a PDF, image, or text resume (or paste CV content), then run Gemini AI to auto-fill all candidate fields below.
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-12 gap-4">
              <div className="sm:col-span-4 flex flex-col justify-between border border-dashed border-slate-300 rounded-md p-4 bg-slate-50">
                <div className="space-y-2">
                  <FileUp className="w-5 h-5 text-teal-700" />
                  <div className="text-xs font-semibold text-slate-800">Upload Resume File</div>
                  <p className="text-[11px] text-slate-500">
                    Supports PDF, PNG, JPG, WEBP, or TXT up to 15MB.
                  </p>
                </div>
                <div className="mt-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,.png,.jpg,.jpeg,.webp"
                    onChange={handleFileChange}
                    className="block w-full text-[11px] text-slate-600 file:mr-2 file:py-1.5 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-slate-200 file:text-slate-800 hover:file:bg-slate-300 cursor-pointer"
                  />
                  {fileName && (
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-teal-700 truncate">
                        Selected: {fileName}
                      </span>
                      <button
                        type="button"
                        onClick={handleClearFile}
                        className="text-[11px] text-slate-500 hover:text-red-600 underline shrink-0 cursor-pointer"
                      >
                        Clear
                      </button>
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
                  value={rubric}
                  onChange={(e) => setRubric(e.target.value)}
                  placeholder="Optional screening rubric / role criteria for AI match scoring..."
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:border-teal-700"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleAnalyzeResume}
                disabled={isAnalyzing}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-md transition-colors cursor-pointer"
              >
                {isAnalyzing ? (
                  <Loader2 className="w-4 h-4 text-teal-400 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 text-teal-400" />
                )}
                <span>
                  {isAnalyzing ? 'Analyzing Resume with Gemini AI...' : 'Analyze Resume with Gemini AI'}
                </span>
              </button>
            </div>

            {parseSuccess && (
              <div
                role="status"
                className="p-3 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md flex items-start gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <span>{parseSuccess}</span>
              </div>
            )}

            {parseError && (
              <div
                role="alert"
                className="p-3 text-xs text-red-900 bg-red-50 border border-red-300 rounded-md flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Gemini AI Extraction Error</div>
                  <div className="mt-0.5">{parseError}</div>
                </div>
              </div>
            )}
          </div>

          {duplicateWarning && (
            <div
              role="alert"
              className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{duplicateWarning}</span>
            </div>
          )}

          <div className="pt-4 border-t border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Candidate Record & AI Scorecard
              </h3>
              <span
                className={`font-mono tabular-nums text-xs font-semibold ${
                  aiMatchScore !== null ? 'text-teal-700' : 'text-slate-500'
                }`}
              >
                Job-Fit Score: {aiMatchScore !== null ? `${aiMatchScore} / 100%` : 'Not Scored'}
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
                  placeholder="Candidate full name"
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
                    checkDuplicates(e.target.value, phone);
                  }}
                  placeholder="candidate@email.com"
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
                    checkDuplicates(email, e.target.value);
                  }}
                  placeholder="01X-XXXXXXX"
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Location</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Kuala Lumpur / Selangor"
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
                  onChange={(e) => setYearsExperience(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">AI Match Score (0–100%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={aiMatchScore ?? ''}
                  placeholder="Not Scored"
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setAiMatchScore(null);
                    } else {
                      setAiMatchScore(Math.max(0, Math.min(100, Math.round(Number(val)))));
                    }
                  }}
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
