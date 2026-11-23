import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import styles from './CareerViewPage.module.css'

type TopicKey = 'strengths' | 'direction' | 'skills' | 'communication' | 'readiness' | 'roadmap'

type Topic = {
  label: string
  title: string
  explain: string
  example: string
  action: string
  symbol: string
  art1: string
  art2: string
  short: string
}

const TOPICS: Record<TopicKey, Topic> = {
  strengths: {
    label: 'Strengths & potential',
    title: 'What do you already do well?',
    explain: 'The work you enjoy can tell you more than a job title does. Here is one way your experiences might connect.',
    example: '“I helped organise our college festival. When the venue changed, I got everyone working on the new plan.”',
    action: 'Read up on project coordinator and operations roles. Do the everyday tasks appeal to you?',
    symbol: '✳',
    art1: 'making plans',
    art2: 'working with people',
    short: 'strengths',
  },
  direction: {
    label: 'Career direction',
    title: 'What work could suit you?',
    explain: 'A career suggestion is a direction to explore, not a prediction. Start with the work you enjoyed doing.',
    example: '“I liked making sure everyone knew what they needed to do. I even enjoyed handling last-minute changes.”',
    action: 'Compare operations, events and project support roles. Look at what people in those jobs actually do.',
    symbol: '↗',
    art1: 'what interests you',
    art2: 'possible roles',
    short: 'career directions',
  },
  skills: {
    label: 'Skill gap discovery',
    title: 'What might be worth learning?',
    explain: 'If a role interests you, find the skills it asks for. Then choose a gap you can do something about.',
    example: '“I kept our festival budget in a spreadsheet. I have not used many other reporting tools.”',
    action: 'Try a small spreadsheet reporting project before paying for a course.',
    symbol: '＋',
    art1: 'skills you have',
    art2: 'skills to practise',
    short: 'skill gaps',
  },
  communication: {
    label: 'Communication insights',
    title: 'How clearly do you tell your story?',
    explain: 'You have experience. A specific example can make that experience easier for someone else to understand.',
    example: '“We did a great job with the festival.”',
    action: 'Try saying what changed, what you did personally and what happened as a result.',
    symbol: '“ ”',
    art1: 'your examples',
    art2: 'clearer answers',
    short: 'communication',
  },
  readiness: {
    label: 'Job & interview readiness',
    title: 'What could you practise before applying?',
    explain: 'Think about the examples you can explain confidently and the questions that might catch you off guard.',
    example: '“I can talk about working in a team, but I struggle to explain a tough decision I made.”',
    action: 'Practise one question about solving a problem on your own.',
    symbol: '✓',
    art1: 'what feels easy',
    art2: 'what needs practice',
    short: 'interview readiness',
  },
  roadmap: {
    label: 'Personalised action roadmap',
    title: 'Where do you start?',
    explain: 'A good plan is not an overwhelming list. It gives you a few practical priorities you can revisit.',
    example: '“I am interested in operations, but I am not sure whether I am ready to apply.”',
    action: 'Explore one role, test one relevant skill and practise talking through an experience.',
    symbol: '↝',
    art1: 'one next step',
    art2: 'room to grow',
    short: 'next steps',
  },
}

const KEYS = Object.keys(TOPICS) as TopicKey[]

/** Orbit buttons: [desktop left, desktop top, mobile left, mobile top] in percent. */
const ORBIT_POSITIONS: [number, number, number, number][] = [
  [19, 19, 17, 17],
  [71, 7, 72, 7],
  [94, 37, 91, 38],
  [81, 79, 78, 79],
  [31, 92, 28, 89],
  [5, 56, 8, 55],
]

const ORBIT_LABELS: Record<TopicKey, { text: string; aria: string }> = {
  strengths: { text: 'Strengths', aria: 'Explore strengths and potential' },
  direction: { text: 'Career direction', aria: 'Explore career direction' },
  skills: { text: 'Skill gaps', aria: 'Explore skill gaps' },
  communication: { text: 'Communication', aria: 'Explore communication insights' },
  readiness: { text: 'Interview readiness', aria: 'Explore interview readiness' },
  roadmap: { text: 'Next steps', aria: 'Explore your action roadmap' },
}

/** The sample-report tabs read slightly differently from the orbit buttons. */
const TAB_LABELS: Record<TopicKey, string> = {
  strengths: 'Strengths',
  direction: 'Career direction',
  skills: 'Skill gaps',
  communication: 'Communication',
  readiness: 'Interview readiness',
  roadmap: 'Action roadmap',
}

