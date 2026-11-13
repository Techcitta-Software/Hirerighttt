import { describe, expect, it, vi } from 'vitest'

// The PDF library needs browser APIs; the text parsing under test does not.
vi.mock('pdfjs-dist', () => ({ getDocument: () => ({}), GlobalWorkerOptions: {} }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { parseResumeText, pdfItemsToLines } from './resumeParser'
import { resolveCandidateName, sameNamePerson } from './store'

/** A real resume (as the PDF reader returns it once lines are rebuilt correctly). */
const BHARATH = `Bharath Krishna Pachimatla
AI Engineer | Generative AI | LLMs | RAG | Python | FastAPI | AWS
Hyderabad, India | +91 9010383256 | pachimatlabharath28@gmail.com | GitHub | LinkedIn
PROFESSIONAL SUMMARY
AI Associate Engineer building Generative AI and AI/ML applications in Python, with hands-on experience in Large
Language Models (LLMs), Retrieval-Augmented Generation (RAG) pipelines, embeddings, semantic retrieval and prompt
engineering. Designs and ships RESTful APIs with FastAPI and integrates LLM APIs (Google Gemini API, Amazon Bedrock)
into production AI services.
TECHNICAL SKILLS
Programming: Python, SQL, JavaScript
Generative AI & LLMs: Generative AI, Large Language Models (LLMs), Retrieval-Augmented Generation (RAG), Prompt
Engineering, Google Gemini API, Amazon Bedrock, Multi-Agent Systems (CrewAI), Context-Aware Question Answering
AI / ML & NLP: AI/ML, Natural Language Processing (NLP), Embeddings, Semantic Retrieval, Text Processing, Model
Evaluation, Computer Vision (OpenCV, OCR)
Backend & APIs: Python FastAPI, REST APIs, RESTful API Design, API Integration, JWT Authentication
AWS Cloud Services: AWS Lambda, Amazon S3, Amazon SQS, Amazon EventBridge, Amazon Bedrock Knowledge Bases,
Event-Driven / Serverless Architecture, Terraform (basics)
Databases: PostgreSQL, SQL
Frontend: React.js, HTML, CSS, Streamlit
Tools: Git, GitHub, Linux, Application Testing, Deployment
PROFESSIONAL EXPERIENCE
Techcitta Software Private Limited | AI Associate Engineer Hyderabad, India | May 2026 – Present
• Develop and maintain Python backend services for Generative AI and AI/ML products and business use cases.
• Build end-to-end Retrieval-Augmented Generation (RAG) pipelines: document ingestion, text preprocessing, chunking,
embeddings, semantic retrieval, context construction and LLM-generated responses.
• Integrate Large Language Models (LLMs) through the Google Gemini API for context-aware question answering.
Project: AWS Document Processing & Knowledge Retrieval (RAG) | AWS Lambda | S3 | SQS | EventBridge | Bedrock
• Designed an event-driven, serverless document processing workflow on AWS Cloud Services using Amazon S3.
PROJECTS
Multi-Agent Blog Generator (Generative AI) | Python | FastAPI | CrewAI | Gemini API | Streamlit
• Built a Generative AI application that converts YouTube transcripts into structured technical blogs with interactive Q&A.
AI-Powered Interview Practice & Proctoring Platform | Python | FastAPI | React | Generative AI
• Developed a role-specific interview practice platform using LLM-based question generation and interview workflows.
Smart Residential Security Platform | Python | FastAPI | React | OpenCV
• Built resident and security workflows for vehicle entry, visitor management and access verification with REST APIs.
EDUCATION
Sreenidhi Institute of Science and Technology | B.Tech Hyderabad, India | 2022 – 2026
CERTIFICATIONS
Data Science – Mue.Ai | Basics of Python – Infosys Springboard`

describe('PDF text -> lines', () => {
  const item = (str: string, x: number, y: number, width = str.length * 5) => ({ str, transform: [10, 0, 0, 10, x, y], width })

  it('puts fragments on the same baseline into one line, in left-to-right order', () => {
    const lines = pdfItemsToLines([item('Pachimatla', 120, 700), item('Bharath', 40, 700), item('Hyderabad', 40, 680)])
    expect(lines).toEqual(['Bharath Pachimatla', 'Hyderabad'])
  })

  it('does not add stray spaces before punctuation or inside split words', () => {
    const lines = pdfItemsToLines([item('Python', 40, 700), item(', FastAPI', 70, 700), item('Fast', 40, 680, 20), item('API', 60, 680, 15)])
    expect(lines).toEqual(['Python, FastAPI', 'FastAPI'])
  })

  it('keeps top-to-bottom order and never merges a whole page into one line', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`Line ${i}`, 40, 800 - i * 14))
    const lines = pdfItemsToLines(items)
    expect(lines).toHaveLength(12)
    expect(lines[0]).toBe('Line 0')
    expect(lines[11]).toBe('Line 11')
  })

  it('reads a two-column resume one column at a time instead of gluing the columns together', () => {
    const rows: [string, string][] = [
      ['CONTACT', 'EXPERIENCE'],
      ['rahul@example.com', 'Full Stack Developer - Zenith Labs'],
      ['+91 91234 56789', 'Mar 2022 - Present'],
      ['SKILLS', '- Built dashboards used by 300 clients.'],
      ['React, TypeScript', 'Junior Developer - Pixel Works'],
      ['Node.js, Express', 'Jul 2020 - Feb 2022'],
    ]
    const items = rows.flatMap(([l, r], i) => [item(l, 50, 740 - i * 18), item(r, 260, 740 - i * 18)])
    const lines = pdfItemsToLines(items)
    expect(lines.slice(0, 6)).toEqual(['CONTACT', 'rahul@example.com', '+91 91234 56789', 'SKILLS', 'React, TypeScript', 'Node.js, Express'])
    expect(lines.slice(6)).toEqual([
      'EXPERIENCE', 'Full Stack Developer - Zenith Labs', 'Mar 2022 - Present',
      '- Built dashboards used by 300 clients.', 'Junior Developer - Pixel Works', 'Jul 2020 - Feb 2022',
    ])
  })

  it('does not treat right-aligned dates in a normal resume as a second column', () => {
    const titles = ['Senior Engineer, Acme', 'Engineer, Globex', 'Intern, Initech', 'Analyst, Umbrella', 'Developer, Hooli']
    const dates = ['Jan 2021 - Present', 'Jun 2018 - Dec 2020', 'May 2017 - Aug 2017', 'Jan 2016 - Apr 2017', 'Jun 2015 - Dec 2015']
    // each date is right-aligned to the same edge, so it starts at a different x on every line
    const items = titles.flatMap((title, i) => [item(title, 50, 700 - i * 20), item(dates[i], 520 - dates[i].length * 5, 700 - i * 20)])
    const lines = pdfItemsToLines(items)
    expect(lines).toEqual(titles.map((title, i) => `${title} ${dates[i]}`))
  })

  it('lets a full-width heading split a two-column page into bands', () => {
    const items = [
      item('A full width heading that runs across the whole page and over the gutter text here', 50, 800, 330),
      ...[0, 1, 2, 3, 4].flatMap((i) => [item(`left ${i}`, 50, 760 - i * 18), item(`right ${i}`, 260, 760 - i * 18)]),
    ]
    const lines = pdfItemsToLines(items)
    expect(lines[0]).toMatch(/^A full width heading/)
    expect(lines.slice(1, 6)).toEqual(['left 0', 'left 1', 'left 2', 'left 3', 'left 4'])
    expect(lines.slice(6)).toEqual(['right 0', 'right 1', 'right 2', 'right 3', 'right 4'])
  })

  it('ignores empty fragments', () => {
    expect(pdfItemsToLines([item('', 10, 10), item('Hello', 10, 20)])).toEqual(['Hello'])
  })
})

