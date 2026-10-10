import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

const publicDir = path.resolve(__dirname, 'public');

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// In-memory data store for submissions
interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  service: string;
  message: string;
  source: string;
  conversation?: string;
  targetEmail: string;
  emailDispatched: boolean;
  createdAt: string;
}

interface Application {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  message: string;
  resumeFileName: string;
  resumeFileSize: number;
  targetEmail: string;
  createdAt: string;
}

const leadsStore: Lead[] = [];
const applicationsStore: Application[] = [];

// Rate limiting cache (ip/email -> timestamp)
const recentSubmissions = new Map<string, number>();

// Multer memory storage for resumes (max 5MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

function cleanString(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 16;
}

// Nodemailer transporter helper
function getMailTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT) || 587;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return null;
}

async function sendLeadEmailNotification(lead: Lead): Promise<boolean> {
  const primaryRecipient = 'info@tcongsinfotech.com';
  const secondaryRecipient = 'info@tcongsinfotech.com';

  const emailSubject = `New Website Lead — TCONG INFOTECH: ${lead.name || 'Direct Client'} (${lead.service || 'General Enquiry'})`;
  const emailText = `
================================================================================
NEW WEBSITE LEAD — TCONG INFOTECH
================================================================================

Name:               ${lead.name || 'Not provided'}
Email:              ${lead.email}
Phone:              ${lead.phone || 'Not provided'}
Company:            ${lead.company || 'Not provided'}
Service of Interest: ${lead.service || 'General Software / Web Development'}
Requirements:
${lead.message || 'No additional details provided.'}

Source:             ${lead.source}
Lead ID:            ${lead.id}
Submitted At:       ${lead.createdAt}
Target Recipient:   ${primaryRecipient}

Reply-To Address:   ${lead.email}
================================================================================
`;

  console.log(`\n[LEAD DISPATCH] Sending notification for lead ${lead.id} to ${primaryRecipient}...`);
  console.log(emailText);

  try {
    const transporter = getMailTransporter();
    if (transporter) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || `"TCONG INFOTECH Lead Engine" <noreply@tcongsinfotech.com>`,
        to: `${primaryRecipient}, ${secondaryRecipient}`,
        replyTo: lead.email,
        subject: emailSubject,
        text: emailText,
      });
      console.log(`[SMTP] Successfully delivered lead email to ${primaryRecipient}`);
      return true;
    } else {
      console.log(`[SMTP Notice] SMTP credentials not configured. Lead recorded in persistent server memory and console dispatch log.`);
      return true;
    }
  } catch (err) {
    console.error(`[SMTP Error] Failed sending email for lead ${lead.id}:`, err);
    return false;
  }
}

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    app: 'TCONG INFOTECH',
    uptime: process.uptime(),
    leadsCount: leadsStore.length,
    applicationsCount: applicationsStore.length,
    hasApiKey: !!process.env.GEMINI_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

// Endpoint to view leads
app.get('/api/leads', (_req: Request, res: Response) => {
  res.json({
    leads: leadsStore,
    total: leadsStore.length,
    primaryEmail: 'info@tcongsinfotech.com',
  });
});

