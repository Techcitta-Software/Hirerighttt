import { useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import styles from './WhyPage.module.css'

type Audience = 'candidate' | 'organization'

const AUDIENCES: { id: Audience; label: string }[] = [
  { id: 'candidate', label: "I'm looking for work" },
  { id: 'organization', label: "I'm hiring" },
]

const DIMENSIONS = ['Where it starts', 'What you get', 'What comes next']

const COMPARE: Record<Audience, { usual: string[]; ours: string[] }> = {
  candidate: {
    usual: [
      'Write a résumé and look for openings.',
      'Jobs to apply for, but little clarity about what to change.',
      'Find advice, practice, and opportunities in different places.',
    ],
    ours: [
      'Start with a conversation about you.',
      'An initial 360° view of strengths, gaps, and direction.',
      'Explore a next-step plan, interview practice, and roles together.',
    ],
  },
  organization: {
    usual: [
      'Use a CV and application to make an initial shortlist.',
      'See experience, but little of the person behind it.',
      'Spend time learning more during subsequent conversations.',
    ],
    ours: [
      'Invite applicants to share extra context, if they choose.',
      'Read initial career insights alongside their applications.',
      'Use those insights to ask better questions and make your own decision.',
    ],
  },
}

type Demo = {
  tab: string
  label: string
  title: string
  desc: string
  quote?: string
  chips?: string[]
}

const DEMOS: Demo[] = [
  {
    tab: 'The conversation',
    label: '01 / FIRST, A CONVERSATION',
    title: 'Tell us the bits a CV leaves out.',
    desc: 'No perfect answers. No résumé required to begin.',
    quote: 'What kind of work makes you feel most like yourself?',
  },
  {
    tab: 'Your 360° view',
    label: '02 / AN INITIAL 360° VIEW',
    title: 'See a little more of the picture.',
    desc: 'Explore strengths, possible paths, things to learn and interview readiness.',
    chips: ['Strengths', 'Career direction', 'Skill gaps', 'Next steps'],
  },
  {
    tab: 'What comes next',
    label: '03 / YOUR NEXT MOVE',
    title: 'Take one useful step.',
    desc: 'Practise an interview, develop a skill, or explore a role when you feel ready.',
    chips: ['Learn', 'Practise', 'Explore jobs'],
  },
]

/** Left/right arrows move between tabs, like a native tab list. */
function arrowNav(e: KeyboardEvent, index: number, count: number, go: (next: number) => void, focusIds: string[]) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  const next = (index + (e.key === 'ArrowLeft' ? -1 : 1) + count) % count
  go(next)
  document.getElementById(focusIds[next])?.focus()
}

