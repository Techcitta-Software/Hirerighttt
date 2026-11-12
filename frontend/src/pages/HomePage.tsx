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
import styles from './HomePage.module.css'

type AudienceId = 'student' | 'graduate' | 'professional' | 'switcher'
type ReportTabId = 'strengths' | 'direction' | 'growth'
type DemoChoice = 'direction' | 'interviews' | 'growth' | 'change'
type Panel = 'demo' | 'report' | 'growth' | null

const RAIL: { id: string; label: string }[] = [
  { id: 'why', label: 'why' },
  { id: 'who', label: 'who' },
  { id: 'how', label: 'how' },
  { id: 'report', label: 'what' },
  { id: 'when', label: 'when' },
  { id: 'where', label: 'where' },
]

const AUDIENCES: { id: AudienceId; label: string; detail: string }[] = [
  {
    id: 'student',
    label: "i'm still figuring things out",
    detail: 'everyone keeps asking what you want to be. let’s start with what you enjoy doing.',
  },
  {
    id: 'graduate',
    label: "i'm trying to land my first job",
    detail: 'you’ve got a degree and a lot of applications. let’s work out what might be missing.',
  },
  {
    id: 'professional',
    label: 'i think i’m ready for more',
    detail: 'you’ve learned a lot where you are. what would make the next role worth moving for?',
  },
  {
    id: 'switcher',
    label: 'i want to do something different',
    detail: 'you don’t have to throw away everything you’ve done. let’s find what can come with you.',
  },
]

const REPORT_TABS: Record<ReportTabId, { tab: string; title: string; text: string }> = {
  strengths: {
    tab: 'strengths',
    title: 'what comes naturally to you?',
    text: 'spot the things you seem to enjoy and do well.',
  },
  direction: {
    tab: 'direction',
    title: 'what else might suit you?',
    text: 'see possible roles worth finding out more about.',
  },
  growth: {
    tab: 'next steps',
    title: 'where could you begin?',
    text: 'a few practical things to try, learn or practise next.',
  },
}

const DEMO_ANSWERS: Record<DemoChoice, { label: string; lead: string; follow: string }> = {
  direction: {
    label: "i'm not sure which career is right for me",
    lead: 'let’s start with something small.',
    follow:
      'what’s one thing you’ve done — at college, at work or just for yourself — that you genuinely enjoyed?',
  },
  interviews: {
    label: "i'm applying but not getting interviews",
    lead: 'that gets tiring, doesn’t it?',
    follow:
      'what sort of jobs have you been applying for? and is there one part of your experience you wish employers noticed?',
  },
  growth: {
    label: "i'm ready for a bigger opportunity",
    lead: 'so what would feel different?',
    follow:
      'more responsibility, a new kind of work, a better team — what’s the change you’re hoping for?',
  },
  change: {
    label: 'i want to switch careers',
    lead: 'you don’t have to start from zero.',
    follow:
      'which parts of your work would you happily keep doing, even in a completely different job?',
  },
}

const REPORT_AREAS = [
  'strengths — what seems to come naturally',
  'career paths — roles worth looking into',
  'skill gaps — things you could learn',
  'communication — how you tell your story',
  'interview readiness — what you may want to practise',
  'your next steps — a few things to try',
]

const GROWTH_ITEMS = [
  'something to learn — a skill relevant to the work you want',
  'something to try — a practice interview or a fresh approach',
  'something to revisit — see what has improved and what still needs attention',
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
    title: "what's in my 360° report?",
    desc: 'the six things we look at, with a sample you can explore',
    panel: 'report',
  },
  {
    index: '02.',
    title: 'why start with a conversation?',
    desc: 'a little more about the thinking behind HireRighttt',
    to: '/why',
  },
  {
    index: '03.',
    title: 'what happens to my information?',
    desc: 'what you choose to share, and what stays private',
    to: '/privacy',
  },
  {
    index: '04.',
    title: 'what does it cost?',
    desc: 'what’s included, and what you should know before you begin',
    to: '/pricing',
  },
]

