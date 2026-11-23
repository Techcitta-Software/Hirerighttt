import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { preload } from 'react-dom'
import { Link } from 'react-router-dom'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import { JobLinkNotice } from '../components/JobLinkNotice'
import styles from './HomePage.module.css'

type AudienceId = 'student' | 'graduate' | 'professional' | 'switcher'
type ReportTabId = 'strengths' | 'direction' | 'growth'
type DemoChoice = 'direction' | 'interviews' | 'growth' | 'change'
type Panel = 'demo' | 'report' | 'growth' | 'organizations' | 'privacy' | null

type InfoPanelId = Exclude<Panel, 'demo' | null>

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
    label: "i'm exploring career options",
    detail: 'what subjects, activities or projects have you liked? we can explore roles connected to them.',
  },
  {
    id: 'graduate',
    label: "i'm applying for my first job",
    detail: 'what kinds of roles are you applying for? let’s look at your skills and how you present them.',
  },
  {
    id: 'professional',
    label: "i'm ready for a different role",
    detail: 'what do you want more of in your next role? responsibility, a different kind of work, or something else?',
  },
  {
    id: 'switcher',
    label: "i'm thinking of changing fields",
    detail: 'which skills from your current work could transfer to a different field?',
  },
]

const REPORT_TABS: Record<ReportTabId, { tab: string; title: string; text: string }> = {
  strengths: {
    tab: 'strengths',
    title: 'what are you already good at?',
    text: 'an initial look at strengths shown in your answers.',
  },
  direction: {
    tab: 'direction',
    title: 'which roles might be worth exploring?',
    text: 'a few options to research and compare with your interests.',
  },
  growth: {
    tab: 'next steps',
    title: 'what could you do next?',
    text: 'practical skills or interview preparation to focus on first.',
  },
}

const DEMO_ANSWERS: Record<DemoChoice, { label: string; lead: string; follow: string }> = {
  direction: {
    label: "i'm not sure which career is right for me",
    lead: 'let’s look at what you enjoy doing.',
    follow:
      'what’s one thing you’ve done — at college, at work or just for yourself — that you genuinely enjoyed?',
  },
  interviews: {
    label: "i'm applying but not getting interviews",
    lead: 'let’s look at the roles you want.',
    follow:
      'what sort of jobs have you been applying for? and is there one part of your experience you wish employers noticed?',
  },
  growth: {
    label: "i'm ready for a bigger opportunity",
    lead: 'what would you like to change?',
    follow: 'more responsibility, a new kind of work, a better team — what’s the change you’re hoping for?',
  },
  change: {
    label: 'i want to switch careers',
    lead: 'let’s look at the skills you could bring with you.',
    follow: 'which parts of your work would you happily keep doing, even in a completely different job?',
  },
}

const INFO_PANELS: Record<InfoPanelId, { eyebrow: string; title: string; body: string; list: string[]; note: string }> =
  {
    report: {
      eyebrow: 'take a look inside',
      title: 'what the 360° report includes',
      body: 'the report organizes early insights from your conversation into six areas. you can explore possible roles, see what to practise, and build a plan from there.',
      list: [
        'strengths — what seems to come naturally',
        'career paths — roles worth looking into',
        'skill gaps — things you could learn',
        'communication — how you tell your story',
        'interview readiness — what you may want to practise',
        'your next steps — a few things to try',
      ],
      note: 'this is an example, not a real assessment or proof of ability. deeper checks and practice can help you test what you learn.',
    },
    growth: {
      eyebrow: 'after the conversation',
      title: 'turn the report into a plan',
      body: 'use suggested skills and practice areas to plan your next steps. your plan can change as you gain experience.',
      list: [
        'something to learn — a skill relevant to the work you want',
        'something to try — a practice interview or a fresh approach',
        'something to revisit — see what has improved and what still needs attention',
      ],
      note: 'these are examples. your real recommendations would depend on your situation and the tools available in the product.',
    },
    organizations: {
      eyebrow: 'for hiring teams',
      title: 'there is a person behind every application.',
      body: 'hiring teams can post roles and review candidates who apply. if someone chooses to share their career report, it gives you one more way to understand their interests and preparation.',
      list: [
        'post a role and say what you need',
        'look through applications',
        'see a candidate report only if they choose to share it',
        'invite people to interview',
      ],
      note: 'career reports offer early insights, not a verdict on someone’s ability. hiring decisions need independent, fair human judgment.',
    },
    privacy: {
      eyebrow: 'your information',
      title: 'you should know what you’re sharing.',
      body: 'you deserve a clear explanation before you share personal information. the actual product and policies should match the promises made here.',
      list: [
        'no resume required to begin',
        'ask permission before using voice features',
        'show a clear privacy notice before collecting personal details',
        'let candidates decide what to share with employers',
        'present findings as initial, non-certified insights',
      ],
      note: 'privacy, retention, deletion, training usage and security claims require verification against the deployed product and policies.',
    },
  }

