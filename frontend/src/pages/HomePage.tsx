import { useState, useRef, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clearStoredAuth, isApiSessionValid, resolveAuthenticatedDestination, setAuthInvalidMessage } from '../lib/authSession'
import { requireApiForAuth } from '../lib/authConfig'
import { getUser } from '../lib/store'
import { setPendingResume } from '../lib/pendingResume'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import styles from './HomePage.module.css'

const journey = [
  { title: 'Start with your story.', label: 'Your profile', text: 'Upload your résumé, review your experience, and choose the role you want to explore. Your background gives the interview its direction.', heading: 'A little context. A better conversation.', lines: ['Your target role', 'Skills and experience', 'Projects you have worked on'] },
  { title: 'Have a relevant conversation.', label: 'Your interview', text: 'Meet Ava, your AI interviewer. Talk through the skills your role needs and the decisions you made in your projects, with questions suited to your experience.', heading: 'Questions with a reason behind them.', lines: ['Role-specific skills', 'Experience-aware difficulty', 'Practical project questions'] },
  { title: 'See your next step clearly.', label: 'Your insights', text: 'Review your assessment, understand your strengths and areas to develop, and download your report. Keep your profile current as you explore opportunities.', heading: 'Turn your answers into useful insight.', lines: ['Interview assessment', 'Strengths and development areas', 'Downloadable report'] },
]
const examples = [
  { role: 'Frontend developer', skill: 'React · JavaScript · CSS', question: 'How would you keep a page responsive while it loads a large amount of data?', context: 'Explore practical decisions, beyond a list of tools.' },
  { role: 'Data analyst', skill: 'SQL · Excel · Data visualization', question: 'How would you check whether missing values are changing the conclusion of your analysis?', context: 'Understand the reasoning behind an analysis.' },
  { role: 'Early-career candidate', skill: 'Foundations · Projects · Problem solving', question: 'Choose a project you worked on. What problem did you solve, and how did you decide where to start?', context: 'Make room for learning, coursework, and personal projects.' },
]
const faqs = [
  ['What does HireRighttt do?', 'HireRighttt connects candidate profiles, AI interviews, assessment reports, and job opportunities. Candidates can explain their skills through a conversation; hiring teams can review the resulting interview evidence.'],
  ['Will everyone get the same questions?', 'Questions are shaped by the candidate’s role, skills, experience, and project background. The examples on this page illustrate the approach; your actual interview can be different.'],
  ['Can I use it if I am a fresher?', 'Yes. The interview flow supports early-career candidates as well as experienced professionals. Add your education, skills, and projects so the conversation has relevant context.'],
  ['What happens after the interview?', 'When your assessment is ready, you can review it from your dashboard, download your report, update your profile, and explore available jobs.'],
  ['Does an assessment guarantee a job?', 'No. An assessment provides additional information about interview responses. Employers make their own hiring decisions, and available opportunities depend on current openings.'],
  ['What do I need for the interview?', 'Use a supported browser with a working microphone and camera, a stable internet connection, and a quiet place. Review the interview setup and permissions before you begin.'],
]