type DayKey = '30' | '60' | '90'
const DAYS: { key: DayKey; sub: string; title: string; text: string }[] = [
  { key: '30', sub: 'Explore', title: 'Find one role worth exploring.', text: 'Read three job descriptions. Write down what the work actually involves and which skills keep appearing.' },
  { key: '60', sub: 'Practise', title: 'Test one skill in a small way.', text: 'Try a short project or a practice interview. Notice what is easier and what still needs work.' },
  { key: '90', sub: 'Review', title: 'Review what has changed.', text: 'Look at your progress and decide whether to practise more, explore another role or apply for one you want.' },
]

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Left/right/up/down/Home/End move between the tabs of a tab list. */
function tabKeys(e: KeyboardEvent, index: number, count: number, vertical: boolean, go: (next: number) => void, ids: string[]) {
  const keys = vertical ? ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'] : ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(e.key)) return
  e.preventDefault()
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : (index + step + count) % count
  go(next)
  document.getElementById(ids[next])?.focus()
}

export function CareerViewPage() {
  const [topic, setTopic] = useState<TopicKey>('strengths')
  const [day, setDay] = useState<DayKey>('30')
  const [motionOff, setMotionOff] = useState(prefersReducedMotion)
  const [bounce, setBounce] = useState(0)
  const universeRef = useRef<HTMLDivElement>(null)

  const item = TOPICS[topic]
  const topicIndex = KEYS.indexOf(topic)
  const plan = DAYS.find((d) => d.key === day) ?? DAYS[0]

  function selectTopic(key: TopicKey, scroll = false) {
    setTopic(key)
    setBounce((n) => n + 1)
    if (scroll) {
      document.getElementById('explore')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
    }
  }

  // The orbit gently follows the pointer.
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (prefersReducedMotion() || e.pointerType === 'touch' || !universeRef.current) return
    const r = universeRef.current.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    universeRef.current.style.setProperty('--tilt-x', `${(x * 10).toFixed(1)}px`)
    universeRef.current.style.setProperty('--tilt-y', `${(y * 8).toFixed(1)}px`)
  }
  function onPointerLeave() {
    universeRef.current?.style.setProperty('--tilt-x', '0px')
    universeRef.current?.style.setProperty('--tilt-y', '0px')
  }

  return (
    <div className={styles.page} data-motion-off={motionOff ? 'true' : 'false'}>
      <MarketingNavBar />

      <main>
        {/* ── Hero ── */}
        <section className={styles.hero} aria-labelledby="career-hero-title">
          <div className={`${styles.container} ${styles.heroInner}`}>
            <div className={styles.heroCopy}>
              <div className={styles.label}>360° Career View</div>
              <h1 id="career-hero-title">
                A resume lists what you&apos;ve done.<span className={styles.serif}>What&apos;s next?</span>
              </h1>
              <p>
                After a guided conversation, you&apos;ll receive an initial report covering your strengths, possible
                career directions, skills to develop, and next steps.
              </p>
              <div className={styles.heroButtons}>
                <a
                  className={styles.button}
                  href="#explore"
                  onClick={(e) => {
                    e.preventDefault()
                    document.getElementById('explore')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
                  }}
                >
                  Explore the sample report <span aria-hidden="true">↘</span>
                </a>
                <Link className={`${styles.button} ${styles.alt}`} to="/signup" state={{ explicitSignup: true }}>
                  Start my conversation <span aria-hidden="true">↗</span>
                </Link>
              </div>
              <div className={styles.heroFoot}>
                <span>About 15 minutes to start</span>
                <b>✦</b>
                <span>No resume required</span>
                <b>✦</b>
                <span>Initial insights, not a verdict</span>
              </div>
            </div>

            <div
              className={styles.universe}
              id="universe"
              ref={universeRef}
              aria-label="Explore the six parts of a 360 degree career view"
              onPointerMove={onPointerMove}
              onPointerLeave={onPointerLeave}
            >
              <div className={`${styles.ring} ${styles.r1}`} aria-hidden="true">
                <span className={styles.spark} />
              </div>
              <div className={`${styles.ring} ${styles.r2}`} aria-hidden="true" />
              <div className={`${styles.ring} ${styles.r3}`} aria-hidden="true" />
              <div className={styles.core} aria-hidden="true">
                <div className={styles.coreNumber}>360°</div>
                <div className={styles.coreCaption}>career view</div>
              </div>

              {KEYS.map((key, i) => {
                const [dl, dt, ml, mt] = ORBIT_POSITIONS[i]
                const style = { '--x': `${dl}%`, '--y': `${dt}%`, '--mx': `${ml}%`, '--my': `${mt}%` } as CSSProperties
                return (
                  <button
                    key={key}
                    type="button"
                    className={`${styles.orbit} ${topic === key ? styles.active : ''}`}
                    style={style}
                    aria-label={ORBIT_LABELS[key].aria}
                    aria-pressed={topic === key}
                    onClick={() => selectTopic(key, true)}
                    onMouseEnter={() => {
                      if (window.matchMedia?.('(hover:hover)').matches) selectTopic(key, false)
                    }}
                  >
                    {ORBIT_LABELS[key].text}
                  </button>
                )
              })}

              <div className={styles.insight} aria-live="polite">
                Tap a point to explore <strong>{item.short}</strong>
              </div>
              <button
                type="button"
                className={styles.motionButton}
                aria-label={motionOff ? 'Play decorative animation' : 'Pause decorative animation'}
                aria-pressed={motionOff}
                title={motionOff ? 'Play animation' : 'Pause animation'}
                onClick={() => setMotionOff((v) => !v)}
              >
                {motionOff ? '▶' : 'Ⅱ'}
              </button>
            </div>
          </div>
          <a
            className={styles.floatNote}
            href="#explore"
            onClick={(e) => {
              e.preventDefault()
              document.getElementById('explore')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
            }}
          >
            See what&apos;s inside <span>↓</span>
          </a>
        </section>

        {/* ── At a glance ── */}
        <div className={styles.bridge} aria-label="At a glance">
          <div className={`${styles.container} ${styles.bridgeGrid}`}>
            <div className={styles.bridgeItem}>
              <strong>01</strong>
              <span>guided conversation</span>
            </div>
            <div className={styles.bridgeLine} aria-hidden="true" />
            <div className={styles.bridgeItem}>
              <strong>06</strong>
              <span>areas to explore</span>
            </div>
            <div className={styles.bridgeLine} aria-hidden="true" />
            <div className={styles.bridgeItem}>
              <strong>30·60·90</strong>
              <span>day action plan</span>
            </div>
          </div>
        </div>

        {/* ── Sample report ── */}
        <section className={styles.lab} id="explore" aria-labelledby="lab-title">
          <div className={styles.container}>
            <div className={styles.labHeading}>
              <div>
                <div className={styles.label}>A sample report</div>
                <h2 id="lab-title">
                  What does a 360° report
                  <br />
                  <em className={styles.serif}>actually show?</em>
                </h2>
              </div>
              <p>
                This example is about someone who helped organise a college festival. Choose a section to see the kind
                of feedback they might receive.
              </p>
            </div>

            <div className={styles.metricsRibbon}>
              <div className={styles.metricCard}>
                <span className={styles.metricVal}>94%</span>
                <span className={styles.metricTitle}>Overall Match %</span>
                <span className={styles.metricSub}>Role track baseline fit</span>
              </div>
              <div className={styles.metricCard}>
                <span className={styles.metricVal}>06</span>
                <span className={styles.metricTitle}>Core Strengths</span>
                <span className={styles.metricSub}>Deep behavioral signals</span>
              </div>
              <div className={styles.metricCard}>
                <span className={styles.metricVal}>82/100</span>
                <span className={styles.metricTitle}>Career Score</span>
                <span className={styles.metricSub}>Same as the interview score</span>
              </div>
              <div className={styles.metricCard}>
                <span className={styles.metricVal}>₹89</span>
                <span className={styles.metricTitle}>Full Retake Pass</span>
                <span className={styles.metricSub}>Instant score refresh</span>
              </div>
            </div>

            <div className={styles.reportStage} id="sample-report">
              <div className={styles.pageIndex}>
                <div className={styles.pageIndexHead}>Sample career report / 06 chapters</div>
                <div className={styles.pageTabList} role="tablist" aria-label="Explore the six parts of a sample career report">
                  {KEYS.map((key, i) => (
                    <button
                      key={key}
                      type="button"
                      className={styles.pageTab}
                      role="tab"
                      id={`tab-${key}`}
                      aria-selected={topic === key}
                      aria-controls="report-panel"
                      tabIndex={topic === key ? 0 : -1}
                      onClick={() => selectTopic(key)}
                      onKeyDown={(e) => tabKeys(e, i, KEYS.length, true, (n) => selectTopic(KEYS[n]), KEYS.map((k) => `tab-${k}`))}
                    >
                      <span>{String(i + 1).padStart(2, '0')}</span> {TAB_LABELS[key]}
                    </button>
                  ))}
                </div>
                <div className={styles.indexSmall}>This sample is made up. The real report depends on your own conversation.</div>
              </div>

              <div className={styles.reportPaper} id="report-panel" role="tabpanel" aria-labelledby={`tab-${topic}`} tabIndex={0}>
                <div className={styles.paperHead}>
                  <span>HireRighttt / Career view</span>
                  <strong>{String(topicIndex + 1).padStart(2, '0')} — 06</strong>
                  <span>Illustrative report</span>
                </div>
                <div className={styles.paperGrid}>
                  <div className={styles.paperText}>
                    <div className={styles.paperKicker}>{item.label}</div>
                    <h3>{item.title}</h3>
                    <p>{item.explain}</p>
                    <div className={styles.exampleCard}>
                      <small>What you told us · fictional example</small>
                      <p>{item.example}</p>
                    </div>
                  </div>
                  <div className={styles.paperArt} aria-hidden="true">
                    <div className={styles.artOrbit} />
                    <div className={`${styles.artOrbit} ${styles.artOrbit2}`} />
                    <div className={`${styles.artLabel} ${styles.l1}`}>{item.art1}</div>
                    <div className={`${styles.artLabel} ${styles.l2}`}>{item.art2}</div>
                    <div key={bounce} className={`${styles.artIcon} ${bounce > 0 ? styles.bounce : ''}`}>
                      {item.symbol}
                    </div>
                  </div>
                </div>
                <div className={styles.paperFooter}>
                  <div className={styles.takeaway}>
                    <div className={styles.takeawayBadge} aria-hidden="true">
                      ↗
                    </div>
                    <div>
                      <strong>One thing you could try</strong>
                      <p>{item.action}</p>
                    </div>
                  </div>
                  <div className={styles.paperControls}>
                    <button type="button" className={styles.roundBtn} aria-label="Previous report chapter" onClick={() => selectTopic(KEYS[(topicIndex - 1 + KEYS.length) % KEYS.length])}>
                      ←
                    </button>
                    <button type="button" className={styles.roundBtn} aria-label="Next report chapter" onClick={() => selectTopic(KEYS[(topicIndex + 1) % KEYS.length])}>
                      →
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.finePrint}>This is a fictional example, not an assessment or certification. It doesn&apos;t predict hiring outcomes.</div>
          </div>
        </section>

        {/* ── Roadmap ── */}
        <section className={styles.roadmap} aria-labelledby="roadmap-title">
          <div className={`${styles.container} ${styles.roadmapGrid}`}>
            <div>
              <div className={styles.label}>Putting it to use</div>
              <h2 id="roadmap-title">
                What should you <em className={styles.serif}>work on first?</em>
              </h2>
              <p className={styles.intro}>
                A report can suggest areas to work on. Here&apos;s an example of how to turn those suggestions into a plan,
                without trying to change everything at once.
              </p>
              <Link to="/signup" state={{ explicitSignup: true }} className={styles.textLink}>
                Start your conversation <span aria-hidden="true">↗</span>
              </Link>
            </div>

            <div className={styles.planCanvas}>
              <div className={styles.planTop}>An example 30 / 60 / 90 day plan</div>
              <div className={styles.milestones} role="tablist" aria-label="Explore example career plan milestones">
                {DAYS.map((d, i) => (
                  <button
                    key={d.key}
                    type="button"
                    className={styles.milestone}
                    id={`day-tab-${d.key}`}
                    role="tab"
                    aria-selected={day === d.key}
                    aria-controls="plan-content"
                    tabIndex={day === d.key ? 0 : -1}
                    onClick={() => setDay(d.key)}
                    onKeyDown={(e) => tabKeys(e, i, DAYS.length, false, (n) => setDay(DAYS[n].key), DAYS.map((x) => `day-tab-${x.key}`))}
                  >
                    <span className={styles.bubble}>{d.key}</span>
                    <span className={styles.dayName}>Day {d.key}</span>
                    <span className={styles.sub}>{d.sub}</span>
                  </button>
                ))}
              </div>
              <div className={styles.planMessage} id="plan-content" role="tabpanel" tabIndex={0} aria-labelledby={`day-tab-${day}`}>
                <strong>{plan.title}</strong>
                <p>{plan.text}</p>
              </div>
              <div className={styles.planAside}>An illustrative plan, not a promise of results.</div>
              <div className={styles.privacyNote}>
                <strong>Your report stays yours.</strong> You choose what to share with employers.{' '}
                <Link to="/privacy">Read about privacy.</Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── Closing ── */}
        <section className={styles.final} aria-labelledby="end-title">
          <div className={styles.container}>
            <div className={styles.finalInner}>
              <div>
                <h2 id="end-title">
                  Curious what your own
                  <br />
                  <em className={styles.serif}>report might say?</em>
                </h2>
                <p>Start by talking about what you’ve done, what you enjoy, and the roles you’re considering.</p>
              </div>
              <Link className={styles.button} to="/signup" state={{ explicitSignup: true }}>
                Get started <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
