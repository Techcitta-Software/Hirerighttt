import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  clearStoredAuth,
  isApiSessionValid,
  resolveAuthenticatedDestination,
  setAuthInvalidMessage,
} from '../lib/authSession'
import { requireApiForAuth } from '../lib/authConfig'
import { getUser } from '../lib/store'
import { setPendingResume } from '../lib/pendingResume'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import styles from './HomePage.module.css'

type AudienceId = 'student' | 'graduate' | 'professional' | 'switcher'
type ReportTabId = 'strengths' | 'direction' | 'growth'
type DemoChoice = 'direction' | 'interviews' | 'growth' | 'change'
type Panel = 'demo' | 'report' | 'growth' | null

const RAIL: { id: string; label: string }[] = [
  { id: 'why', label: 'Why' },
  { id: 'who', label: 'Who' },
  { id: 'how', label: 'How' },
  { id: 'report', label: 'What' },
  { id: 'when', label: 'When' },
  { id: 'where', label: 'Where' },
]

const AUDIENCES: { id: AudienceId; label: string; detail: string }[] = [
  {
    id: 'student',
    label: "I'm still figuring things out",
    detail: 'Everyone keeps asking what you want to be. Let’s start with what you enjoy doing.',
  },
  {
    id: 'graduate',
    label: "I'm trying to land my first job",
    detail: 'You’ve got a degree and a lot of applications. Let’s work out what might be missing.',
  },
  {
    id: 'professional',
    label: 'I think I’m ready for more',
    detail: 'You’ve learned a lot where you are. What would make the next role worth moving for?',
  },
  {
    id: 'switcher',
    label: 'I want to do something different',
    detail: 'You don’t have to throw away everything you’ve done. Let’s find what can come with you.',
  },
]

const REPORT_TABS: Record<ReportTabId, { tab: string; title: string; text: string }> = {
  strengths: {
    tab: 'Strengths',
    title: 'What comes naturally to you?',
    text: 'Spot the things you seem to enjoy and do well.',
  },
  direction: {
    tab: 'Direction',
    title: 'What else might suit you?',
    text: 'See possible roles worth finding out more about.',
  },
  growth: {
    tab: 'Next steps',
    title: 'Where could you begin?',
    text: 'A few practical things to try, learn or practise next.',
  },
}

const DEMO_ANSWERS: Record<DemoChoice, { label: string; lead: string; follow: string }> = {
  direction: {
    label: "I'm not sure which career is right for me",
    lead: 'Let’s start with something small.',
    follow:
      'What’s one thing you’ve done — at college, at work or just for yourself — that you genuinely enjoyed?',
  },
  interviews: {
    label: "I'm applying but not getting interviews",
    lead: 'That gets tiring, doesn’t it?',
    follow:
      'What sort of jobs have you been applying for? And is there one part of your experience you wish employers noticed?',
  },
  growth: {
    label: "I'm ready for a bigger opportunity",
    lead: 'So what would feel different?',
    follow:
      'More responsibility, a new kind of work, a better team — what’s the change you’re hoping for?',
  },
  change: {
    label: 'I want to switch careers',
    lead: 'You don’t have to start from zero.',
    follow:
      'Which parts of your work would you happily keep doing, even in a completely different job?',
  },
}

const REPORT_AREAS = [
  'Strengths — what seems to come naturally',
  'Career paths — roles worth looking into',
  'Skill gaps — things you could learn',
  'Communication — how you tell your story',
  'Interview readiness — what you may want to practise',
  'Your next steps — a few things to try',
]

const GROWTH_ITEMS = [
  'Something to learn — a skill relevant to the work you want',
  'Something to try — a practice interview or a fresh approach',
  'Something to revisit — see what has improved and what still needs attention',
]

const DEEPER_LINKS: {
  index: string
  title: string
  desc: string
  to?: string
  panel?: Panel
}[] = [
  {
    index: '01.',
    title: "What's in my 360° report?",
    desc: 'The six things we look at, with a sample you can explore',
    panel: 'report',
  },
  {
    index: '02.',
    title: 'Why start with a conversation?',
    desc: 'A little more about the thinking behind HireRighttt',
    to: '/why',
  },
  {
    index: '03.',
    title: 'What happens to my information?',
    desc: 'What you choose to share, and what stays private',
    to: '/privacy',
  },
  {
    index: '04.',
    title: 'What does it cost?',
    desc: 'What’s included, and what you should know before you begin',
    to: '/pricing',
  },
]