export function WhyPage() {
  const [audience, setAudience] = useState<Audience>('candidate')
  const [step, setStep] = useState(0)
  const audienceIndex = AUDIENCES.findIndex((a) => a.id === audience)
  const rows = COMPARE[audience]
  const demo = DEMOS[step]

  return (
    <div className={styles.page}>
      <MarketingNavBar />

      <main id="top" className={styles.main}>
        {/* ── Hero: one thought ── */}
        <section className={styles.hero} aria-labelledby="why-hero-title">
          <div className={`${styles.container} ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>Why we exist</span>
              <h1 id="why-hero-title">
                Good people are <span className={styles.serif}>easy to miss.</span>
              </h1>
              <p>
                Maybe someone&apos;s brilliant at the work, but not at writing about it. Maybe there&apos;s a hiring
                manager with more applications than time. Somewhere between the two, a real opportunity gets lost.
              </p>
              <a
                href="#difference"
                className={styles.inlineLink}
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById('difference')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              >
                There&apos;s a better place to begin <span aria-hidden="true">↗</span>
              </a>
            </div>

            <div className={styles.heroVisual} aria-hidden="true">
              <svg viewBox="0 0 520 490" role="img">
                <circle cx="253" cy="246" r="170" className={styles.pathBase} />
                <circle cx="253" cy="246" r="121" className={styles.pathBase} />
                <path d="M40 394 C124 370 120 183 249 246 S380 142 488 82" className={styles.pathBase} />
                <path d="M50 75 C177 75 180 318 248 246 S361 390 478 419" className={styles.pathBase} />
                <path d="M40 394 C124 370 120 183 249 246 S380 142 488 82" className={styles.pathTravel} />
                <path
                  d="M50 75 C177 75 180 318 248 246 S361 390 478 419"
                  className={styles.pathTravel}
                  style={{ animationDirection: 'reverse', opacity: 0.48 }}
                />
                <circle cx="51" cy="75" r="6" className={`${styles.point} ${styles.pulse} ${styles.delayed}`} />
                <circle cx="482" cy="82" r="6" className={`${styles.point} ${styles.pulse}`} />
                <circle cx="478" cy="419" r="6" className={`${styles.point} ${styles.pulse} ${styles.delayed}`} />
                <circle cx="40" cy="394" r="6" className={`${styles.point} ${styles.pulse}`} />
                <circle cx="249" cy="246" r="14" className={styles.point} />
                <circle cx="249" cy="246" r="24" fill="none" className={styles.ring} />
                <text x="212" y="98" className={styles.artText}>POSSIBILITY</text>
                <text x="327" y="362" className={styles.artText}>OPPORTUNITY</text>
                <text x="204" y="217" className={styles.artSerif}>?</text>
              </svg>
            </div>
          </div>
        </section>

        {/* ── Comparison: one clean surface ── */}
        <section className={styles.compare} id="difference" aria-labelledby="compare-title">
          <div className={styles.container}>
            <div className={styles.sectionHead}>
              <div>
                <span className={styles.eyebrow}>HireRighttt vs. the usual way</span>
                <h2 id="compare-title">
                  A CV is useful. <span className={styles.serif}>It isn&apos;t the whole person.</span>
                </h2>
              </div>
              <p>
                Job boards help people find roles. Résumés help teams review experience. But what happens before and
                after the application matters too.
              </p>
            </div>

            <div className={styles.switcher} role="tablist" aria-label="Compare experiences">
              {AUDIENCES.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  role="tab"
                  id={`why-aud-${a.id}`}
                  aria-controls="compare-panel"
                  aria-selected={audience === a.id}
                  tabIndex={audience === a.id ? 0 : -1}
                  onClick={() => setAudience(a.id)}
                  onKeyDown={(e) =>
                    arrowNav(e, i, AUDIENCES.length, (n) => setAudience(AUDIENCES[n].id), AUDIENCES.map((x) => `why-aud-${x.id}`))
                  }
                >
                  {a.label}
                </button>
              ))}
            </div>

            <div
              id="compare-panel"
              className={styles.compareTable}
              role="tabpanel"
              tabIndex={0}
              aria-labelledby={`why-aud-${AUDIENCES[audienceIndex].id}`}
              aria-live="polite"
            >
              <div className={`${styles.compareRow} ${styles.tableHead}`}>
                <div />
                <div>The usual journey</div>
                <div>With HireRighttt</div>
              </div>
              {DIMENSIONS.map((dimension, i) => (
                <div className={styles.compareRow} key={dimension}>
                  <div className={styles.dimension}>{dimension}</div>
                  <div>{rows.usual[i]}</div>
                  <div>{rows.ours[i]}</div>
                </div>
              ))}
            </div>

            <p className={styles.smallprint}>
              A comparison of common journeys, not every hiring tool. The 360° view offers initial guidance, not a
              certified assessment or guarantee of a job.
            </p>
          </div>
        </section>

        {/* ── Product: one discovery moment ── */}
        <section className={styles.experience} id="product" aria-labelledby="product-title">
          <div className={`${styles.container} ${styles.experienceGrid}`}>
            <div>
              <span className={styles.eyebrow}>So what do we do differently?</span>
              <h2 id="product-title">
                We start by <span className={styles.serif}>listening.</span>
              </h2>
              <p className={styles.desc}>
                Fifteen minutes talking about what you&apos;ve done and where you&apos;d like to go. Then a clearer view
                of your strengths, what might need work, and what you could try next.
              </p>
              <div className={styles.stepNav} role="tablist" aria-label="See how HireRighttt works">
                {DEMOS.map((d, i) => (
                  <button
                    key={d.tab}
                    type="button"
                    role="tab"
                    id={`why-step-${i}`}
                    aria-controls="demo-panel"
                    aria-selected={step === i}
                    tabIndex={step === i ? 0 : -1}
                    onClick={() => setStep(i)}
                    onKeyDown={(e) => arrowNav(e, i, DEMOS.length, setStep, DEMOS.map((_, n) => `why-step-${n}`))}
                  >
                    {d.tab}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.demoPanel} id="demo-panel" role="tabpanel" tabIndex={0} aria-labelledby={`why-step-${step}`} aria-live="polite">
              {/* key restarts the fade each time the step changes */}
              <div key={step} className={styles.fadein}>
                <span className={styles.demoTop}>{demo.label}</span>
                <h3>{demo.title}</h3>
                <p>{demo.desc}</p>
                <div className={styles.demoContent}>
                  {demo.quote ? (
                    <q>{demo.quote}</q>
                  ) : (
                    <div className={styles.smallDemo}>
                      {demo.chips?.map((c) => (
                        <span className={styles.chip} key={c}>
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Close: clear paths ── */}
        <section className={styles.closing}>
          <div className={`${styles.container} ${styles.closingInner}`}>
            <h2>
              The next opportunity deserves <em>a better conversation.</em>
            </h2>
            <div className={styles.ctaGroup}>
              <Link to="/signup" state={{ explicitSignup: true }} className={styles.cta}>
                Start my conversation <span aria-hidden="true">↗</span>
              </Link>
              <Link to="/organizations/signup" state={{ explicitSignup: true }} className={`${styles.cta} ${styles.outline}`}>
                I&apos;m hiring <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
