import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import styles from './RecruiterPage.module.css'

type RoleKey = 'engineer' | 'analyst' | 'marketing'
type StepKey = 'resume' | 'conversation' | 'review'

const CASES: Record<
  RoleKey,
  { name: string; resume: string; intro: string; question: string; answer: string; evidence: string; followup: string; cue: string }
> = {
  engineer: {
    name: 'Software engineer',
    resume: 'Built internal APIs and fixed production issues.',
    intro: 'A resume tells you the work happened. It doesn’t tell you what the candidate checked when a service failed.',
    question: '“Tell me about a production issue you had to troubleshoot. Where did you start?”',
    answer: '“I reproduced the error, compared logs across services, and found a retry loop. I tested the fix before we deployed it.”',
    evidence: 'The applicant describes a sequence: reproduce, investigate, test. That gives the hiring team a concrete debugging story to explore.',
    followup: '“What alternatives did you rule out before changing the retry logic?”',
    cue: 'Problem solving · Debugging · Ownership',
  },
  analyst: {
    name: 'Business analyst',
    resume: 'Worked on reporting, dashboards and stakeholder requirements.',
    intro: 'A resume lists tools and projects. The interesting part is how someone chose what mattered.',
    question: '“Tell me about a time two teams wanted different things from the same report.”',
    answer: '“I met them separately, found the metric they disagreed on, then proposed one definition with separate views for each team.”',
    evidence: 'The applicant describes clarifying conflicting requirements and proposing a practical compromise.',
    followup: '“How did you check that the final report answered both teams’ questions?”',
    cue: 'Requirements · Communication · Reasoning',
  },
  marketing: {
    name: 'Marketing lead',
    resume: 'Led campaigns across paid, social and email channels.',
    intro: 'A list of campaigns doesn’t show how someone reacts when the results go the wrong way.',
    question: '“Tell me about a campaign that wasn’t working. What did you do first?”',
    answer: '“I reviewed results by audience segment. One message wasn’t landing, so we changed the creative and tested again.”',
    evidence: 'The applicant explains how they used early data to make a decision, not simply that the campaign improved.',
    followup: '“What told you the change had worked, rather than it being normal variation?”',
    cue: 'Measurement · Judgment · Iteration',
  },
}

const ROLES: RoleKey[] = ['engineer', 'analyst', 'marketing']
const STEPS: { key: StepKey; label: string; helper: (c: (typeof CASES)[RoleKey]) => string }[] = [
  { key: 'resume', label: '01 / The resume', helper: () => 'Next: the question behind the bullet point →' },
  { key: 'conversation', label: '02 / The conversation', helper: () => 'Next: what a recruiter can take into the interview →' },
  { key: 'review', label: '03 / The review', helper: (c) => `Areas to explore: ${c.cue}. The hiring decision remains yours.` },
]

const FILM: [string, string][] = [
  ['01 / What the resume says', '“Built and maintained APIs.”'],
  ['02 / What Ava asks', '“What did you do when one failed?”'],
  ['03 / What the team learns', 'A specific story. A useful follow-up.'],
]

const PROCESS = [
  { n: '01', t: 'Post your role.', d: 'Say what the team needs and what matters beyond the job title.' },
  { n: '02', t: 'Let them speak.', d: 'Applicants take a guided interview with follow-up questions relevant to the role.' },
  { n: '03', t: 'Meet with context.', d: 'Review shared reports and interview moments. Make your own call about who to move forward.' },
]

const VALUES = [
  {
    t: 'Beyond keywords.',
    d: 'Explore how applicants explain choices, collaboration and problem-solving, not just what appears in a resume.',
    icon: (
      <>
        <path d="M3 16h26M16 3v26" />
        <circle cx="16" cy="16" r="9" />
      </>
    ),
  },
  {
    t: 'Reviewable evidence.',
    d: 'Use interview answers, relevant moments and initial insights to guide your own evaluation. Integrity signals, when enabled, still need human review.',
    icon: (
      <>
        <path d="M8 16l5 5 11-12" />
        <circle cx="16" cy="16" r="13" />
      </>
    ),
  },
  {
    t: 'Shared by choice.',
    d: 'Candidates control when they share their career information with an organisation. Reports don’t replace interviews or independent checks.',
    icon: (
      <>
        <rect x="7" y="13" width="18" height="16" rx="3" />
        <path d="M11 13V9a5 5 0 0 1 10 0v4" />
      </>
    ),
  },
]