describe('Bharath resume', () => {
  const parsed = parseResumeText(BHARATH)

  it('reads the name from the first line', () => {
    expect(parsed.fullName).toBe('Bharath Krishna Pachimatla')
  })

  it('uses the latest job title as the role, without the location', () => {
    expect(parsed.currentRole).toBe('AI Associate Engineer')
    expect(parsed.workExperiences).toHaveLength(1) // the AWS "Project:" line is not a second job
    expect(parsed.workExperiences?.[0]).toMatchObject({
      jobTitle: 'AI Associate Engineer',
      company: 'Techcitta Software Private Limited',
      startDate: 'May 2026',
      endDate: 'Present',
    })
  })

  it('is not a fresher: a real IT job since May 2026 counts as experience', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'))
    try {
      expect(parseResumeText(BHARATH).totalExperience).toBe('0 – 1 Years')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the skills the candidate listed, not just a fixed catalog', () => {
    const skills = (parsed.skills ?? []).map((s) => s.toLowerCase())
    for (const wanted of ['python', 'amazon bedrock', 'retrieval-augmented generation (rag)', 'postgresql', 'react.js', 'git', 'linux']) {
      expect(skills).toContain(wanted)
    }
  })

  it('splits two certifications written on one line', () => {
    expect(parsed.certifications?.map((c) => [c.name, c.organization])).toEqual([
      ['Data Science', 'Mue.Ai'],
      ['Basics of Python', 'Infosys Springboard'],
    ])
  })

  it('introduces the candidate with the right article', () => {
    expect(parsed.whoAreYou).toMatch(/^I'm Bharath Krishna Pachimatla, an AI Associate Engineer/)
  })
})

describe('which name the interview uses', () => {
  const user = { name: 'Bharath krishna pachimatla', email: 'b@example.com' }

  it('ignores a stale name left over from an older resume', () => {
    const profile = { fullName: 'Giribabu Kothapalli', resumeText: BHARATH }
    expect(resolveCandidateName(profile, user)).toBe('Bharath Krishna Pachimatla')
  })

  it('falls back to the name given at signup when the resume has no readable name', () => {
    const profile = { fullName: 'Giribabu Kothapalli', resumeText: 'ai engineer | python | rag' }
    expect(resolveCandidateName(profile, user)).toBe('Bharath krishna pachimatla')
  })

  it('keeps a saved name that matches the resume or the account', () => {
    expect(resolveCandidateName({ fullName: 'Bharath Krishna Pachimatla', resumeText: BHARATH }, user)).toBe('Bharath Krishna Pachimatla')
    expect(resolveCandidateName({ fullName: 'Bharath', resumeText: BHARATH }, user)).toBe('Bharath')
  })

  it('never uses the demo name', () => {
    expect(resolveCandidateName({ fullName: 'Arjun Sharma' }, user)).toBe('Bharath krishna pachimatla')
  })

  it('matches names by their words', () => {
    expect(sameNamePerson('Bharath', 'Bharath Krishna Pachimatla')).toBe(true)
    expect(sameNamePerson('Giribabu Kothapalli', 'Bharath Krishna Pachimatla')).toBe(false)
  })
})