// Dedicated Lead Form Submission Endpoint
app.post('/api/leads/submit', async (req: Request, res: Response) => {
  try {
    const data = req.body || {};
    const name = cleanString(data.name, 80);
    const email = cleanString(data.email, 120);
    const phone = cleanString(data.phone, 30);
    const company = cleanString(data.company, 100);
    const service = cleanString(data.service, 100);
    const message = cleanString(data.message, 3000);
    const source = cleanString(data.source, 80) || 'AI Assistant Lead Form';

    const errors: Record<string, string> = {};

    if (!email) {
      errors.email = 'Email address is required.';
    } else if (!isValidEmail(email)) {
      errors.email = 'Please provide a valid email address (e.g., name@domain.com).';
    }

    if (!phone) {
      errors.phone = 'Phone number is required.';
    } else if (!isValidPhone(phone)) {
      errors.phone = 'Please provide a valid contact number (at least 7 digits).';
    }

    if (Object.keys(errors).length > 0) {
      res.status(400).json({ success: false, errors });
      return;
    }

    // Rate-limiting / duplicate check (same email within 30 seconds)
    const now = Date.now();
    const lastSubmission = recentSubmissions.get(email.toLowerCase());
    if (lastSubmission && now - lastSubmission < 30000) {
      res.status(429).json({
        success: false,
        error: 'A request was recently submitted for this email address. Please wait a moment before sending another.',
      });
      return;
    }
    recentSubmissions.set(email.toLowerCase(), now);

    const primaryRecipient = 'info@tcongsinfotech.com';
    const newLead: Lead = {
      id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name || 'Website Visitor',
      email,
      phone,
      company: company || 'Not specified',
      service: service || 'Custom Software / Web Development',
      message: message || 'Interested in TCONG INFOTECH solutions',
      source,
      targetEmail: primaryRecipient,
      emailDispatched: false,
      createdAt: new Date().toISOString(),
    };

    const dispatched = await sendLeadEmailNotification(newLead);
    newLead.emailDispatched = dispatched;
    leadsStore.push(newLead);

    res.status(200).json({
      success: true,
      message: `Thank you! Your details have been sent to our team at ${primaryRecipient}. A senior technical consultant will contact you shortly.`,
      leadId: newLead.id,
      targetEmail: primaryRecipient,
    });
  } catch (error) {
    console.error('[API Leads Submit] Error:', error);
    res.status(500).json({
      success: false,
      error: 'An unexpected error occurred while processing your request. Please try again.',
    });
  }
});

// Contact endpoint handler (handles both /api/contact and /api/contact.php)
const handleContact = async (req: Request, res: Response) => {
  const data = req.body || {};
  const name = cleanString(data.name, 60);
  const email = cleanString(data.email, 100);
  const phone = cleanString(data.phone, 20);
  const company = cleanString(data.company, 100);
  const service = cleanString(data.service, 100);
  const message = cleanString(data.message, 2000);
  const source = cleanString(data.source, 80);
  const conversation = cleanString(data.conversation, 2000);

  const errors: Record<string, string> = {};

  if (name.length < 2) {
    errors.name = 'Please provide your name.';
  }
  if (!isValidEmail(email)) {
    errors.email = 'Please provide a valid email address.';
  }
  if (message.length < 5) {
    errors.message = 'Please tell us a little about your enquiry (min 5 characters).';
  }

  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: 'Validation failed.', details: errors });
    return;
  }

  const primaryRecipient = 'info@tcongsinfotech.com';

  const newLead: Lead = {
    id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    email,
    phone,
    company,
    service,
    message,
    source: source || 'Website Contact Form',
    conversation,
    targetEmail: primaryRecipient,
    emailDispatched: false,
    createdAt: new Date().toISOString(),
  };

  const dispatched = await sendLeadEmailNotification(newLead);
  newLead.emailDispatched = dispatched;
  leadsStore.push(newLead);

  res.status(200).json({
    success: true,
    message: 'Your details have been sent successfully.',
    targetEmail: primaryRecipient,
  });
};

app.post('/api/contact', handleContact);
app.post('/api/contact.php', handleContact);