const DEEPER_LINKS: {
  index: string
  title: string
  desc: string
  to?: string
  panel?: Panel
}[] = [
  {
    index: '01.',
    title: 'see a sample 360° report',
    desc: 'see the six areas in a sample report',
    to: '/career-view',
  },
  {
    index: '02.',
    title: 'why a conversation comes first',
    desc: 'learn why we ask before we recommend',
    to: '/why',
  },
  {
    index: '03.',
    title: 'who can see my information?',
    desc: 'understand sharing and privacy controls',
    to: '/privacy',
  },
  {
    index: '04.',
    title: 'check the pricing',
    desc: 'see the plans and what is included',
    to: '/pricing',
  },
]

/** True when the visitor asked the OS to reduce motion (safe during SSR/tests). */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

export function HomePage() {
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)
  const heroVideoRef = useRef<HTMLVideoElement>(null)

  const [audience, setAudience] = useState<AudienceId>('student')
  const [reportTab, setReportTab] = useState<ReportTabId>('strengths')
  const [panel, setPanel] = useState<Panel>(null)
  const [demoChoice, setDemoChoice] = useState<DemoChoice | null>(null)
  const [activeChapter, setActiveChapter] = useState('why')
  const [railShown, setRailShown] = useState(false)
  const [motionPaused, setMotionPaused] = useState(prefersReducedMotion)
  // The hero poster is the LCP element: fetch it at high priority, home page only.
  preload('/hero-motion-poster.jpg', { as: 'image', fetchPriority: 'high' })
  const dialogTriggerRef = useRef<HTMLElement | null>(null)

  // Side progress rail for the six story chapters.
  useEffect(() => {
    let frame = 0
    function track() {
      const journey = document.getElementById('journey')
      if (!journey) return
      const rect = journey.getBoundingClientRect()
      const vh = window.innerHeight
      setRailShown(rect.top < vh * 0.92 && rect.bottom > vh * 0.12)
      let best = Number.POSITIVE_INFINITY
      let active = RAIL[0].id
      RAIL.forEach(({ id }) => {
        const el = document.getElementById(id)
        if (!el) return
        const distance = Math.abs(el.getBoundingClientRect().top - vh * 0.32)
        if (distance < best) {
          best = distance
          active = id
        }
      })
      setActiveChapter(active)
    }
    function onScroll() {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        track()
      })
    }
    track()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  // Dialog: close on Escape, lock page scroll while open, restore focus afterwards.
  useEffect(() => {
    if (!panel) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = dialogRef.current
  const focusables = () =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => !el.hasAttribute('disabled'))
        : []
    const focusTitle = () => {
      dialog?.querySelector<HTMLElement>('#home-dialog-title')?.focus({ preventScroll: true })
    }
    window.setTimeout(focusTitle, 0)
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closePanel()
        return
      }
      if (e.key !== 'Tab' || !dialog) return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
      const restore = dialogTriggerRef.current ?? lastFocusRef.current
      restore?.focus?.()
    }
  }, [panel, demoChoice])

  // Sync background video motion with prefers-reduced-motion & document visibility.
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (mediaQuery.matches) {
      setMotionPaused(true)
      heroVideoRef.current?.pause()
    }

    function handleMotionPreference(e: MediaQueryListEvent) {
      if (e.matches) {
        setMotionPaused(true)
        heroVideoRef.current?.pause()
      }
    }

    function handleVisibility() {
      if (document.hidden) {
        heroVideoRef.current?.pause()
      } else if (!motionPaused) {
        heroVideoRef.current?.play().catch(() => {})
      }
    }

    mediaQuery.addEventListener('change', handleMotionPreference)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      mediaQuery.removeEventListener('change', handleMotionPreference)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [motionPaused])

  // Scroll reveal IntersectionObserver: observes .reveal elements and adds .visible on 0.12 threshold.
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      document.querySelectorAll(`.${styles.reveal}`).forEach((el) => {
        el.classList.add(styles.visible)
      })
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.visible)
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.1 }
    )

    const targets = document.querySelectorAll(`.${styles.reveal}`)
    targets.forEach((target) => observer.observe(target))

    return () => observer.disconnect()
  }, [])

  function toggleHeroMotion() {
    if (heroVideoRef.current) {
      if (motionPaused) {
        heroVideoRef.current.play().catch(() => {})
        setMotionPaused(false)
      } else {
        heroVideoRef.current.pause()
        setMotionPaused(true)
      }
    } else {
      setMotionPaused((prev) => !prev)
    }
  }

  function openPanel(next: Exclude<Panel, null>, options?: { keepFocus?: boolean; resetDemo?: boolean }) {
    const fromOutside = !options?.keepFocus
    if (fromOutside) {
      dialogTriggerRef.current = document.activeElement as HTMLElement | null
      lastFocusRef.current = dialogTriggerRef.current
    }
    if (options?.resetDemo !== false && fromOutside) {
      setDemoChoice(null)
    }
    setPanel(next)
  }

  /** Hero / closing CTAs: in-page conversation sample only (no signup or login redirect). */
  function openConversationPreview() {
    openPanel('demo')
  }

  function closePanel() {
    setPanel(null)
    setDemoChoice(null)
  }

  function scrollToId(id: string) {
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    document.getElementById(id)?.scrollIntoView({ behavior, block: 'start' })
  }

  function onAnchorClick(e: MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault()
    scrollToId(id)
  }

  const activeAudience = AUDIENCES.find((a) => a.id === audience) ?? AUDIENCES[0]
  const activeReport = REPORT_TABS[reportTab]
  const demo = demoChoice ? DEMO_ANSWERS[demoChoice] : null

  const infoPanel = panel && panel !== 'demo' ? INFO_PANELS[panel as InfoPanelId] : null

  return (
    <div className={styles.page}>
      <MarketingNavBar />

      <main id="top">
        <JobLinkNotice />
        {/* ============================ Hero ============================ */}
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroVideoField} aria-hidden="true">
            <video
              ref={heroVideoRef}
              className={styles.heroVideo}
              src="/hero-motion.mp4"
              poster="/hero-motion-poster.jpg"
              autoPlay={!motionPaused}
              preload={motionPaused ? 'none' : 'auto'}
              loop
              muted
              playsInline
            />
          </div>

          <button
            type="button"
            id="heroMotionControl"
            className={styles.heroMotionControl}
            onClick={toggleHeroMotion}
            aria-label={motionPaused ? 'Play background motion' : 'Pause background motion'}
            aria-pressed={motionPaused}
          >
            <span className={styles.heroMotionIcon} aria-hidden="true">
              {motionPaused ? '▶' : 'Ⅱ'}
            </span>
            <span className={styles.heroMotionCopy}>{motionPaused ? 'play motion' : 'pause motion'}</span>
          </button>

          <div className={`${styles.container} ${styles.heroInner}`}>
            <div className={styles.smallcaps}>hirerighttt · talent to talent</div>
            <h1 id="hero-title" className={styles.heroTitle}>
              there are plenty of jobs.
              <br />
              which ones <span className={styles.serif}>fit you?</span>
            </h1>
            <div className={styles.heroLine} />
            <p className={styles.heroDesc}>
              tell us what you&apos;ve studied, worked on, and enjoyed. in around 15 minutes, HireRighttt helps you
              explore roles worth considering, see where you could improve, and decide what to do next.
            </p>
            <div className={styles.heroActions}>
              <button type="button" className={styles.button} onClick={openConversationPreview}>
                start the conversation <span aria-hidden="true" className={styles.arrow}>↗</span>
              </button>
              <a
                className={`${styles.button} ${styles.ghost}`}
                href="#report"
                onClick={(e) => onAnchorClick(e, 'report')}
              >
                see a sample report <span aria-hidden="true">↓</span>
              </a>
            </div>

            <div className={styles.heroPromise}>
              <span>around 15 minutes</span>
              <span>no resume required</span>
              <span>a 360° career report</span>
            </div>
          </div>

          <a className={styles.heroBottom} href="#why" onClick={(e) => onAnchorClick(e, 'why')}>
            see why we start here <span aria-hidden="true" className={styles.down}>↓</span>
          </a>
        </section>

        {/* ======================== Story chapters ====================== */}
        <nav
          aria-label="Story chapters"
          aria-hidden={!railShown}
          className={`${styles.progressRail} ${railShown ? styles.railShown : ''}`}
        >
          {RAIL.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              tabIndex={railShown ? 0 : -1}
              aria-current={activeChapter === id ? 'step' : undefined}
              className={`${styles.railButton} ${activeChapter === id ? styles.railActive : ''}`}
              onClick={() => scrollToId(id)}
            >
              <span className={styles.railDot} />
              {label}
            </button>
          ))}
        </nav>

        <div className={styles.journey} id="journey">
          <div
            className={`${styles.chapterRailMobileWrap} ${railShown ? styles.chapterRailMobileShown : ''}`}
          >
            <nav
              aria-label="Story chapters (compact)"
              aria-hidden={!railShown}
              className={`${styles.container} ${styles.chapterRailMobile}`}
            >
              {RAIL.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  tabIndex={railShown ? 0 : -1}
                  aria-current={activeChapter === id ? 'step' : undefined}
                  className={`${styles.chapterRailMobileBtn} ${activeChapter === id ? styles.chapterRailMobileActive : ''}`}
                  onClick={() => scrollToId(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
          <div className={styles.journeyLine} />

          {/* 01 why */}
          <section
            className={`${styles.container} ${styles.chapter}`}
            id="why"
            data-chapter="why"
          >
            <div className={`${styles.chapterBody} ${styles.reveal}`}>
              <div className={styles.chapterTop}>01 / why this matters</div>
              <h2>
                job listings tell you what&apos;s open. <em>not what fits.</em>
              </h2>
              <p>
                you can read fifty job descriptions and still wonder which ones suit you. a list of requirements
                won&apos;t tell you what your experience adds up to—or what you should learn next. that&apos;s where we
                start.
              </p>
              <span className={styles.eyebrow}>
                <span className={styles.blue}>✦</span> first, work out what you&apos;re looking for
              </span>
            </div>
            <div className={`${styles.chapterVisual} ${styles.reveal}`}>
              <div className={styles.visualStage}>
                <div className={styles.questionArt} role="img" aria-label="Questions about choosing a career">
                  <div className={styles.questionOrbit}>
                    <div className={styles.bigQuestion}>?</div>
                  </div>
                  <div className={`${styles.qBubble} ${styles.qOne}`}>
                    <i>“</i> what roles would suit me?
                  </div>
                  <div className={`${styles.qBubble} ${styles.qTwo}`}>
                    <i>“</i> do i have the right skills?
                  </div>
                  <div className={`${styles.qBubble} ${styles.qThree}`}>
                    <i>“</i> what should i learn first?
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 02 who */}
          <section
            className={`${styles.container} ${styles.chapter}`}
            id="who"
            data-chapter="who"
          >
            <div className={`${styles.chapterBody} ${styles.reveal}`}>
              <div className={styles.chapterTop}>02 / who it&apos;s for</div>
              <h2>
                the conversation depends on <em>where you are.</em>
              </h2>
              <p>
                you might be choosing a field, looking for a first job, trying for a promotion, or leaving one kind of
                work for another. each situation needs different advice.
              </p>
              <p>pick what sounds closest to you.</p>
              <div className={styles.chapterHint}>see what we would ask you about.</div>
            </div>
            <div className={`${styles.chapterVisual} ${styles.reveal}`}>
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
                  <div className={styles.whoSceneFoot}>same platform. different conversations.</div>
                </div>
              </div>
            </div>
          </section>

          {/* 03 how */}
          <section
            className={`${styles.container} ${styles.chapter}`}
            id="how"
            data-chapter="how"
          >
            <div className={`${styles.chapterBody} ${styles.reveal}`}>
              <div className={styles.chapterTop}>03 / how it works</div>
              <h2>
                tell us about the work, <em>not just the job titles.</em>
              </h2>
              <p>
                what did you enjoy about a project? what did you find difficult? is there something you want to try?
                HireRighttt asks follow-up questions in a guided AI conversation. you speak in your own words. no long
                form or resume needed.
              </p>
              <button type="button" className={styles.textLink} onClick={() => openPanel('demo')}>
                try a sample question <span aria-hidden="true" className={styles.arrow}>↗</span>
              </button>
              <div className={styles.chapterHint}>about 15 minutes for the first conversation.</div>
            </div>
            <div className={`${styles.chapterVisual} ${styles.reveal}`}>
              <div className={styles.visualStage}>
                <div className={styles.chatFrame}>
                  <div className={styles.chatHead}>
                    <span className={styles.botIcon}>h.</span>
                    <span>
                      <strong>a sample conversation</strong>
                      <br />
                      <span className={styles.chatStatus}>just an example · no answers are saved</span>
                    </span>
                    <span className={styles.chatDots} aria-hidden="true">● ● ●</span>
                  </div>
                  <div className={styles.chatMain}>
                    <div className={`${styles.chatBubble} ${styles.chatBot}`}>
                      tell me about something you&apos;ve enjoyed doing, at work or outside it.
                    </div>
                    <div className={`${styles.chatBubble} ${styles.chatUser}`}>
                      i organized our college festival. i liked planning everything and keeping people on track.
                    </div>
                    <div className={`${styles.chatBubble} ${styles.chatBot}`}>
                      was it the planning, working with people, or solving problems as they came up?
                    </div>
                    <div className={styles.chatExample}>
                      <button type="button" className={styles.chatChoice} onClick={() => openPanel('demo')}>
                        try this conversation ↗
                      </button>
                    </div>
                  </div>
                  <div className={styles.chatFoot}>the real conversation adapts to your answers.</div>
                </div>
              </div>
            </div>
          </section>

          {/* 04 what */}
          <section
            className={`${styles.container} ${styles.chapter}`}
            id="report"
            data-chapter="report"
          >
            <div className={`${styles.chapterBody} ${styles.reveal}`}>
              <div className={styles.chapterTop}>04 / what you get</div>
              <h2>
                here&apos;s what the conversation <em>turns into.</em>
              </h2>
              <p>
                your 360° career report brings together initial observations about your strengths, roles to explore,
                skills to improve, communication, interview preparation, and next steps.
              </p>
              <p>
                <strong>it&apos;s a first look, not a verdict.</strong> the findings come from a short conversation. use
                them to ask better questions and decide what to check or practise next.
              </p>
              <button type="button" className={styles.textLink} onClick={() => openPanel('report')}>
                explore the sample report <span aria-hidden="true" className={styles.arrow}>↗</span>
              </button>
              <div className={styles.chapterHint}>six areas of insight · based on a first conversation.</div>
            </div>
            <div className={`${styles.chapterVisual} ${styles.reveal}`}>
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
                    your 360° report,
                    <br />
                    in plain English.
                  </h3>
                  <p className={styles.reportSub}>
                    see the kind of observations and next steps a report can contain.
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
          <section
            className={`${styles.container} ${styles.chapter}`}
            id="when"
            data-chapter="when"
          >
            <div className={`${styles.chapterBody} ${styles.reveal}`}>
              <div className={styles.chapterTop}>05 / when you want to improve</div>
              <h2>
                now you know what to work on. <em>here&apos;s where to start.</em>
              </h2>
              <p>
                if a role calls for a skill you haven&apos;t used yet, start there. if interviews are the difficult part,
                practise explaining your experience. the report gives you a place to begin.
              </p>
              <p>
                you can come back to practise, build skills, and revisit your priorities as you improve.
              </p>
              <button type="button" className={styles.textLink} onClick={() => openPanel('growth')}>
                see an example plan <span aria-hidden="true" className={styles.arrow}>↗</span>
              </button>
            </div>
            <div className={`${styles.chapterVisual} ${styles.reveal}`}>
              <div className={styles.visualStage}>
                <div className={styles.planning} role="img" aria-label="Example of a personal growth plan">
                  <div className={styles.milestone}>
                    <div aria-hidden="true" className={styles.milestoneIcon}>✳</div>
                    <div>
                      <strong>learn one useful skill</strong>
                      <p>choose a skill relevant to a role you want.</p>
                    </div>
                  </div>
                  <div className={styles.milestone}>
                    <div aria-hidden="true" className={styles.milestoneIcon}>↗</div>
                    <div>
                      <strong>practise for the interview</strong>
                      <p>try role-specific interview questions and answers.</p>
                    </div>
                  </div>
                  <div className={styles.milestone}>
                    <div aria-hidden="true" className={styles.milestoneIcon}>✓</div>
                    <div>
                      <strong>check what&apos;s changed</strong>
                      <p>review your progress and decide on the next priority.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 06 where */}
          <section
            className={`${styles.container} ${styles.chapter}`}
            id="where"
            data-chapter="where"
          >
            <div className={`${styles.chapterBody} ${styles.reveal}`}>
              <div className={styles.chapterTop}>06 / where it can lead</div>
              <h2>
                when you find a role worth trying, <em>you can apply.</em>
              </h2>
              <p>
                browse opportunities posted by employers, check what each role needs, and apply to the ones you want to
                pursue.
              </p>
              <p>
                you decide whether to share your career report with a hiring team. <strong>it is not shared automatically.</strong>
              </p>
              <button type="button" className={styles.textLink} onClick={() => openPanel('organizations')}>
                how sharing works <span aria-hidden="true" className={styles.arrow}>↗</span>
              </button>
              <div className={styles.chapterHint}>no job guarantees. just a more informed place to start.</div>
            </div>
            <div className={`${styles.chapterVisual} ${styles.reveal}`}>
              <div className={styles.visualStage}>
                <div className={styles.opportunity}>
                  <div className={styles.jobLabel}>example opportunities</div>
                  <h3>what could you explore?</h3>
                  <p>illustrative roles, not live job listings.</p>
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
                        <span className={styles.opportunityStatus}>example</span>
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
            <div className={`${styles.deeperHeader} ${styles.reveal}`}>
              <div>
                <div className={`${styles.smallcaps} ${styles.blue}`}>have a question before you begin?</div>
                <h2>
                  want to know <em>more before starting?</em>
                </h2>
              </div>
              <p>see the example report, how HireRighttt works, what you share, and what it costs.</p>
            </div>
            <div className={`${styles.deeperLinks} ${styles.reveal}`}>
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
          <div className={`${styles.container} ${styles.reveal}`}>
            <div className={styles.smallcaps}>one conversation to start</div>
            <h2>
              give it fifteen minutes. <em>see what you learn.</em>
            </h2>
            <p>tell us what you&apos;re weighing up. we&apos;ll ask the next question.</p>
            <button type="button" className={styles.button} onClick={openConversationPreview}>
              start my conversation <span aria-hidden="true" className={styles.arrow}>↗</span>
            </button>
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
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-dialog-title"
            ref={dialogRef}
          >
            <button type="button" className={styles.dialogClose} aria-label="Close dialog" onClick={closePanel}>
              ×
            </button>

            {panel === 'demo' && !demo && (
              <>
                <div className={styles.smallcaps}>just a taste of the conversation</div>
                <h3 id="home-dialog-title" tabIndex={-1}>
                  what would you like to work out?
                </h3>
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
                  this is a sample. a real conversation needs more context before it can offer useful insights.
                </div>
                <p className={styles.dialogAccount}>
                  Ready for the full conversation?{' '}
                  <Link to="/signup" state={{ explicitSignup: true }} className={styles.dialogAccountLink} onClick={closePanel}>
                    Create a free account
                  </Link>
                </p>
              </>
            )}

            {panel === 'demo' && demo && (
              <>
                <div className={styles.smallcaps}>a tiny preview · your next question</div>
                <h3 id="home-dialog-title" tabIndex={-1}>
                  {demo.lead}
                </h3>
                <div className={styles.demoOutput}>
                  <strong>hirerighttt follows up</strong>
                  {demo.follow}
                </div>
                <p>
                  in the real experience, the conversation continues to gather context before preparing initial career
                  insights and possible next steps.
                </p>
                <div className={styles.demoBottom}>
                  <button type="button" className={styles.button} onClick={() => setDemoChoice(null)}>
                    explore another path ↺
                  </button>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.ghost}`}
                    onClick={() => {
                      setDemoChoice(null)
                      openPanel('report', { keepFocus: true, resetDemo: false })
                    }}
                  >
                    what&apos;s in the report? ↗
                  </button>
                </div>
                <div className={styles.dialogNote}>
                  this prototype does not perform an AI assessment or store your answers.
                </div>
                <p className={styles.dialogAccount}>
                  Ready for the full conversation?{' '}
                  <Link to="/signup" state={{ explicitSignup: true }} className={styles.dialogAccountLink} onClick={closePanel}>
                    Create a free account
                  </Link>
                </p>
              </>
            )}

            {infoPanel && (
              <>
                <div className={styles.smallcaps}>{infoPanel.eyebrow}</div>
                <h3 id="home-dialog-title" tabIndex={-1}>
                  {infoPanel.title}
                </h3>
                <p>{infoPanel.body}</p>
                {infoPanel.list.length > 0 && (
                  <ul>
                    {infoPanel.list.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                <div className={styles.dialogNote}>{infoPanel.note}</div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
