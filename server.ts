import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'talentflow-my' });
  });

  // Stage 2: Gemini AI Resume Parser & Job-Fit Scorecard
  app.post('/api/gemini/parse-resume', async (req, res) => {
    try {
      const {
        resumeText,
        fileBase64,
        fileMimeType,
        fileName,
        positionApplied,
        department,
        jobRequirements,
      } = req.body ?? {};

      if (!resumeText && !fileBase64) {
        res.status(400).json({ error: 'Please provide either resume text or an uploaded resume file.' });
        return;
      }

      const ai = getGeminiClient();

      const prompt = [
        'You are an experienced Malaysian enterprise HR recruitment specialist.',
        `Analyze the candidate resume for the role "${positionApplied || 'General Role'}" in the "${department || 'Operations'}" department.`,
        jobRequirements ? `Role requirements / criteria: ${jobRequirements}` : '',
        'Extract structured candidate data accurately. If Malaysian academic qualifications (SPM, STPM, UEC, Matrikulasi, Diploma, Bachelor/Master Degree, CGPA) appear in the resume, highlight them clearly in educationSummary.',
        'Compute a realistic job-fit match score from 0 to 100 based on skill alignment, relevant years of experience, and qualification fit.',
        'Keep all text fields concise and professional: fullName (<=120 chars), email, phone, location, educationSummary (<=500 chars), experienceSummary (<=700 chars), aiSummary (<=1000 chars), skills (max 12 crisp skill names, each <=40 chars).',
      ]
        .filter(Boolean)
        .join('\n');

      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

      if (fileBase64 && fileMimeType) {
        parts.push({
          inlineData: {
            mimeType: fileMimeType,
            data: fileBase64,
          },
        });
      }

      parts.push({
        text: resumeText
          ? `${prompt}\n\nCandidate Resume (${fileName || 'Pasted Text'}):\n${resumeText}`
          : `${prompt}\n\nExtract all details from the attached resume file (${fileName || 'uploaded resume'}).`,
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction:
            'Return strictly valid JSON adhering to the provided schema. Never invent contact info that is not present; if phone or email is missing, return an empty string.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              fullName: { type: Type.STRING, description: 'Candidate full name' },
              email: { type: Type.STRING, description: 'Candidate email address if found, else empty string' },
              phone: { type: Type.STRING, description: 'Candidate phone number (Malaysian format preferred) if found, else empty string' },
              location: { type: Type.STRING, description: 'City / State in Malaysia or current location' },
              educationSummary: { type: Type.STRING, description: 'Summary of University Degree, CGPA, SPM/UEC qualifications' },
              experienceSummary: { type: Type.STRING, description: 'Summary of key roles, employers, and accomplishments' },
              yearsExperience: { type: Type.NUMBER, description: 'Total relevant years of working experience (0 to 50)' },
              skills: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Up to 12 key technical and domain skills',
              },
              aiMatchScore: { type: Type.INTEGER, description: 'Job-fit score from 0 to 100' },
              aiSummary: { type: Type.STRING, description: 'Concise HR screening assessment covering strengths, gaps, and recommendation' },
              detectedSpmMention: { type: Type.BOOLEAN, description: 'Whether SPM qualification is mentioned' },
              detectedUecMention: { type: Type.BOOLEAN, description: 'Whether UEC qualification is mentioned' },
              detectedDegreeMention: { type: Type.BOOLEAN, description: 'Whether University Degree is mentioned' },
            },
            required: [
              'fullName',
              'email',
              'phone',
              'location',
              'educationSummary',
              'experienceSummary',
              'yearsExperience',
              'skills',
              'aiMatchScore',
              'aiSummary',
              'detectedSpmMention',
              'detectedUecMention',
              'detectedDegreeMention',
            ],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini AI returned an empty extraction response.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      res.json({
        fullName: String(parsed.fullName ?? '').slice(0, 140),
        email: String(parsed.email ?? '').trim().slice(0, 254),
        phone: String(parsed.phone ?? '').trim().slice(0, 40),
        location: String(parsed.location ?? 'Kuala Lumpur, Malaysia').slice(0, 120),
        educationSummary: String(parsed.educationSummary ?? '').slice(0, 600),
        experienceSummary: String(parsed.experienceSummary ?? '').slice(0, 800),
        yearsExperience: Math.max(0, Math.min(60, Number(parsed.yearsExperience) || 0)),
        skills: Array.isArray(parsed.skills)
          ? parsed.skills.map((s: unknown) => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 20)
          : [],
        aiMatchScore: Math.max(0, Math.min(100, Math.round(Number(parsed.aiMatchScore) || 0))),
        aiSummary: String(parsed.aiSummary ?? '').slice(0, 1200),
        detectedSpmMention: Boolean(parsed.detectedSpmMention),
        detectedUecMention: Boolean(parsed.detectedUecMention),
        detectedDegreeMention: Boolean(parsed.detectedDegreeMention),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to parse resume with Gemini AI.';
      console.error('Gemini resume parse error:', err);
      res.status(500).json({ error: message });
    }
  });

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
    console.log(`TalentFlow MY server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