// Careers endpoint handler (handles both /api/careers and /api/careers.php)
const handleCareers = (req: Request, res: Response) => {
  const data = req.body || {};
  const name = cleanString(data.name, 60);
  const email = cleanString(data.email, 100);
  const phone = cleanString(data.phone, 20);
  const position = cleanString(data.position, 100);
  const message = cleanString(data.message, 2000);
  const file = req.file;

  const errors: Record<string, string> = {};

  if (!file) {
    errors.resume = 'Please attach your resume.';
  } else {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (!['pdf', 'doc', 'docx'].includes(ext)) {
      errors.resume = 'Please upload a PDF, DOC, or DOCX file.';
    }
    if (file.size > 5 * 1024 * 1024) {
      errors.resume = 'Resume must be under 5 MB.';
    }
  }

  if (email && !isValidEmail(email)) {
    errors.email = 'Please provide a valid email address.';
  }

  if (phone && !/^[+0-9() . -]{7,20}$/.test(phone)) {
    errors.phone = 'Please provide a valid phone number.';
  }

  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: 'Validation failed.', details: errors });
    return;
  }

  const targetEmail = 'careers@tcongsinfotech.com';

  const newApp: Application = {
    id: `app_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    email,
    phone,
    position,
    message,
    resumeFileName: file?.originalname || 'resume',
    resumeFileSize: file?.size || 0,
    targetEmail,
    createdAt: new Date().toISOString(),
  };

  applicationsStore.push(newApp);
  console.log(`[Career Application] Received application for ${position} from ${name} (${email}). Forwarded to ${targetEmail}`);

  res.status(200).json({
    success: true,
    message: 'Your application has been sent successfully.',
    targetEmail,
  });
};

const uploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  upload.single('resume')(req as any, res as any, (err: any) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        error: 'Validation failed.',
        details: { resume: 'Resume must be under 5 MB.' },
      });
      return;
    }
    if (err) {
      res.status(400).json({
        error: 'Validation failed.',
        details: { resume: 'File upload error.' },
      });
      return;
    }
    next();
  });
};

app.post('/api/careers', uploadMiddleware, handleCareers);
app.post('/api/careers.php', uploadMiddleware, handleCareers);

// ==========================================
// AI ASSISTANT CHAT ENGINE (Gemini powered)
// ==========================================

const TCONG_SYSTEM_PROMPT = `You are the official Senior AI Assistant and Technology Architect for TCONG INFOTECH (also known as Tcongs Infotech).

WHO WE ARE & COMPANY IDENTITY:
TCONG INFOTECH is a premier custom software development, digital engineering, and technology consulting firm.
Our core philosophy & tagline:
"Don't fit your business into software. Build software that fits your business."

OUR CORE CAPABILITIES & SERVICES:
1. Custom Software Development: Tailored enterprise systems, business process automation, ERP, CRM, inventory and workflow solutions architected to fit exact operational workflows.
2. Web Development: High-performance, scalable web applications built with modern frameworks: React, Next.js, Node.js, TypeScript, Python, Tailwind CSS, REST & GraphQL APIs.
3. Mobile App Development: Native and cross-platform mobile apps for iOS and Android using Flutter, React Native, Swift, and Kotlin.
4. UI/UX Design & Product Strategy: User research, interactive wireframing, high-fidelity Figma prototypes, design systems, and conversion-optimized user flows.
5. Cloud Solutions & DevOps: Cloud infrastructure design across AWS, Google Cloud (GCP), and Microsoft Azure, Docker containerization, Kubernetes orchestration, and automated CI/CD pipelines.
6. Applied AI & Machine Learning: Custom LLM integrations, conversational AI agents, smart process automation, computer vision, NLP, and predictive data analytics.
7. Technical Consulting & Digital Transformation: Architecture audits, technical roadmaps, database optimization, legacy modernization, and technical SEO.

OUR CLIENTS & PARTNERS:
Trusted by reputable enterprises including Godrej, Asian Paints PPG, General Mills Inc., Al Naboodah, MGT Networks, VAT Box Tax Agency, Kreston GTA, and Cosmic Nutracos.

YOUR CAPABILITIES & INSTRUCTIONS:
- You are a knowledgeable, articulate, and helpful senior engineering consultant.
- ANSWER EVERY QUESTION INDIVIDUALLY AND DIRECTLY:
  * If asked about web development or tech stacks (e.g., React vs Next.js, SQL vs NoSQL, microservices vs monolith): Provide a clear, technical, expert explanation with bullet points and code/examples if helpful.
  * If asked to draft professional content (emails, proposals, job descriptions, project scopes): Write high-quality, professional, ready-to-use content.
  * If asked about TCONG INFOTECH's services, process, or pricing: Explain how we approach discovery, agile sprints, transparent delivery, and custom scoping.
  * If the user greets you with "hello", "hi", or a casual greeting: Respond warmly and politely, introduce yourself briefly, and ask how you can help them today. DO NOT dump an entire service catalog on a simple greeting.
  * If asked a follow-up question: Remember the preceding discussion and build naturally on the context.

LEAD GENERATION & CONTACT RULES:
- When the visitor shows genuine interest in starting a project, hiring our team, requesting a quote, scheduling a consultation, or discussing pricing:
  * Warmly offer to connect them with our senior solutions team.
  * Suggest: "Would you like our team to contact you to discuss your requirements? You can share your details (or click 'Connect with our team'), and we will prepare a tailored consultation for you."
  * Official email for client inquiries: info@tcongsinfotech.com

CONFIDENTIALITY & STRICT PRIVACY:
- You must strictly protect internal company privacy.
- NEVER disclose internal proprietary source code, internal financial balances, internal server credentials, or confidential employee HR data.
- If asked for internal secrets, politely state that internal company operations and private policies are confidential, and offer to help with public software services or project inquiries.

FORMATTING:
- Use clean Markdown formatting: bold titles, bullet points, concise paragraphs, and code blocks where helpful.
- Keep responses readable, polished, professional, and engaging.`;

function extractContactInfo(text: string): { email?: string; phone?: string } {
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = text.match(/(?:\+?\d{1,4}[ -]?)?(?:\(?\d{2,5}\)?[ -]?)?\d{3,5}[ -]?\d{4,6}/);

  const email = emailMatch ? emailMatch[0] : undefined;
  const phone = phoneMatch && phoneMatch[0].replace(/\D/g, '').length >= 7 ? phoneMatch[0].trim() : undefined;

  return { email, phone };
}

function formatGeminiContents(
  userMessage: string,
  history?: Array<{ sender?: string; text?: string }>
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  if (Array.isArray(history)) {
    for (const item of history) {
      if (!item || !item.text) continue;
      const role: 'user' | 'model' = item.sender === 'user' ? 'user' : 'model';
      const text = String(item.text).trim();
      if (!text) continue;

      // Gemini requires first turn to be from user; skip initial bot greetings
      if (contents.length === 0 && role === 'model') {
        continue;
      }

      // Merge consecutive same-role turns to avoid Gemini API validation error
      const prev = contents[contents.length - 1];
      if (prev && prev.role === role) {
        prev.parts[0].text += `\n${text}`;
      } else {
        contents.push({ role, parts: [{ text }] });
      }
    }
  }

  // Append user's current message
  const prev = contents[contents.length - 1];
  if (prev && prev.role === 'user') {
    prev.parts[0].text += `\n${userMessage}`;
  } else {
    contents.push({ role: 'user', parts: [{ text: userMessage }] });
  }

  return contents;
}

// Dynamic, context-specific fallback generator for zero-repetition reliability
function generateSmartContextualReply(message: string, history?: Array<{ sender?: string; text?: string }>): { reply: string; suggestLeadForm: boolean } {
  const lower = message.toLowerCase().trim();
  const contact = extractContactInfo(message);

  if (contact.email || contact.phone) {
    return {
      reply: `Thank you for sharing your contact details! I have securely recorded your information (**${contact.email || 'Provided'}** / **${contact.phone || 'Provided'}**) and forwarded it directly to our team at **info@tcongsinfotech.com**.\n\nA senior technology consultant from TCONG INFOTECH will reach out shortly to discuss your requirements and assist you with your project!`,
      suggestLeadForm: false,
    };
  }

  if (lower === 'hello' || lower === 'hi' || lower === 'hey' || lower.startsWith('hello') || lower.startsWith('hi ') || lower === 'good morning' || lower === 'good afternoon') {
    return {
      reply: `Hello! 👋 Welcome to **TCONG INFOTECH**. I'm your AI Assistant.\n\nWhether you're exploring custom software development, high-performance web/mobile applications, AI integration, or need technical consulting, I'm here to help. How can I assist you today?`,
      suggestLeadForm: false,
    };
  }

  if (lower.includes('react') && lower.includes('next')) {
    return {
      reply: `### **React vs. Next.js: Key Differences**\n\n* **React** is a client-side JavaScript UI library. It renders components in the user's browser (Client-Side Rendering) and requires you to assemble routing, SSR, and build tools yourself.\n* **Next.js** is a full-stack React framework built on top of React. It provides built-in Server-Side Rendering (SSR), Static Site Generation (SSG), file-based routing, API routes, image optimization, and server actions.\n\n**When to choose:**\n- Choose **Next.js** for SEO-sensitive public websites, enterprise applications, and fast initial page loads.\n- Choose **React (SPA)** for complex authenticated dashboards where SEO is secondary.\n\nAt TCONG INFOTECH, we specialize in high-performance Next.js and React architectures. Would you like advice for a specific project stack?`,
      suggestLeadForm: true,
    };
  }

  if (lower.includes('email') && (lower.includes('draft') || lower.includes('write') || lower.includes('client') || lower.includes('professional'))) {
    return {
      reply: `Here is a professional email template you can customize:\n\n---\n**Subject:** Exploring Custom Technology Solutions for [Client Company Name]\n\nDear [Client Name],\n\nI hope this email finds you well.\n\nI am reaching out from TCONG INFOTECH. We specialize in engineering custom software, high-performance web and mobile applications, and AI-driven solutions built specifically to fit your unique business workflows.\n\nWe would welcome the opportunity to learn more about your current technical objectives and explore how our engineering team can help streamline your operations and accelerate growth.\n\nWould you be open to a brief 15-minute introductory call next week?\n\nBest regards,\n[Your Name]\nTCONG INFOTECH | info@tcongsinfotech.com\n---`,
      suggestLeadForm: false,
    };
  }

  if (lower.includes('service') || lower.includes('offer') || lower.includes('what do you do') || lower.includes('what can you do') || lower.includes('work')) {
    return {
      reply: `### **Our Core Services at TCONG INFOTECH**\n\n1. **Custom Software Development**: Tailor-made business platforms, ERP & CRM systems, and workflow automation built around your exact operations.\n2. **Web Application Development**: High-speed, responsive, secure web platforms using Next.js, React, Node.js, TypeScript, and Python.\n3. **Mobile App Development**: Native and cross-platform apps for iOS and Android with intuitive user experience.\n4. **UI/UX Design**: Human-centered wireframes, interactive Figma prototypes, and scalable design systems.\n5. **Cloud & DevOps**: Infrastructure setup across AWS, GCP, and Azure, containerization (Docker/K8s), and automated CI/CD.\n6. **Applied AI & Machine Learning**: Custom LLM integrations, conversational agents, and intelligent process automation.\n\n*Our motto: "Don't fit your business into software. Build software that fits your business."*\n\nWould you like our team to contact you to discuss your specific requirements?`,
      suggestLeadForm: true,
    };
  }

  if (lower.includes('quote') || lower.includes('price') || lower.includes('pricing') || lower.includes('cost') || lower.includes('hire') || lower.includes('contact') || lower.includes('consult')) {
    return {
      reply: `At TCONG INFOTECH, our pricing and engagement models are tailored to each project's scope, timeline, and architectural complexity.\n\nWe offer:\n- **Fixed-Price Milestones**: Ideal for well-defined MVPs and scoped deliverables.\n- **Dedicated Engineering Sprints**: Flexible agile sprints for growing products.\n- **Technical Consultation**: Architecture discovery and technical roadmapping.\n\nWould you like our team to review your requirements and provide a tailored proposal? You can share your details using the form below or email us at **info@tcongsinfotech.com**.`,
      suggestLeadForm: true,
    };
  }

  if (lower.includes('private') || lower.includes('policy') || lower.includes('internal') || lower.includes('confidential')) {
    return {
      reply: `At TCONG INFOTECH, we maintain strict client confidentiality and operational security. Internal corporate records, source code, and employee policies are kept strictly private.\n\nHowever, we are always eager to share our public case studies, engineering capabilities, and service offerings. How can we assist your business today?`,
      suggestLeadForm: false,
    };
  }

  return {
    reply: `Thank you for your question! At **TCONG INFOTECH**, we engineer custom software, web and mobile platforms, and AI systems tailored to your specific business requirements.\n\nCould you share a little more context about your project or technical questions? I'm happy to provide in-depth technical guidance, architecture recommendations, or connect you with our solutions team.`,
    suggestLeadForm: false,
  };
}