export function HomePage() {
  const navigate = useNavigate()
  const pageRef = useRef<HTMLDivElement>(null)
  const resumeFileInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)

  const [audience, setAudience] = useState<AudienceId>('student')
  const [reportTab, setReportTab] = useState<ReportTabId>('strengths')
  const [panel, setPanel] = useState<Panel>(null)
  const [demoChoice, setDemoChoice] = useState<DemoChoice | null>(null)
  const [activeChapter, setActiveChapter] = useState('why')
  const [railShown, setRailShown] = useState(false)

  // Fade sections in as they scroll into view.
  useEffect(() => {
    const root = pageRef.current
    if (!root) return
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add(styles.visible))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.visible)
            io.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.1 },
    )
    items.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

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
      navigate('/organizations/signup', { state: { explicitSignup: true } })
    }
  }

  const activeAudience = AUDIENCES.find((a) => a.id === audience) ?? AUDIENCES[0]
  const activeReport = REPORT_TABS[reportTab]
  const demo = demoChoice ? DEMO_ANSWERS[demoChoice] : null

  return (
    <div className={styles.page} ref={pageRef}>
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
            <div className={styles.smallcaps}>for the career questions no one gives you answers to</div>
            <h1 id="hero-title" className={styles.heroTitle}>
              not sure what
              <br />
              comes <span className={styles.serif}>next?</span>
            </h1>
            <div className={styles.heroLine} />
            <p className={styles.heroDesc}>
              maybe you&apos;re starting out. maybe you&apos;re starting over.
              <br />
              tell us a little about yourself. we&apos;ll help you work out what might come next.
            </p>
            <div className={styles.heroActions}>
              <button type="button" className={styles.button} onClick={startConversation}>
                let&apos;s talk <span aria-hidden="true">↗</span>
              </button>
              <button type="button" className={`${styles.button} ${styles.ghost}`} onClick={() => scrollToId('journey')}>
                see how it works <span aria-hidden="true">↓</span>
              </button>
            </div>
          </div>

          <button type="button" className={styles.heroBottom} onClick={() => scrollToId('intro')}>
            start with the story <span aria-hidden="true" className={styles.down}>↓</span>
          </button>
        </section>

        {/* ========================= Entry ways ========================= */}
        <section className={styles.entryways} aria-labelledby="entry-heading" id="start-here">
          <div className={`${styles.container} ${styles.entryGrid} ${styles.reveal}`} data-reveal>
            <div className={styles.entryCopy}>
              <div className={styles.lineIntro}>a little more than a résumé</div>
              <h2 id="entry-heading">
                one 15-minute conversation.
                <br />
                <em>your 360° career view.</em>
              </h2>
              <p>
                maybe you&apos;re still deciding what to do after college. maybe the applications aren&apos;t going
                anywhere. or maybe the job you have just doesn&apos;t feel like the one you want.
              </p>
              <p>
                you can start wherever you are. we&apos;ll ask about your experiences, your interests, and the things
                you&apos;re hoping for. then we&apos;ll help you see what you&apos;re good at, what might need work, and
                what you could try next.
              </p>
              <button type="button" className={styles.textLink} onClick={startConversation}>
                start with a conversation <span aria-hidden="true" className={styles.arrow}>↗</span>
              </button>
              <div className={styles.entryFootnote}>
                no résumé needed to begin · your first report is a starting point, not a judgment
              </div>
            </div>

            <div className={styles.resumeCard}>
              <div aria-hidden="true" className={styles.resumeStar}>✳</div>
              <div className={`${styles.smallcaps} ${styles.blue}`}>one more thing, if you have it</div>
              <h3>
                got a résumé?
                <br />
                <em>bring it along.</em>
              </h3>
              <p>
                it can help fill in a few details. but if you don&apos;t have one, that&apos;s absolutely fine. we can
                start with a chat.
              </p>
              <div className={styles.resumeDivider} />
              <button type="button" className={styles.resumeTrigger} onClick={handleResumeUploadClick}>
                <span aria-hidden="true">↗</span> choose a résumé
              </button>
              <p className={styles.resumeMeta}>PDF, DOC or DOCX · optional</p>
            </div>
          </div>
        </section>

        {/* ========================== Prelude =========================== */}
        <section className={styles.prelude} id="intro">
          <div className={`${styles.container} ${styles.preludeGrid} ${styles.reveal}`} data-reveal>
            <div>
              <div className={styles.lineIntro}>sound familiar?</div>
              <h2 className={styles.lead}>
                ten tabs open.
                <br />
                still not sure <span className={`${styles.serif} ${styles.blue}`}>what to do.</span>
              </h2>
            </div>
            <p>
              one tab has job listings. one has a course you might take. somewhere there&apos;s a résumé you&apos;ve
              edited more times than you can count.
              <br />
              <br />
              what you really want is someone to help you make sense of it all.
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
            <div className={`${styles.chapterBody} ${styles.reveal}`} data-reveal>
              <div className={styles.chapterNumber}>01 /</div>
              <div className={styles.chapterTop}>why · the question behind the question</div>
              <h2>
                that little voice that asks, <em>&quot;what if?&quot;</em>
              </h2>
              <p>
                what if i picked the wrong degree? what if i&apos;m better at something else? what if the next job is
                just like the last one?
                <br />
                <br />
                these aren&apos;t silly questions. they&apos;re usually where a change begins.
              </p>
              <span className={styles.eyebrow}>
                <span className={styles.blue}>✦</span> you don&apos;t have to figure it out alone
              </span>
            </div>
            <div className={`${styles.chapterVisual} ${styles.reveal}`} data-reveal>
              <div className={styles.visualStage}>
                <div className={styles.questionArt} role="img" aria-label="Questions about choosing a career">
                  <div className={styles.questionOrbit}>
                    <div className={styles.bigQuestion}>?</div>
                  </div>
                  <div className={`${styles.qBubble} ${styles.qOne}`}>
                    <i>“</i> what am i actually good at?
                  </div>
                  <div className={`${styles.qBubble} ${styles.qTwo}`}>
                    <i>“</i> am i in the wrong job?
                  </div>
                  <div className={`${styles.qBubble} ${styles.qThree}`}>
                    <i>“</i> where do i even start?
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 02 who */}
          <section className={`${styles.container} ${styles.chapter}`} id="who">
            <div className={`${styles.chapterBody} ${styles.reveal}`} data-reveal>
              <div className={styles.chapterNumber}>02 /</div>
              <div className={styles.chapterTop}>who · maybe this sounds like you</div>
              <h2>
                there&apos;s more than one way to feel <em>stuck.</em>
              </h2>
              <p>
                the student who can&apos;t pick a direction. the graduate who isn&apos;t getting replies. the person
                who&apos;s done the same job for years and wonders what&apos;s next.
              </p>
              <p>which one sounds a little like you?</p>
              <div className={styles.chapterHint}>pick a thought on the right. this bit is yours.</div>
            </div>
            <div className={`${styles.chapterVisual} ${styles.reveal}`} data-reveal>
              <div className={styles.visualStage}>
                <div className={styles.whoScene}>
                  <div className={styles.whoSceneTop}>
                    <span className={`${styles.smallcaps} ${styles.blue}`}>choose your starting point</span>
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
                  <div className={styles.whoSceneFoot}>different stories. somewhere to begin.</div>
                </div>
              </div>
            </div>
          </section>

          {/* 03 how */}
          <section className={`${styles.container} ${styles.chapter}`} id="how">
            <div className={`${styles.chapterBody} ${styles.reveal}`} data-reveal>
              <div className={styles.chapterNumber}>03 /</div>
              <div className={styles.chapterTop}>how · we start by talking</div>
              <h2>
                tell us the bits a résumé <em>leaves out.</em>
              </h2>
              <p>
                the project you loved. the job that didn&apos;t quite fit. the thing you&apos;re curious about but
                haven&apos;t tried yet.
                <br />
                <br />
                we&apos;ll ask a few good questions. you answer in your own words. that&apos;s the beginning of your
                AI-guided conversation. no résumé required.
              </p>
              <button type="button" className={styles.textLink} onClick={() => openPanel('demo')}>
                try a question <span aria-hidden="true" className={styles.arrow}>↗</span>
              </button>
              <div className={styles.chapterHint}>about 15 minutes to start. you can take it from there.</div>
            </div>
            <div className={`${styles.chapterVisual} ${styles.reveal}`} data-reveal>
              <div className={styles.visualStage}>
                <div className={styles.chatFrame}>
                  <div className={styles.chatHead}>
                    <span className={styles.botIcon}>h.</span>
                    <span>
                      <strong>a little about you</strong>
                      <br />
                      <span className={styles.chatStatus}>an example of how a conversation starts</span>
                    </span>
                    <span className={styles.chatDots}>● ● ●</span>
                  </div>
                  <div className={styles.chatMain}>
                    <div className={`${styles.chatBubble} ${styles.chatBot}`}>
                      what&apos;s something you&apos;ve done that you really enjoyed?
                    </div>
                    <div className={`${styles.chatBubble} ${styles.chatUser}`}>
                      i helped run our college festival. it was chaotic, but i loved organizing it.
                    </div>
                    <div className={`${styles.chatBubble} ${styles.chatBot}`}>what was the best part for you?</div>
                    <div className={styles.chatExample}>
                      <button type="button" className={styles.chatChoice} onClick={() => openPanel('demo')}>
                        try this conversation ↗
                      </button>
                    </div>
                  </div>
                  <div className={styles.chatFoot}>not a test. just a place to start.</div>
                </div>
              </div>
            </div>
          </section>

          {/* 04 what */}
          <section className={`${styles.container} ${styles.chapter}`} id="report">
            <div className={`${styles.chapterBody} ${styles.reveal}`} data-reveal>
              <div className={styles.chapterNumber}>04 /</div>
              <div className={styles.chapterTop}>what · something to take away</div>
              <h2>
                you leave with more than <em>&quot;good luck.&quot;</em>
              </h2>
              <p>
                you get a first look at your strengths, possible career paths, things to work on, and how ready you
                might feel for a job interview.
              </p>
              <p>
                we call it your <strong>360° career report.</strong> it isn&apos;t a score that decides your future.
                it&apos;s something you can actually use to think about it.
              </p>
              <button type="button" className={styles.textLink} onClick={() => openPanel('report')}>
                look inside a sample report <span aria-hidden="true" className={styles.arrow}>↗</span>
              </button>
              <div className={styles.chapterHint}>six areas of insight. all a starting point, not a verdict.</div>
            </div>
            <div className={`${styles.chapterVisual} ${styles.reveal}`} data-reveal>
              <div className={styles.visualStage}>
                <div className={styles.reportPaper}>
                  <div className={styles.reportTop}>
                    <div>
                      <div className={styles.reportSmall}>hirerighttt / your 360°</div>
                      <div className={styles.reportSub2}>a first look, just for you</div>
                    </div>
                    <div className={styles.reportSeal}>360°</div>
                  </div>
                  <h3>
                    there&apos;s more to you
                    <br />
                    than a job title.
                  </h3>
                  <p className={styles.reportSub}>
                    take a look at the different things a conversation can bring to light.
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
                  <div className={styles.reportBottom}>sample content · not a real assessment</div>
                </div>
              </div>
            </div>
          </section>

          {/* 05 when */}
          <section className={`${styles.container} ${styles.chapter}`} id="when">
            <div className={`${styles.chapterBody} ${styles.reveal}`} data-reveal>
              <div className={styles.chapterNumber}>05 /</div>
              <div className={styles.chapterTop}>when · whenever you need a hand</div>
              <h2>
                your next step doesn&apos;t have to be <em>a big one.</em>
              </h2>
              <p>
                sometimes it&apos;s learning something new. sometimes it&apos;s practising how you talk about your work.
                sometimes it&apos;s realizing you&apos;re ready to apply after all.
              </p>
              <p>
                we&apos;ll help you turn what you&apos;ve learned about yourself into a plan that makes sense for you.
              </p>
              <button type="button" className={styles.textLink} onClick={() => openPanel('growth')}>
                see how the plan can help <span aria-hidden="true" className={styles.arrow}>↗</span>
              </button>
            </div>
            <div className={`${styles.chapterVisual} ${styles.reveal}`} data-reveal>
              <div className={styles.visualStage}>
                <div className={styles.planning} role="img" aria-label="Example of a personal growth plan">
                  <div className={styles.milestone}>
                    <div aria-hidden="true" className={styles.milestoneIcon}>✳</div>
                    <div>
                      <strong>something to learn.</strong>
                      <p>a skill that could help with the role you want.</p>
                    </div>
                  </div>
                  <div className={styles.milestone}>
                    <div aria-hidden="true" className={styles.milestoneIcon}>↗</div>
                    <div>
                      <strong>something to try.</strong>
                      <p>a practice interview, or a new way to tell your story.</p>
                    </div>
                  </div>
                  <div className={styles.milestone}>
                    <div aria-hidden="true" className={styles.milestoneIcon}>✓</div>
                    <div>
                      <strong>something to notice.</strong>
                      <p>what feels easier now? what still needs a little work?</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 06 where */}
          <section className={`${styles.container} ${styles.chapter}`} id="where">
            <div className={`${styles.chapterBody} ${styles.reveal}`} data-reveal>
              <div className={styles.chapterNumber}>06 /</div>
              <div className={styles.chapterTop}>where · the next door you might open</div>
              <h2>
                when a role feels right, <em>go for it.</em>
              </h2>
              <p>
                see what employers are looking for. explore open roles. apply to the ones you&apos;d like to try for.
              </p>
              <p>
                if you want to share your career report with a hiring team, that&apos;s your call.{' '}
                <strong>it&apos;s yours first.</strong>
              </p>
              <Link to="/solutions" className={styles.textLink}>
                what do employers see? <span aria-hidden="true" className={styles.arrow}>↗</span>
              </Link>
              <div className={styles.chapterHint}>
                we can&apos;t promise a job. we can help you feel better prepared to look for one.
              </div>
            </div>
            <div className={`${styles.chapterVisual} ${styles.reveal}`} data-reveal>
              <div className={styles.visualStage}>
                <div className={styles.opportunity}>
                  <div className={styles.jobLabel}>a possible next chapter</div>
                  <h3>one good fit is worth finding.</h3>
                  <p>these are sample roles, just to show how exploring could work.</p>
                  <div className={styles.opportunityList}>
                    {[
                      ['associate product analyst', 'early career · example role'],
                      ['junior business analyst', 'graduate · example role'],
                      ['customer experience specialist', 'career change · example role'],
                    ].map(([title, sub]) => (
                      <div key={title} className={styles.opportunityItem}>
                        <div>
                          <strong>{title}</strong>
                          <small>{sub}</small>
                        </div>
                        <span className={styles.opportunityStatus}>explore ↗</span>
                      </div>
                    ))}
                  </div>
                  <div className={styles.permission}>
                    <span className={styles.permissionIcon}>✓</span>
                    <span>
                      <strong>your report belongs to you.</strong>
                      <br />
                      share it with an employer only if you choose to.
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
            <div className={`${styles.deeperHeader} ${styles.reveal}`} data-reveal>
              <div>
                <div className={`${styles.smallcaps} ${styles.blue}`}>there&apos;s more, if you&apos;re curious</div>
                <h2>
                  take a <em>closer look.</em>
                </h2>
              </div>
              <p>you don&apos;t have to learn everything now. but when you want the details, they&apos;re here.</p>
            </div>
            <div className={`${styles.deeperLinks} ${styles.reveal}`} data-reveal>
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
            <div className={styles.smallcaps}>you can start without having all the answers</div>
            <h2>
              the next bit of your story <em>starts with a question.</em>
            </h2>
            <p>tell us what&apos;s on your mind. we&apos;ll start there.</p>
            <button type="button" className={styles.button} onClick={startConversation}>
              start a conversation <span aria-hidden="true" className={styles.arrow}>↗</span>
            </button>
            <div className={styles.closingRecruiter}>
              hiring instead?{' '}
              <button type="button" onClick={handleRecruiterClick}>
                see HireRighttt for recruiters
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* =========================== Footer ============================ */}
      <footer className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.footerRow}>
            <div className={styles.footerBrand}>
              HireRighttt <span>Talent to Talent</span>
            </div>
            <div className={styles.footerLinks}>
              <Link to="/why">Why us?</Link>
              <Link to="/pricing">Pricing</Link>
              <Link to="/career-view">360° Report</Link>
              <Link to="/solutions">Organisations</Link>
              <Link to="/contact">Contact us</Link>
              <Link to="/privacy">Privacy</Link>
              <Link to="/terms">Terms</Link>
            </div>
          </div>
          <p className={styles.footerLegal}>© {new Date().getFullYear()} HireRighttt. All rights reserved.</p>
        </div>
      </footer>

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
                <div className={styles.smallcaps}>just a taste of the conversation</div>
                <h3>what&apos;s on your mind?</h3>
                <p>
                  pick one of these thoughts. we&apos;ll show you the kind of question we&apos;d ask next. nothing is
                  saved here.
                </p>
                <div className={styles.demoOutput}>
                  <strong>hirerighttt asks</strong>which of these have you been thinking about lately?
                </div>
                <div className={styles.demoOptions}>
                  {(Object.keys(DEMO_ANSWERS) as DemoChoice[]).map((id) => (
                    <button key={id} type="button" className={styles.demoOption} onClick={() => setDemoChoice(id)}>
                      {DEMO_ANSWERS[id].label}
                    </button>
                  ))}
                </div>
                <div className={styles.dialogNote}>
                  this is a sample. a real conversation gathers more context before offering any insights.
                </div>
              </>
            )}

            {panel === 'demo' && demo && (
              <>
                <div className={styles.smallcaps}>a tiny preview · your next question</div>
                <h3>{demo.lead}</h3>
                <div className={styles.demoOutput}>
                  <strong>hirerighttt follows up</strong>
                  {demo.follow}
                </div>
                <p>
                  in the real conversation, we keep going to gather context before preparing your initial career
                  insights and possible next steps.
                </p>
                <div className={styles.demoBottom}>
                  <button type="button" className={styles.button} onClick={startConversation}>
                    start the real conversation ↗
                  </button>
                  <button type="button" className={`${styles.button} ${styles.ghost}`} onClick={() => setDemoChoice(null)}>
                    explore another path ↺
                  </button>
                </div>
              </>
            )}

            {panel === 'report' && (
              <>
                <div className={styles.smallcaps}>take a look inside</div>
                <h3>a little more about you, in one place.</h3>
                <p>
                  your conversation can give you an initial look at six things. the useful part is knowing what you
                  might do with each one.
                </p>
                <ul>
                  {REPORT_AREAS.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className={styles.dialogNote}>
                  this is an example, not a real assessment or proof of ability. deeper checks and practice can help
                  you test what you learn.
                </div>
                <div className={styles.demoBottom}>
                  <button type="button" className={styles.button} onClick={startConversation}>
                    start a conversation ↗
                  </button>
                </div>
              </>
            )}

            {panel === 'growth' && (
              <>
                <div className={styles.smallcaps}>after the conversation</div>
                <h3>one small step is still a step.</h3>
                <p>
                  a report is useful only if it helps you do something. your plan can help you pick a skill to learn,
                  prepare for an interview, and notice what changes.
                </p>
                <ul>
                  {GROWTH_ITEMS.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className={styles.dialogNote}>
                  these are examples. your real recommendations depend on your own situation.
                </div>
                <div className={styles.demoBottom}>
                  <button type="button" className={styles.button} onClick={startConversation}>
                    start a conversation ↗
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