export function HomePage() {
  const navigate = useNavigate()
  const resumeFileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState(0)
  const [example, setExample] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  async function handleResumeFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setUploadError('')
    if (!/\.(pdf|doc|docx)$/i.test(file.name)) {
      setUploadError('Choose a PDF, DOC, or DOCX résumé.')
      input.value = ''
      return
    }
    setUploading(true)
    try {
      await setPendingResume(file)
      sessionStorage.setItem('hireright.intent', 'upload_resume')
      let user = getUser()
      if (requireApiForAuth()) {
        if (!user || !(await isApiSessionValid())) {
          if (user) {
            clearStoredAuth()
            setAuthInvalidMessage('Sign in to upload your resume and continue your profile.')
          }
          navigate(user ? '/login' : '/signup', { state: { from: '/onboarding', reason: 'upload_resume' } })
          return
        }
        user = getUser()
      }
      navigate(user ? (user.role === 'employer' ? '/employer/dashboard' : resolveAuthenticatedDestination(user)) : '/signup', { state: { reason: 'upload_resume' } })
    } catch {
      setUploadError('We could not prepare your résumé. Please try again, or create your account first.')
    } finally {
      setUploading(false)
      input.value = ''
    }
  }

  function handleRecruiterClick() {
    const user = getUser()
    navigate(user?.role === 'employer' ? '/employer/dashboard' : '/signup?role=employer')
  }

  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main-content">Skip to content</a>
      <MarketingNavBar />
      <input ref={resumeFileInputRef} type="file" accept=".pdf,.doc,.docx" hidden onChange={handleResumeFileSelected} aria-label="Choose your résumé" />
      <main id="main-content">
        <section className={`${styles.shell} ${styles.hero}`} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span className={styles.dot} /> YOUR EXPERIENCE. A MORE RELEVANT INTERVIEW.</p>
            <h1 id="hero-title">Your skills deserve<br />to be understood.<br /><em>Show what you can do.</em></h1>
            <p className={styles.lead}>Turn your résumé into a personalized AI interview. Talk through your skills and projects, understand your strengths, and explore your next opportunity.</p>
            <div className={styles.actions}>
              <button className={styles.primary} disabled={uploading} onClick={() => resumeFileInputRef.current?.click()}>{uploading ? 'Preparing résumé…' : 'Start with your résumé'} <span aria-hidden="true">↗</span></button>
              <a className={styles.secondary} href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a>
            </div>
            <p className={styles.note}>PDF, DOC, or DOCX <span>·</span> <Link to="/signup">Create an account first</Link></p>
            {uploadError && <p className={styles.error} role="alert">{uploadError}</p>}
            <div className={styles.recruiterLine}>Building your team? <button onClick={handleRecruiterClick}>Explore HireRighttt for employers ↗</button></div>
          </div>
          <div className={styles.productWindow} aria-label="Illustrative HireRighttt interview workspace">
            <div className={styles.windowBar}><span className={styles.windowBrand}>HireRighttt <span>/ Interview workspace</span></span><span className={styles.sampleTag}>Product preview</span></div>
            <div className={styles.workspace}>
              <aside className={styles.previewSidebar} aria-label="Illustrated interview stages">
                <span className={styles.sidebarLabel}>YOUR JOURNEY</span>
                <div><span>01</span> Profile</div><div className={styles.currentStage}><span>02</span> AI interview</div><div><span>03</span> Assessment</div>
                <p>Built around your<br />skills and experience.</p>
              </aside>
              <div className={styles.previewMain}>
                <div className={styles.sessionHeading}><div><span className={styles.miniLabel}>PERSONALIZED INTERVIEW</span><h2>Let’s talk about your work.</h2></div><span className={styles.sessionBadge}>Example session</span></div>
                <div className={styles.interviewer}><div className={styles.avatar}>A</div><div><strong>Ava</strong><span>Your AI interviewer</span></div><div className={styles.wave} aria-hidden="true">{[10, 19, 30, 16, 36, 24, 18, 30, 17].map((height, i) => <i key={i} style={{ height }} />)}</div></div>
                <div className={styles.promptCard}><span className={styles.miniLabel}>PROJECT EXPERIENCE</span><p>Tell me about a project you worked on. What problem did you solve, and how did you choose your approach?</p><span className={styles.promptContext}>Your projects give the conversation context.</span></div>
                <div className={styles.sessionFooter}><span>Profile → Conversation → Insights</span><span>Shaped by your experience</span></div>
              </div>
            </div>
            <div className={styles.workspaceSummary}><span className={styles.summaryIcon} aria-hidden="true">✓</span><div><strong>Your next step, in focus</strong><p>Review your strengths, development areas, and interview report.</p></div><span className={styles.summaryArrow} aria-hidden="true">↗</span></div>
            <p className={styles.previewDisclaimer}>Illustrative workspace. Your questions and assessment depend on your profile and responses.</p>
          </div>
        </section>

        <div className={styles.topicStrip} aria-label="Platform capabilities"><div className={styles.shell}>{['Résumé to profile', 'Personalized interviews', 'Actionable reports', 'Job opportunities'].map((text) => <span key={text}><span aria-hidden="true">✳</span> {text}</span>)}</div></div>

        <section className={`${styles.shell} ${styles.intro}`}>
          <p className={styles.eyebrow}>A résumé opens the conversation</p>
          <h2>From a profile on paper<br /><em>to skills in context.</em></h2>
          <p>A job title tells part of the story. How you think, what you’ve built, and how you solve problems tell the rest. HireRighttt brings that context together, so candidates can show more and employers can understand more.</p>
        </section>

        <section className={`${styles.shell} ${styles.journey}`} id="how-it-works" aria-labelledby="journey-heading">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>From introduction to insight</p><h2 id="journey-heading">Your next step.<br />Clear from the start.</h2></div><Link className={styles.textLink} to="/how-it-works">The complete walkthrough ↗</Link></div>
          <div className={styles.journeyGrid}>
            <div className={styles.stepList}>{journey.map((item, i) => <button key={item.title} className={`${styles.step} ${step === i ? styles.stepActive : ''}`} aria-pressed={step === i} aria-controls="journey-preview" onClick={() => setStep(i)}><span className={styles.stepNumber}>0{i + 1}</span><span><strong>{item.title}</strong><span>{item.text}</span></span><span aria-hidden="true">↗</span></button>)}</div>
            <div className={styles.journeyPreview} id="journey-preview" aria-live="polite">
              <div className={styles.previewTop}><span>{journey[step].label}</span><span>0{step + 1} / 03</span></div>
              <div className={styles.previewGlyph} aria-hidden="true">{['↗', '✳', '✓'][step]}</div><h3>{journey[step].heading}</h3>
              <div className={styles.previewList}>{journey[step].lines.map((line) => <div key={line}><span aria-hidden="true">✓</span>{line}</div>)}</div>
              <p className={styles.note}>Explore each step to see what happens.</p>
            </div>
          </div>
        </section>

        <section className={styles.interviewSection} id="personalized-interviews">
          <div className={`${styles.shell} ${styles.split}`}>
            <div><p className={styles.eyebrow}>Meet Ava, your AI interviewer</p><h2>Your background.<br />Your skills.<br /><em>Your conversation.</em></h2><p className={styles.body}>A fresher’s first project and an experienced professional’s work deserve different questions. HireRighttt uses your profile to shape a relevant interview, from role-specific skills to the choices behind your projects.</p><Link className={styles.textLink} to="/who-its-for">Find your starting point ↗</Link></div>
            <div className={styles.questionPanel}><p className={styles.miniLabel}>TAKE A LOOK AT THE APPROACH</p><div className={styles.roleButtons} aria-label="Example interview profiles">{examples.map((item, i) => <button key={item.role} onClick={() => setExample(i)} aria-pressed={example === i} className={example === i ? styles.roleActive : ''}>{item.role}</button>)}</div><div aria-live="polite"><p className={styles.skillLabel}>{examples[example].skill}</p><blockquote>“{examples[example].question}”</blockquote><p>{examples[example].context}</p></div><div className={styles.exampleNote}>Example question · Your interview is personalized to your profile.</div></div>
          </div>
        </section>

        <section className={`${styles.shell} ${styles.reportSection}`} id="report-preview">
          <div className={styles.reportMock}><div className={styles.cardTop}><span className={styles.brandMark}>h.</span><strong>Interview insights</strong><span className={styles.sampleTag}>Example</span></div><h3>A clearer view of<br />what comes next.</h3><div className={styles.reportRow}><span className={styles.reportIcon}>↗</span><div><small>STRENGTH</small><strong>Explaining your approach</strong><p>A clear description of the problem and the steps you took.</p></div></div><div className={styles.reportRow}><span className={styles.reportIcon}>◎</span><div><small>AREA TO DEVELOP</small><strong>Discussing the trade-offs</strong><p>Explain why you chose one approach over another.</p></div></div><div className={styles.reportRow}><span className={styles.reportIcon}>→</span><div><small>NEXT STEP</small><strong>Bring a concrete example</strong><p>Connect your decisions to the outcome of your project.</p></div></div><p className={styles.disclaimer}>Illustrative feedback, not a real candidate assessment.</p></div>
          <div><p className={styles.eyebrow}>Make the conversation count</p><h2>Understand your strengths.<br /><em>Know what to work on.</em></h2><p className={styles.body}>Bring your interview insights together in one place. Understand where you did well, where you can improve, and what to focus on next.</p><ul className={styles.checkList}><li>Review your interview assessment</li><li>Download your report for reference</li><li>Update your profile as your experience grows</li><li>Explore available jobs from your dashboard</li></ul><Link className={styles.textLink} to="/career-view">Explore your career view ↗</Link></div>
        </section>

        <section className={styles.audienceSection}><div className={styles.shell}><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Two sides. One better conversation.</p><h2>Potential deserves<br />to be understood.</h2></div></div><div className={styles.audienceGrid}><article><span className={styles.miniLabel}>FOR CANDIDATES</span><h3>Let your experience<br />speak for itself.</h3><p>From your first role to your next move, show how you think and what you can do. Build your profile, complete your interview, and take your insights forward.</p><Link className={styles.primary} to="/signup">Create your profile <span aria-hidden="true">↗</span></Link></article><article><span className={styles.miniLabel}>FOR HIRING TEAMS</span><h3>Get to know the person<br />behind the application.</h3><p>Manage job openings, invite candidates, and review profiles and interview assessments. Bring more context into your next hiring conversation.</p><button className={styles.primary} onClick={handleRecruiterClick}>Start hiring <span aria-hidden="true">↗</span></button></article></div><p className={styles.humanNote}>AI supports the assessment. People make the hiring decisions.</p></div></section>

        <section className={`${styles.shell} ${styles.faqSection}`} id="questions"><div><p className={styles.eyebrow}>Before you begin</p><h2>Good questions.<br /><em>Clear answers.</em></h2><p>Get to know HireRighttt a little better.</p><Link className={styles.textLink} to="/faqs">Visit the FAQ page ↗</Link></div><div className={styles.faqList}>{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>

        <section className={styles.closing}><div className={styles.shell}><p className={styles.eyebrow}>Your next chapter starts with you</p><h2>Bring your story.<br />Discover what’s next.</h2><p>A profile. A conversation. A clearer direction.</p><Link className={styles.primary} to="/signup">Get started with HireRighttt <span aria-hidden="true">↗</span></Link><Link className={styles.closingLogin} to="/login">Already have an account? Log in</Link></div></section>
      </main>
      <MarketingFooter />
    </div>
  )
}