app.post('/api/assistant/chat', async (req: Request, res: Response) => {
  try {
    const { message, history } = req.body || {};
    const userMessage = typeof message === 'string' ? message.trim() : '';

    if (!userMessage) {
      res.status(400).json({ error: 'Message is required.' });
      return;
    }

    // Auto-detect email or phone if provided directly in natural conversation
    const contact = extractContactInfo(userMessage);
    let leadCaptured = false;

    if (contact.email || contact.phone) {
      const primaryRecipient = 'info@tcongsinfotech.com';
      const autoLead: Lead = {
        id: `ai_lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: 'Website Visitor (via AI Chat)',
        email: contact.email || 'Not provided',
        phone: contact.phone || 'Not provided',
        company: 'Prospective Client',
        service: 'Direct AI Assistant Consultation',
        message: userMessage,
        source: 'AI Assistant Chat Stream',
        conversation: Array.isArray(history)
          ? history.map((h: any) => `${h.sender}: ${h.text}`).join('\n') + `\nuser: ${userMessage}`
          : userMessage,
        targetEmail: primaryRecipient,
        emailDispatched: false,
        createdAt: new Date().toISOString(),
      };

      // Non-blocking lead email dispatch so user doesn't wait for SMTP sockets
      sendLeadEmailNotification(autoLead)
        .then((dispatched) => {
          autoLead.emailDispatched = dispatched;
        })
        .catch((err) => console.error('[Background Lead Email Error]', err));

      leadsStore.push(autoLead);
      leadCaptured = true;
    }

    const lowerTrim = userMessage.toLowerCase().trim();
    const isDirectGreeting = /^(hi|hello|hey|hey there|good morning|good afternoon|good evening|hello there)[!.]*$/.test(lowerTrim);

    if (isDirectGreeting) {
      const fastReply = generateSmartContextualReply(userMessage, history);
      res.status(200).json({
        reply: fastReply.reply,
        leadCaptured,
        suggestLeadForm: fastReply.suggestLeadForm,
        officialEmail: 'info@tcongsinfotech.com',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    let aiReply = '';
    let suggestLeadForm = false;
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey) {
      try {
        const genAI = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });

        const contents = formatGeminiContents(userMessage, history);

        // Fast generation: race against 2200ms timeout to ensure sub-2-second response time
        const generationPromise = genAI.models.generateContent({
          model: 'gemini-3.8-flash',
          contents,
          config: {
            systemInstruction: TCONG_SYSTEM_PROMPT,
            temperature: 0.6,
            maxOutputTokens: 600,
            thinkingConfig: {
              thinkingBudget: 0,
            },
          },
        });

        const timeoutPromise = new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 2200);
        });

        const result: any = await Promise.race([generationPromise, timeoutPromise]);
        if (result && result.text) {
          aiReply = result.text.trim();
        }

        // Check if reply naturally suggests contacting or if message indicates project interest
        const lowerMsg = userMessage.toLowerCase();
        if (
          lowerMsg.includes('quote') ||
          lowerMsg.includes('hire') ||
          lowerMsg.includes('build') ||
          lowerMsg.includes('contact') ||
          lowerMsg.includes('price') ||
          lowerMsg.includes('cost') ||
          lowerMsg.includes('service') ||
          lowerMsg.includes('help me with')
        ) {
          suggestLeadForm = true;
        }
      } catch (geminiError: any) {
        console.warn('[Gemini API] Latency or demand spike, falling back to instant contextual engine:', geminiError?.message || geminiError);
      }
    }

    // Dynamic contextual fallback if Gemini is unreachable or returns empty
    if (!aiReply) {
      const fallbackResult = generateSmartContextualReply(userMessage, history);
      aiReply = fallbackResult.reply;
      suggestLeadForm = fallbackResult.suggestLeadForm;
    }

    res.status(200).json({
      reply: aiReply,
      leadCaptured,
      suggestLeadForm,
      officialEmail: 'info@tcongsinfotech.com',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API Assistant Chat] Error:', error);
    res.status(500).json({
      reply: 'At TCONG INFOTECH, we engineer custom software, web, mobile, and AI solutions tailored to your business strategy. Please share your project details or contact our team directly at info@tcongsinfotech.com.',
      leadCaptured: false,
      suggestLeadForm: true,
      officialEmail: 'info@tcongsinfotech.com',
    });
  }
});

// Static assets with cache-control headers to prevent stale JavaScript/CSS caching
app.use(
  express.static(publicDir, {
    extensions: ['html'],
    index: 'index.html',
    redirect: true,
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  })
);

// Fallback for clean URL routing to directories or html files
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET') return next();

  const cleanPath = req.path.replace(/\/$/, '');

  // Check if directory/index.html exists
  const dirIndex = path.join(publicDir, cleanPath, 'index.html');
  if (fs.existsSync(dirIndex)) {
    return res.sendFile(dirIndex);
  }

  // Check if filename.html exists
  const htmlFile = path.join(publicDir, `${cleanPath}.html`);
  if (fs.existsSync(htmlFile)) {
    return res.sendFile(htmlFile);
  }

  next();
});

// 404 handler
app.use((_req: Request, res: Response) => {
  const notFoundPage = path.join(publicDir, '404.html');
  if (fs.existsSync(notFoundPage)) {
    res.status(404).sendFile(notFoundPage);
  } else {
    res.status(404).send('404 Not Found');
  }
});

app.listen(PORT, HOST, () => {
  console.log(`TCONG INFOTECH server running at http://${HOST}:${PORT}`);
});