export function HomePage() {
  const navigate = useNavigate()
  const resumeFileInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)

  const [audience, setAudience] = useState<AudienceId>('student')
  const [reportTab, setReportTab] = useState<ReportTabId>('strengths')
  const [panel, setPanel] = useState<Panel>(null)
  const [demoChoice, setDemoChoice] = useState<DemoChoice | null>(null)
  const [activeChapter, setActiveChapter] = useState('why')
  const [railShown, setRailShown] = useState(false)

  // Side progress rail for the six story chapters.
  useEffect(() => {
    function track() {
      const journey = document.getElementById('journey')
      if (!journey) return
      const rect = journey.getBoundingClientRect()
      setRailShown(rect.top < window.innerHeight * 0.6 && rect.bottom > window.innerHeight * 0.35)
      let best = Number.POSITIVE_INFINITY
      let active = RAIL[0].id
      RAIL.forEach(({ id }) => {
        const el = document.getElementById(id)
        if (!el) return
        const distance = Math.abs(el.getBoundingClientRect().top - window.innerHeight * 0.32)
        if (distance < best) {
          best = distance
          active = id
        }
      })
      setActiveChapter(active)
    }
    track()
    window.addEventListener('scroll', track, { passive: true })
    return () => window.removeEventListener('scroll', track)
  }, [])

  // Dialog: close on Escape, lock page scroll while open, restore focus afterwards.
  useEffect(() => {
    if (!panel) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closePanel()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
      lastFocusRef.current?.focus?.()
    }
  }, [panel])

  function openPanel(next: Exclude<Panel, null>) {
    lastFocusRef.current = document.activeElement as HTMLElement | null
    setDemoChoice(null)
    setPanel(next)
  }

  function closePanel() {
    setPanel(null)
    setDemoChoice(null)
  }

  function scrollToId(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  function handleResumeUploadClick() {
    resumeFileInputRef.current?.click()
  }

  async function handleResumeFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      await setPendingResume(file)
    } catch (err) {
      console.warn('Failed to save pending resume', err)
    }

    sessionStorage.setItem('hireright.intent', 'upload_resume')

    let user = getUser()
    if (requireApiForAuth()) {
      if (!user || !(await isApiSessionValid())) {
        if (user) {
          clearStoredAuth()
          setAuthInvalidMessage('Sign in to upload your resume and continue your profile.')
        }
        navigate(user ? '/login' : '/signup', {
          replace: false,
          state: user
            ? { from: '/onboarding', reason: 'upload_resume', explicitLogin: true }
            : { from: '/onboarding', reason: 'upload_resume', explicitSignup: true },
        })
        if (e.target) e.target.value = ''
        return
      }
      user = getUser()
    }

    if (user) {
      if (user.role === 'employer') {
        navigate('/employer/dashboard')
      } else {
        navigate(resolveAuthenticatedDestination(user))
      }
    } else {
      navigate('/signup', { state: { reason: 'upload_resume', explicitSignup: true } })
    }

    if (e.target) {
      e.target.value = ''
    }
  }

  function startConversation() {
    closePanel()
    navigate('/signup', { state: { reason: 'fast_start_discovery', explicitSignup: true } })
  }

  function handleRecruiterClick() {
    const user = getUser()
    if (user && user.role === 'employer') {
      navigate('/employer/dashboard')
    } else {
      navigate('/for-recruiters')
    }
  }

  const activeAudience = AUDIENCES.find((a) => a.id === audience) ?? AUDIENCES[0]
  const activeReport = REPORT_TABS[reportTab]
  const demo = demoChoice ? DEMO_ANSWERS[demoChoice] : null

  return (
    <div className={styles.page}>
      <input
        ref={resumeFileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={handleResumeFileSelected}
        aria-hidden="true"
        tabIndex={-1}
      />

      <MarketingNavBar />

      <main id="top">
        {/* ============================ Hero ============================ */}
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroField} aria-hidden="true">
            <svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" className={styles.heroLines}>
              <path d="M-20 520 C 220 470, 330 300, 560 330 S 900 470, 1220 210" />
              <path d="M-20 600 C 260 560, 420 420, 640 440 S 960 560, 1220 380" />
              <path d="M-20 430 C 200 380, 360 200, 600 230 S 940 330, 1220 90" />
              <path d="M560 330 C 640 250, 720 160, 860 120" />
              <path d="M640 440 C 740 420, 840 330, 980 300" />
            </svg>
          </div>

          <div className={`${styles.container} ${styles.heroInner}`}>
            <div className={styles.smallcaps}>For the career questions no one gives you answers to</div>
            <h1 id="hero-title" className={styles.heroTitle}>
              Not sure what
              <br />
              comes <span className={styles.serif}>next?</span>
            </h1>
            <div className={styles.heroLine} />
            <p className={styles.heroDesc}>
              Maybe you&apos;re starting out. Maybe you&apos;re starting over.
              <br />
              Tell us a little about yourself. We&apos;ll help you work out what might come next.
            </p>
            <div className={styles.heroActions}>
              <button type="button" className={styles.button} onClick={startConversation}>
                Let&apos;s talk <span aria-hidden="true">↗</span>
              </button>
              <button type="button" className={`${styles.button} ${styles.ghost}`} onClick={() => scrollToId('journey')}>
                See how it works <span aria-hidden="true">↓</span>
              </button>
            </div>
          </div>

          <button type="button" className={styles.heroBottom} onClick={() => scrollToId('intro')}>
            Start with the story <span aria-hidden="true" className={styles.down}>↓</span>
          </button>
        </section>

        {/* ========================= Entry ways ========================= */}
        <section className={styles.entryways} aria-labelledby="entry-heading" id="start-here">
          <div className={`${styles.container} ${styles.entryGrid}`}>
            <div className={styles.entryCopy}>
              <div className={styles.lineIntro}>A little more than a résumé</div>
              <h2 id="entry-heading">
                One 15-minute conversation.
                <br />
                <em>Your 360° career view.</em>
              </h2>
              <p>
                Maybe you&apos;re still deciding what to do after college. Maybe the applications aren&apos;t going
                anywhere. Or maybe the job you have just doesn&apos;t feel like the one you want.
              </p>
              <p>
                You can start wherever you are. We&apos;ll ask about your experiences, your interests, and the things
                you&apos;re hoping for. Then we&apos;ll help you see what you&apos;re good at, what might need work, and
                what you could try next.
              </p>
              <button type="button" className={styles.textLink} onClick={startConversation}>
                Start with a conversation <span aria-hidden="true" className={styles.arrow}>↗</span>
              </button>
              <div className={styles.entryFootnote}>
                No résumé needed to begin · Your first report is a starting point, not a judgment
              </div>
            </div>

            <div className={styles.resumeCard}>
              <div aria-hidden="true" className={styles.resumeStar}>✳</div>
              <div className={`${styles.smallcaps} ${styles.blue}`}>One more thing, if you have it</div>
              <h3>
                Got a résumé?
                <br />
                <em>Bring it along.</em>
              </h3>
              <p>
                It can help fill in a few details. But if you don&apos;t have one, that&apos;s absolutely fine. We can
                start with a chat.
              </p>
              <div className={styles.resumeDivider} />
              <button type="button" className={styles.resumeTrigger} onClick={handleResumeUploadClick}>
                <span aria-hidden="true">↗</span> Choose a résumé
              </button>
              <p className={styles.resumeMeta}>PDF, DOC or DOCX · Optional</p>
            </div>
          </div>
        </section>

        {/* ========================== Prelude =========================== */}
        <section className={styles.prelude} id="intro">
          <div className={`${styles.container} ${styles.preludeGrid}`}>
            <div>
              <div className={styles.lineIntro}>Sound familiar?</div>
              <h2 className={styles.lead}>
                Ten tabs open.
                <br />
                Still not sure <span className={`${styles.serif} ${styles.blue}`}>what to do.</span>
              </h2>
            </div>
            <p>
              One tab has job listings. One has a course you might take. Somewhere there&apos;s a résumé you&apos;ve
              edited more times than you can count.
              <br />
              <br />
              What you really want is someone to help you make sense of it all.
            </p>
          </div>
        </section>

        {/* ======================== Story chapters ====================== */}
        <nav
          aria-label="Story chapters"
          className={`${styles.progressRail} ${railShown ? styles.railShown : ''}`}
        >
          {RAIL.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`${styles.railButton} ${activeChapter === id ? styles.railActive : ''}`}
              onClick={() => scrollToId(id)}
            >
              <span className={styles.railDot} />
              {label}
            </button>
          ))}
        </nav>

        <div className={styles.journey} id="journey">
          <div className={styles.journeyLine} />

          {/* 01 why */}
          <section className={`${styles.container} ${styles.chapter}`} id="why">
            <div className={styles.chapterBody}>
              <div className={styles.chapterNumber}>01 /</div>
              <div className={styles.chapterTop}>Why · The question behind the question</div>
              <h2>
                That little voice that asks, <em>&quot;What if?&quot;</em>
              </h2>
              <p>
                What if I picked the wrong degree? What if I&apos;m better at something else? What if the next job is
                just like the last one?
                <br />
                <br />
                These aren&apos;t silly questions. They&apos;re usually where a change begins.
              </p>
              <span className={styles.eyebrow}>
                <span className={styles.blue}>✦</span> You don&apos;t have to figure it out alone
              </span>
            </div>
            <div className={styles.chapterVisual}>
              <div className={styles.visualStage}>
                <div className={styles.questionArt} role="img" aria-label="Questions about choosing a career">
                  <div className={styles.questionOrbit}>
                    <div className={styles.bigQuestion}>?</div>
                  </div>
                  <div className={`${styles.qBubble} ${styles.qOne}`}>
                    <i>“</i> What am I actually good at?
                  </div>
                  <div className={`${styles.qBubble} ${styles.qTwo}`}>
                    <i>“</i> Am I in the wrong job?
                  </div>
                  <div className={`${styles.qBubble} ${styles.qThree}`}>
                    <i>“</i> Where do I even start?
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 02 who */}
          <section className={`${styles.container} ${styles.chapter}`} id="who">
            <div className={styles.chapterBody}>
              <div className={styles.chapterNumber}>02 /</div>
              <div className={styles.chapterTop}>Who · Maybe this sounds like you</div>
              <h2>
                There&apos;s more than one way to feel <em>stuck.</em>
              </h2>
              <p>
                The student who can&apos;t pick a direction. The graduate who isn&apos;t getting replies. The person
                who&apos;s done the same job for years and wonders what&apos;s next.
              </p>
              <p>Which one sounds a little like you?</p>
              <div className={styles.chapterHint}>Pick a thought on the right. This bit is yours.</div>
            </div>
            <div className={styles.chapterVisual}>
              <div className={styles.visualStage}>
                <div className={styles.whoScene}>
                  <div className={styles.whoSceneTop}>
                    <span className={`${styles.smallcaps} ${styles.blue}`}>Choose your starting point</span>
                    <span aria-hidden="true" className={styles.sceneAsterisk}>✳</span>
                  </div>
                  <div role="group" aria-label="Career stage" className={styles.whoOptions}>
                    {AUDIENCES.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        aria-pressed={audience === a.id}
                        className={`${styles.whoChoice} ${audience === a.id ? styles.whoActive : ''}`}
                        onClick={() => setAudience(a.id)}
                      >
                        {a.label} <span className={styles.endmark}>↗</span>
                      </button>
                    ))}
                  </div>
                  <div aria-live="polite" className={styles.whoDetail}>
                    {activeAudience.detail}
                  </div>
                  <div className={styles.whoSceneFoot}>Different stories. Somewhere to begin.</div>
                </div>
              </div>
            </div>
          </section>

          {/* 03 how */}
          <section className={`${styles.container} ${styles.chapter}`} id="how">
            <div className={styles.chapterBody}>
              <div className={styles.chapterNumber}>03 /</div>
              <div className={styles.chapterTop}>How · We start by talking</div>
              <h2>
                Tell us the bits a résumé <em>leaves out.</em>
              </h2>
              <p>
                The project you loved. The job that didn&apos;t quite fit. The thing you&apos;re curious about but
                haven&apos;t tried yet.
                <br />
                <br />
                We&apos;ll ask a few good questions. You answer in your own words. That&apos;s the beginning of your
                AI-guided conversation. No résumé required.
              </p>
              <button type="button" className={styles.textLink} onClick={() => openPanel('demo')}>
                Try a question <span aria-hidden="true" className={styles.arrow}>↗</span>
              </button>
              <div className={styles.chapterHint}>About 15 minutes to start. You can take it from there.</div>
            </div>
            <div className={styles.chapterVisual}>
              <div className={styles.visualStage}>
                <div className={styles.chatFrame}>
                  <div className={styles.chatHead}>
                    <span className={styles.botIcon}>h.</span>
                    <span>
                      <strong>A little about you</strong>
                      <br />
                      <span className={styles.chatStatus}>An example of how a conversation starts</span>
                    </span>
                    <span className={styles.chatDots}>● ● ●</span>
                  </div>
                  <div className={styles.chatMain}>
                    <div className={`${styles.chatBubble} ${styles.chatBot}`}>
                      What&apos;s something you&apos;ve done that you really enjoyed?
                    </div>
                    <div className={`${styles.chatBubble} ${styles.chatUser}`}>
                      I helped run our college festival. It was chaotic, but I loved organizing it.
                    </div>
                    <div className={`${styles.chatBubble} ${styles.chatBot}`}>What was the best part for you?</div>
                    <div className={styles.chatExample}>
                      <button type="button" className={styles.chatChoice} onClick={() => openPanel('demo')}>
                        Try this conversation ↗
                      </button>
                    </div>
                  </div>
                  <div className={styles.chatFoot}>Not a test. Just a place to start.</div>
                </div>
              </div>
            </div>
          </section>

          {/* 04 what */}
          <section className={`${styles.container} ${styles.chapter}`} id="report">
            <div className={styles.chapterBody}>
              <div className={styles.chapterNumber}>04 /</div>
              <div className={styles.chapterTop}>What · Something to take away</div>
              <h2>
                You leave with more than <em>&quot;good luck.&quot;</em>
              </h2>
              <p>
                You get a first look at your strengths, possible career paths, things to work on, and how ready you
                might feel for a job interview.
              </p>
              <p>
                We call it your <strong>360° career report.</strong> It isn&apos;t a score that decides your future.
                It&apos;s something you can actually use to think about it.
              </p>
              <button type="button" className={styles.textLink} onClick={() => openPanel('report')}>
                Look inside a sample report <span aria-hidden="true" className={styles.arrow}>↗</span>
              </button>
              <div className={styles.chapterHint}>Six areas of insight. All a starting point, not a verdict.</div>
            </div>
            <div className={styles.chapterVisual}>
              <div className={styles.visualStage}>
                <div className={styles.reportPaper}>
                  <div className={styles.reportTop}>
                    <div>
                      <div className={styles.reportSmall}>HireRighttt / Your 360°</div>
                      <div className={styles.reportSub2}>A first look, just for you</div>
                    </div>
                    <div className={styles.reportSeal}>360°</div>
                  </div>
                  <h3>
                    There&apos;s more to you
                    <br />
                    than a job title.
                  </h3>
                  <p className={styles.reportSub}>
                    Take a look at the different things a conversation can bring to light.
                  </p>
                  <div role="tablist" aria-label="Sample report topics" className={styles.reportTabs}>
                    {(Object.keys(REPORT_TABS) as ReportTabId[]).map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={reportTab === id}
                        className={`${styles.reportTab} ${reportTab === id ? styles.reportTabActive : ''}`}
                        onClick={() => setReportTab(id)}
                      >
                        {REPORT_TABS[id].tab}
                      </button>
                    ))}
                  </div>
                  <div className={styles.reportBody}>
                    <div aria-hidden="true" className={styles.ring}>
                      <span>you.</span>
                    </div>
                    <div className={styles.reportCopy}>
                      <strong>{activeReport.title}</strong>
                      <p>{activeReport.text}</p>
                    </div>
                  </div>
                  <div className={styles.reportBottom}>Sample content · Not a real assessment</div>
                </div>
              </div>
            </div>
          </section>

          {/* 05 when */}
          <section className={`${styles.container} ${styles.chapter}`} id="when">
            <div className={styles.chapterBody}>
              <div className={styles.chapterNumber}>05 /</div>
              <div className={styles.chapterTop}>When · Whenever you need a hand</div>
              <h2>
                Your next step doesn&apos;t have to be <em>a big one.</em>
              </h2>
              <p>
                Sometimes it&apos;s learning something new. Sometimes it&apos;s practising how you talk about your work.
                Sometimes it&apos;s realizing you&apos;re ready to apply after all.
              </p>
              <p>
                We&apos;ll help you turn what you&apos;ve learned about yourself into a plan that makes sense for you.
              </p>
              <button type="button" className={styles.textLink} onClick={() => openPanel('growth')}>
                See how the plan can help <span aria-hidden="true" className={styles.arrow}>↗</span>
              </button>
            </div>
            <div className={styles.chapterVisual}>
              <div className={styles.visualStage}>
                <div className={styles.planning} role="img" aria-label="Example of a personal growth plan">
                  <div className={styles.milestone}>
                    <div aria-hidden="true" className={styles.milestoneIcon}>✳</div>
                    <div>
                      <strong>Something to learn.</strong>
                      <p>A skill that could help with the role you want.</p>
                    </div>
                  </div>
                  <div className={styles.milestone}>
                    <div aria-hidden="true" className={styles.milestoneIcon}>↗</div>
                    <div>
                      <strong>Something to try.</strong>
                      <p>A practice interview, or a new way to tell your story.</p>
                    </div>
                  </div>
                  <div className={styles.milestone}>
                    <div aria-hidden="true" className={styles.milestoneIcon}>✓</div>
                    <div>
                      <strong>Something to notice.</strong>
                      <p>What feels easier now? What still needs a little work?</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 06 where */}
          <section className={`${styles.container} ${styles.chapter}`} id="where">
            <div className={styles.chapterBody}>
              <div className={styles.chapterNumber}>06 /</div>
              <div className={styles.chapterTop}>Where · The next door you might open</div>
              <h2>
                When a role feels right, <em>go for it.</em>
              </h2>
              <p>
                See what employers are looking for. Explore open roles. Apply to the ones you&apos;d like to try for.
              </p>
              <p>
                If you want to share your career report with a hiring team, that&apos;s your call.{' '}
                <strong>It&apos;s yours first.</strong>
              </p>
              <Link to="/for-recruiters" className={styles.textLink}>
                What do employers see? <span aria-hidden="true" className={styles.arrow}>↗</span>
              </Link>
              <div className={styles.chapterHint}>
                We can&apos;t promise a job. We can help you feel better prepared to look for one.
              </div>
            </div>
            <div className={styles.chapterVisual}>
              <div className={styles.visualStage}>
                <div className={styles.opportunity}>
                  <div className={styles.jobLabel}>A possible next chapter</div>
                  <h3>One good fit is worth finding.</h3>
                  <p>These are sample roles, just to show how exploring could work.</p>
                  <div className={styles.opportunityList}>
                    {[
                      ['Associate Product Analyst', 'Early career · Example role'],
                      ['Junior Business Analyst', 'Graduate · Example role'],
                      ['Customer Experience Specialist', 'Career change · Example role'],
                    ].map(([title, sub]) => (
                      <div key={title} className={styles.opportunityItem}>
                        <div>
                          <strong>{title}</strong>
                          <small>{sub}</small>
                        </div>
                        <span className={styles.opportunityStatus}>Explore ↗</span>
                      </div>
                    ))}
                  </div>
                  <div className={styles.permission}>
                    <span className={styles.permissionIcon}>✓</span>
                    <span>
                      <strong>Your report belongs to you.</strong>
                      <br />
                      Share it with an employer only if you choose to.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* ========================== Deeper ============================ */}
        <section className={styles.deeper} id="deeper">
          <div className={styles.container}>
            <div className={styles.deeperHeader}>
              <div>
                <div className={`${styles.smallcaps} ${styles.blue}`}>There&apos;s more, if you&apos;re curious</div>
                <h2>
                  Take a <em>closer look.</em>
                </h2>
              </div>
              <p>You don&apos;t have to learn everything now. But when you want the details, they&apos;re here.</p>
            </div>
            <div className={styles.deeperLinks}>
              {DEEPER_LINKS.map((item) => {
                const inner = (
                  <>
                    <span className={styles.deepIndex}>{item.index}</span>
                    <span className={styles.deepTitle}>{item.title}</span>
                    <span className={styles.deepDesc}>{item.desc}</span>
                    <span aria-hidden="true" className={styles.deepArrow}>↗</span>
                  </>
                )
                return item.to ? (
                  <Link key={item.index} to={item.to} className={styles.deepLink}>
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={item.index}
                    type="button"
                    className={styles.deepLink}
                    onClick={() => item.panel && openPanel(item.panel)}
                  >
                    {inner}
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        {/* ========================== Closing =========================== */}
        <section className={styles.closing}>
          <div className={styles.container}>
            <div className={styles.smallcaps}>You can start without having all the answers</div>
            <h2>
              The next bit of your story <em>starts with a question.</em>
            </h2>
            <p>Tell us what&apos;s on your mind. We&apos;ll start there.</p>
            <button type="button" className={styles.button} onClick={startConversation}>
              Start a conversation <span aria-hidden="true" className={styles.arrow}>↗</span>
            </button>
            <div className={styles.closingRecruiter}>
              Hiring instead?{' '}
              <button type="button" onClick={handleRecruiterClick}>
                See HireRighttt for recruiters
              </button>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />

      {/* ============================ Dialog =========================== */}
      {panel && (
        <div
          className={styles.dialogBackdrop}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePanel()
          }}
        >
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="Explore HireRighttt" ref={dialogRef}>
            <button type="button" className={styles.dialogClose} aria-label="Close dialog" onClick={closePanel}>
              ×
            </button>

            {panel === 'demo' && !demo && (
              <>
                <div className={styles.smallcaps}>Just a taste of the conversation</div>
                <h3>What&apos;s on your mind?</h3>
                <p>
                  Pick one of these thoughts. We&apos;ll show you the kind of question we&apos;d ask next. Nothing is
                  saved here.
                </p>
                <div className={styles.demoOutput}>
                  <strong>HireRighttt asks: </strong>Which of these have you been thinking about lately?
                </div>
                <div className={styles.demoOptions}>
                  {(Object.keys(DEMO_ANSWERS) as DemoChoice[]).map((id) => (
                    <button key={id} type="button" className={styles.demoOption} onClick={() => setDemoChoice(id)}>
                      {DEMO_ANSWERS[id].label}
                    </button>
                  ))}
                </div>
                <div className={styles.dialogNote}>
                  This is a sample. A real conversation gathers more context before offering any insights.
                </div>
              </>
            )}

            {panel === 'demo' && demo && (
              <>
                <div className={styles.smallcaps}>A tiny preview · Your next question</div>
                <h3>{demo.lead}</h3>
                <div className={styles.demoOutput}>
                  <strong>HireRighttt follows up: </strong>
                  {demo.follow}
                </div>
                <p>
                  In the real conversation, we keep going to gather context before preparing your initial career
                  insights and possible next steps.
                </p>
                <div className={styles.demoBottom}>
                  <button type="button" className={styles.button} onClick={startConversation}>
                    Start the real conversation ↗
                  </button>
                  <button type="button" className={`${styles.button} ${styles.ghost}`} onClick={() => setDemoChoice(null)}>
                    Explore another path ↺
                  </button>
                </div>
              </>
            )}

            {panel === 'report' && (
              <>
                <div className={styles.smallcaps}>Take a look inside</div>
                <h3>A little more about you, in one place.</h3>
                <p>
                  Your conversation can give you an initial look at six things. The useful part is knowing what you
                  might do with each one.
                </p>
                <ul>
                  {REPORT_AREAS.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className={styles.dialogNote}>
                  This is an example, not a real assessment or proof of ability. Deeper checks and practice can help
                  you test what you learn.
                </div>
                <div className={styles.demoBottom}>
                  <button type="button" className={styles.button} onClick={startConversation}>
                    Start a conversation ↗
                  </button>
                </div>
              </>
            )}

            {panel === 'growth' && (
              <>
                <div className={styles.smallcaps}>After the conversation</div>
                <h3>One small step is still a step.</h3>
                <p>
                  A report is useful only if it helps you do something. Your plan can help you pick a skill to learn,
                  prepare for an interview, and notice what changes.
                </p>
                <ul>
                  {GROWTH_ITEMS.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className={styles.dialogNote}>
                  These are examples. Your real recommendations depend on your own situation.
                </div>
                <div className={styles.demoBottom}>
                  <button type="button" className={styles.button} onClick={startConversation}>
                    Start a conversation ↗
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