/**
 * The hero "film": three cards that cycle every 2s. It lives in its own component so the tick re-renders only
 * this card, and it pauses while it is off-screen or the tab is hidden. Reduced motion starts it paused.
 */
function HeroFilm() {
  const ref = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(
    () => !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
  )
  const [frame, setFrame] = useState(0)
  const [onScreen, setOnScreen] = useState(true)
  const [tabVisible, setTabVisible] = useState(() => typeof document === 'undefined' || !document.hidden)

  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const onVisibility = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const running = playing && onScreen && tabVisible
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setFrame((f) => (f + 1) % FILM.length), 2000)
    return () => window.clearInterval(id)
  }, [running])

  return (
    <div ref={ref} className={styles.film} aria-label="Animated preview of how a conversation adds context to a resume">
      <div className={styles.filmGlow} aria-hidden="true" />
      <div className={styles.filmGhost} aria-hidden="true">
        “
      </div>
      <div className={styles.filmTop}>
        <span>HireRighttt / A closer look</span>
        <span className={styles.spark} aria-hidden="true">
          ✳
        </span>
      </div>
      <div className={styles.filmSpacer} aria-hidden="true" />
      <div className={styles.filmData}>
        <span className={styles.filmKicker}>{FILM[frame][0]}</span>
        <div className={styles.filmQuote} key={frame} aria-live="off">
          {FILM[frame][1]}
        </div>
        <div className={styles.filmProgress} aria-hidden="true">
          <span key={`${frame}-${running}`} data-paused={!running} />
        </div>
        <div className={styles.filmControls}>
          <span>Conversations reveal the details.</span>
          <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause animation' : 'Play animation'}>
            {playing ? 'Pause motion ‖' : 'Play motion ▶'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function RecruiterPage() {
  const [role, setRole] = useState<RoleKey>('engineer')
  const [step, setStep] = useState<StepKey>('resume')
  const [calcOpen, setCalcOpen] = useState(false)
  const [count, setCount] = useState(60)
  const [before, setBefore] = useState(30)
  const [after, setAfter] = useState(8)

  const c = CASES[role]
  const hours = Math.max(0, (count * (before - after)) / 60)

  function stepKeys(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + STEPS.length) % STEPS.length
    setStep(STEPS[next].key)
    ;(e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus()
  }

  const currentStep = STEPS.find((s) => s.key === step)!

  return (
    <div className={styles.page}>
      <MarketingNavBar />
      <main>
        {/* hero */}
        <section className={styles.hero} aria-labelledby="recruiter-hero-title">
          <div className={`${styles.container} ${styles.heroGrid}`}>
            <div className={styles.heroCol}>
              <div className={styles.eyebrow}>For the people doing the hiring</div>
              <h1 id="recruiter-hero-title" className={styles.h1}>
                A resume can’t answer your <span className={styles.italic}>follow-up question.</span>
              </h1>
              <p className={styles.lead}>
                Ava can ask it. Invite applicants to a guided interview, see what they actually say, and review useful insights before
                deciding who to meet.
              </p>
              <div className={styles.actions}>
                <Link to="/organizations/signup" className={styles.btn}>
                  Start hiring <span aria-hidden="true">↗</span>
                </Link>
                <a href="#experience" className={styles.textLink}>
                  See how it works <span aria-hidden="true">→</span>
                </a>
              </div>
              <div className={styles.facts}>
                <span>Guided interviews</span>
                <span>Candidate-shared insights</span>
                <span>Your hiring decision</span>
              </div>
            </div>

            <HeroFilm />
          </div>
        </section>

        {/* gap */}
        <section className={styles.statement}>
          <div className={`${styles.container} ${styles.statementGrid}`}>
            <div>
              <div className={styles.eyebrow}>The gap</div>
              <h2 className={styles.h2}>
                The resume tells you <span className={styles.italic}>what.</span>
                <br />
                Not always <span className={styles.italic}>how.</span>
              </h2>
            </div>
            <div>
              <p>
                Someone writes “led a project.” Another writes “strong problem-solving skills.” Maybe both are true. But what happened when
                things went wrong? What did they decide? How did they work with others?
              </p>
              <p>Those are the questions worth asking before your next interview.</p>
              <a href="#experience" className={styles.textLink}>
                See a real example <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </section>

        {/* interactive demo */}
        <section className={styles.story} id="experience">
          <div className={styles.container}>
            <div className={styles.storyTop}>
              <div>
                <div className={`${styles.eyebrow} ${styles.eyebrowLight}`}>A closer look</div>
                <h2 className={styles.h2}>
                  One candidate.
                  <br />
                  <span className={`${styles.italic} ${styles.italicLight}`}>Three different views.</span>
                </h2>
              </div>
              <p>Pick a role. Then move from the resume to an interview answer and the hiring team’s notes.</p>
            </div>

            <div className={styles.demo} aria-label="Interactive example of how candidate interviews add context">
              <div className={styles.demoSide}>
                <div className={styles.hint}>Choose a role</div>
                {ROLES.map((r) => (
                  <button key={r} type="button" className={styles.roleChoice} aria-pressed={role === r} onClick={() => setRole(r)}>
                    {CASES[r].name}
                  </button>
                ))}
                <div className={styles.demoMini}>
                  A fictional example for exploring how the experience might work. Not a real candidate or assessment.
                </div>
              </div>
              <div className={styles.demoMain}>
                <div className={styles.demoTopline}>
                  <span>{c.name} / Example</span>
                  <span>
                    <i className={styles.liveDot} /> Illustrative
                  </span>
                </div>
                <div className={styles.demoSwitch} role="tablist" aria-label="See the candidate in different ways">
                  {STEPS.map((s, i) => (
                    <button
                      key={s.key}
                      type="button"
                      role="tab"
                      aria-selected={step === s.key}
                      tabIndex={step === s.key ? 0 : -1}
                      onClick={() => setStep(s.key)}
                      onKeyDown={(e) => stepKeys(e, i)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className={styles.demoContent} key={`${role}-${step}`} role="tabpanel" aria-live="polite">
                  {step === 'resume' && (
                    <>
                      <h3>{c.resume}</h3>
                      <p>{c.intro}</p>
                      <div className={styles.paper}>
                        <span className={`${styles.badge} ${styles.badgeResume}`}>RESUME CLAIM</span>
                        <span>{c.resume}</span>
                      </div>
                    </>
                  )}
                  {step === 'conversation' && (
                    <>
                      <h3>“The follow-up is where the details appear.”</h3>
                      <div className={`${styles.paper} ${styles.paperQuestion}`}>
                        <span className={`${styles.badge} ${styles.badgeQuestion}`}>AVA ASKS</span>
                        <span>{c.question}</span>
                      </div>
                      <div className={`${styles.paper} ${styles.paperAnswer}`}>
                        <span className={`${styles.badge} ${styles.badgeAnswer}`}>APPLICANT</span>
                        <span>{c.answer}</span>
                      </div>
                    </>
                  )}
                  {step === 'review' && (
                    <>
                      <h3>Now you have something to ask about.</h3>
                      <div className={`${styles.paper} ${styles.paperEvidence}`}>
                        <span className={`${styles.badge} ${styles.badgeEvidence}`}>EVALUATION EVIDENCE</span>
                        <span>{c.evidence}</span>
                      </div>
                      <div className={`${styles.paper} ${styles.paperFollowup}`}>
                        <span className={`${styles.badge} ${styles.badgeFollowup}`}>RECOMMENDED PROBE</span>
                        <span>{c.followup}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className={styles.demoEnd}>{currentStep.helper(c)}</div>
              </div>
            </div>
            <p className={styles.note}>
              <span>Important:</span> Sample content only. Interview insights are a starting point for human review, not a certification or
              automated hiring decision.
            </p>
          </div>
        </section>

        {/* workflow */}
        <section className={styles.workflow}>
          <div className={styles.container}>
            <div className={styles.workflowHead}>
              <div>
                <div className={styles.eyebrow}>The workflow</div>
                <h2 className={styles.h2}>
                  Less chasing.
                  <br />
                  <span className={styles.italic}>Better conversations.</span>
                </h2>
              </div>
              <p>You keep the hiring process. HireRighttt helps you learn more between the application and the first call.</p>
            </div>
            <div className={styles.process}>
              {PROCESS.map((p) => (
                <div key={p.n} className={styles.processItem}>
                  <div className={styles.bullet}>{p.n}</div>
                  <h3>{p.t}</h3>
                  <p>{p.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* principles */}
        <section className={styles.principles}>
          <div className={styles.container}>
            <div className={styles.valuesHead}>
              <div>
                <div className={styles.eyebrow}>What matters here</div>
                <h2 className={styles.h2}>
                  Made for a fairer <span className={styles.italic}>starting point.</span>
                </h2>
              </div>
              <p>Technology should help recruiters ask better questions, not quietly make hiring decisions for them.</p>
            </div>
            <div className={styles.valueList}>
              {VALUES.map((v) => (
                <div key={v.t} className={styles.value}>
                  <svg viewBox="0 0 32 32" aria-hidden="true">
                    {v.icon}
                  </svg>
                  <h3>{v.t}</h3>
                  <p>{v.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* estimate */}
        <section className={styles.estimate}>
          <div className={styles.container}>
            <div className={styles.estimateInner}>
              <div>
                <div className={styles.eyebrow}>Time to spend where it matters</div>
                <h2 className={styles.h2}>
                  What could a shorter first screen <span className={styles.italic}>free up?</span>
                </h2>
                <p>Every hiring process is different. Try a simple estimate using your team’s own numbers.</p>
              </div>
              <div>
                <button type="button" className={styles.estButton} aria-expanded={calcOpen} aria-controls="calculator" onClick={() => setCalcOpen((o) => !o)}>
                  <span>
                    <strong>Try the time-savings estimate</strong>
                    <small>Change the assumptions yourself.</small>
                  </span>
                  <span aria-hidden="true">{calcOpen ? '−' : '↗'}</span>
                </button>
                <div id="calculator" className={`${styles.calcs} ${calcOpen ? styles.calcsOpen : ''}`}>
                  <div className={styles.calcRow}>
                    <span>Applicants screened per month</span>
                    <strong>{count}</strong>
                  </div>
                  <input aria-label="Applicants screened per month" type="range" min={10} max={300} step={10} value={count} onChange={(e) => setCount(Number(e.target.value))} />
                  <div className={styles.calcRow}>
                    <span>Current first-screen time</span>
                    <strong>{before} min</strong>
                  </div>
                  <input aria-label="Current first screen time" type="range" min={10} max={60} step={5} value={before} onChange={(e) => setBefore(Number(e.target.value))} />
                  <div className={styles.calcRow}>
                    <span>Illustrative review time</span>
                    <strong>{after} min</strong>
                  </div>
                  <input aria-label="Illustrative review time" type="range" min={3} max={30} step={1} value={after} onChange={(e) => setAfter(Number(e.target.value))} />
                  <div className={styles.calcNumber}>
                    <span>{hours.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span> hours / month
                  </div>
                  <div className={styles.fine}>
                    Illustrative hours saved = applicants × (current minutes − review minutes) ÷ 60. Actual results depend on workflows and
                    candidate participation; not a performance guarantee.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* closing */}
        <section className={styles.last}>
          <div className={styles.container}>
            <div className={styles.lastInner}>
              <div>
                <div className={`${styles.eyebrow} ${styles.eyebrowLight}`}>The next conversation</div>
                <h2 className={styles.h2}>
                  Ready to look <i>past the resume?</i>
                </h2>
                <p>Set up a workspace. Post a role. Start meeting applicants with more context.</p>
              </div>
              <Link to="/organizations/signup" className={styles.lastBtn}>
                Create an organisation account <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
