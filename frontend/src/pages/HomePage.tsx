import { useState, useRef, type FormEvent, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useScroll, useTransform, type MotionValue } from 'framer-motion'
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

interface StageInfo {
  id: string
  label: string
  title: string
  description: string
  focusTags: string[]
  image: string
}

const CAREER_STAGES: StageInfo[] = [
  {
    id: 'students',
    label: 'students',
    title: 'students',
    description: 'explore careers, understand your interests and learn what future roles may require.',
    focusTags: ['career exploration', 'foundational strengths', 'internship readiness'],
    image: '/assets/students-group.jpg',
  },
  {
    id: 'graduates',
    label: 'fresh graduates',
    title: 'fresh graduates',
    description: 'bridge the gap between coursework and industry expectations, discover initial job roles, and practice your first professional interviews.',
    focusTags: ['entry roles', 'communication skills', 'first-job readiness'],
    image: '/hero-candidate-new.jpg',
  },
  {
    id: 'job-seekers',
    label: 'job seekers',
    title: 'job seekers',
    description: 'discover how to stand out from typical applicant pools, uncover unrecognized strengths, and present a verified 360° view to recruiters.',
    focusTags: ['interview practice', 'standing out', 'verified capabilities'],
    image: '/sidebar_talent_workspace.jpg',
  },
  {
    id: 'professionals',
    label: 'working professionals',
    title: 'working professionals',
    description: 'evaluate promotion readiness, benchmark leadership competencies, and plan structured lateral or upward career moves with confidence.',
    focusTags: ['promotion roadmap', 'leadership competencies', 'market alignment'],
    image: '/hero-professional.jpg',
  },
  {
    id: 'switchers',
    label: 'career switchers',
    title: 'career switchers',
    description: 'map your transferable skills into new industries, pinpoint exact knowledge gaps, and tell your transition story credibly.',
    focusTags: ['transferable skills', 'targeted bridge skills', 'role transition'],
    image: '/african_exec_hero.jpg',
  },
]

interface ConversationStage {
  id: string
  time: string
  title: string
  description: string
  purpleTags: string[]
  neutralTags: string[]
}

const CONVERSATION_STAGES: ConversationStage[] = [
  {
    id: 'stage-1',
    time: '9:05 pm',
    title: 'talk for 15 minutes',
    description:
      'have a natural ai-guided conversation about your interests, experiences, skills, aspirations and challenges.',
    purpleTags: ['ai-guided conversation'],
    neutralTags: ['no resume needed'],
  },
  {
    id: 'stage-2',
    time: '9:20 pm',
    title: 'discover your 360° view',
    description:
      'receive initial insights into strengths, potential gaps, communication, career direction and job readiness.',
    purpleTags: ['initial insights', 'strengths'],
    neutralTags: ['gaps'],
  },
  {
    id: 'stage-3',
    time: '9:25 pm',
    title: 'know your next steps',
    description:
      'get prioritized recommendations for career exploration, skill improvement and interview preparation.',
    purpleTags: ['prioritized recommendations'],
    neutralTags: [],
  },
  {
    id: 'stage-4',
    time: 'next week',
    title: 'keep moving forward',
    description:
      'practice interviews, follow a development plan and update your insights as you improve.',
    purpleTags: ['interview practice', 'development plan', 'updated insights'],
    neutralTags: ['apply to jobs', 'interviews'],
  },
]

function TimelineStepCard({
  stage,
  index,
  scrollYProgress,
}: {
  stage: ConversationStage
  index: number
  scrollYProgress: MotionValue<number>
}) {
  const start = index === 0 ? 0 : index * 0.22 - 0.04
  const end = index === 0 ? 0.08 : index * 0.22 + 0.12

  const opacity = useTransform(
    scrollYProgress,
    [start, end],
    [index === 0 ? 1 : 0.28, 1],
  )
  const scale = useTransform(
    scrollYProgress,
    [start, end],
    [index === 0 ? 1 : 0.98, 1],
  )
  const y = useTransform(
    scrollYProgress,
    [start, end],
    [index === 0 ? 0 : 12, 0],
  )
  const nodeBorder = useTransform(
    scrollYProgress,
    [start, end],
    [index === 0 ? '#6C47FF' : '#E2E8F0', '#6C47FF'],
  )
  const dotScale = useTransform(
    scrollYProgress,
    [start, end],
    [index === 0 ? 1 : 0.75, 1],
  )
  const dotColor = useTransform(
    scrollYProgress,
    [start, end],
    [index === 0 ? '#6C47FF' : '#CBD5E1', '#6C47FF'],
  )
  const haloOpacity = useTransform(
    scrollYProgress,
    [start, end],
    [index === 0 ? 1 : 0, 1],
  )

  return (
    <motion.div style={{ opacity, scale, y }} className={styles.timelineStepMotion}>
      <motion.div style={{ borderColor: nodeBorder }} className={styles.stepDot}>
        <motion.div
          style={{ opacity: haloOpacity }}
          className={styles.stepDotHalo}
          aria-hidden="true"
        />
        <motion.div
          style={{ scale: dotScale, backgroundColor: dotColor }}
          className={styles.stepDotInner}
        />
      </motion.div>
      <div className={styles.stepContent}>
        <div className={styles.stepHeader}>
          <span className={styles.stepTimeTitle}>
            {stage.time} · {stage.title}
          </span>
        </div>
        <p className={styles.stepDescription}>{stage.description}</p>
        <div className={styles.stepTagsRow}>
          {stage.purpleTags.map((tag) => (
            <span key={tag} className={styles.stageBadgePurple}>
              {tag}
            </span>
          ))}
          {stage.neutralTags.map((tag) => (
            <span key={tag} className={styles.stageBadgeNeutral}>
              {tag}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

export function HomePage() {
  const navigate = useNavigate()
  const [showSampleModal, setShowSampleModal] = useState(false)
  const [activeStageId, setActiveStageId] = useState('students')

  // Timeline scroll-driven interactive track
  const timelineRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress: timelineScrollProgress } = useScroll({
    target: timelineRef,
    offset: ['start 75%', 'end 70%'],
  })
  const timelineLineHeight = useTransform(timelineScrollProgress, [0, 0.95], ['0%', '100%'])

  // Fast start form state in closing midnight section
  const [roleSelection, setRoleSelection] = useState<'candidate' | 'vendor'>('candidate')
  const [firstName, setFirstName] = useState('')

  const resumeFileInputRef = useRef<HTMLInputElement>(null)

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
          state: { from: '/onboarding', reason: 'upload_resume' },
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
      navigate('/signup', { state: { reason: 'upload_resume' } })
    }

    if (e.target) {
      e.target.value = ''
    }
  }

  function handleRecruiterClick() {
    const user = getUser()
    if (user && user.role === 'employer') {
      navigate('/employer/dashboard')
    } else {
      navigate('/signup?role=employer')
    }
  }

  const activeStage = CAREER_STAGES.find((s) => s.id === activeStageId) || CAREER_STAGES[0]

  function handleFastStartSubmit(e: FormEvent) {
    e.preventDefault()
    if (roleSelection === 'vendor') {
      navigate('/signup?role=employer')
    } else {
      navigate('/signup', {
        state: { firstName: firstName.trim() || undefined, reason: 'fast_start_discovery' },
      })
    }
  }

  function handleVendorClick() {
    navigate('/signup?role=employer')
  }

  return (
    <div className={styles.page}>
      {/* Hidden file input triggered by "Upload Resume" capsule */}
      <input
        ref={resumeFileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={handleResumeFileSelected}
        aria-hidden="true"
      />

      {/* Existing navigation bar untouched */}
      <MarketingNavBar />

      {/* ====================================================================
          Section 1: Hero Section (9:00 PM)
          ==================================================================== */}
      <section className={styles.heroSection}>
        <div className={styles.heroContainer}>
          <div className={styles.heroGrid}>
            <div className={styles.heroLeft}>
              <h1 className={styles.editorialH1}>
                Your Future Starts with{' '}
                <span className={styles.heroBlueHighlight}>Understanding You.</span>
              </h1>

              <p className={styles.subheadSerif}>
                one 15-minute conversation. your 360° career view.
              </p>

              <p className={styles.leadText}>
                whether you&apos;re a student exploring your future, searching for your first job,
                preparing for your next opportunity, or planning a career change, hirerighttt helps
                you discover your strengths, understand where you can improve, and take the right
                next step.
              </p>

              {/* Dual Action Pills (Upload Resume & For Recruiters) */}
              <div className={styles.heroCapsuleStack}>
                {/* Pill 1: Upload Resume */}
                <div
                  className={styles.capsuleCard}
                  onClick={handleResumeUploadClick}
                  role="button"
                  tabIndex={0}
                  aria-label="Upload your resume"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleResumeUploadClick()
                    }
                  }}
                >
                  <div className={styles.capsuleLeft}>
                    <span className={styles.capsuleTextPrimary}>Upload your resume</span>
                    <span className={styles.capsuleTextSecondary}>(PDF, DOC, DOCX)</span>
                  </div>
                  <button
                    type="button"
                    className={styles.capsuleActionBtn}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleResumeUploadClick()
                    }}
                  >
                    <span>Upload Resume</span>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </button>
                </div>

                {/* Pill 2: For Recruiters */}
                <div
                  className={styles.capsuleCard}
                  onClick={handleRecruiterClick}
                  role="button"
                  tabIndex={0}
                  aria-label="Hiring? Meet talent that's ready."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleRecruiterClick()
                    }
                  }}
                >
                  <div className={styles.capsuleLeft}>
                    <div className={styles.recruiterIconCircle}>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#6366F1"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </div>
                    <span className={styles.capsuleTextPrimary}>
                      Hiring? Meet talent that&apos;s ready.
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.capsuleActionBtn}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRecruiterClick()
                    }}
                  >
                    <span>For Recruiters</span>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 2: The Questions That Keep You Up (9:02 PM)
          ==================================================================== */}
      <section className={styles.questionsSection}>
        <div className={styles.container}>
          <div className={styles.splitGrid}>
            <div>
              <div className={styles.kicker}>
                <span className={styles.kickerDot} />
                9:02 pm · the questions that keep you up
              </div>

              <h2 className={styles.editorialH2}>
                great potential
                <br />
                deserves
                <br />
                clear direction.
              </h2>

              <div className={styles.questionsList}>
                <div className={styles.questionItem}>not sure which career is right for you?</div>
                <div className={styles.questionItem}>applying for jobs but struggling to stand out?</div>
                <div className={styles.questionItem}>
                  preparing for interviews without knowing what to focus on?
                </div>
              </div>

              <p className={styles.bodyText}>
                every career journey brings different questions. hirerighttt starts by listening, then
                helps you turn uncertainty into a practical plan.
              </p>

              <p
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: '1.25rem',
                  fontStyle: 'italic',
                  color: 'var(--color-primary)',
                  margin: 0,
                }}
              >
                we don&apos;t start with a form. we start with you.
              </p>
            </div>

            {/* Cozy Late Night Desk Illustration */}
            <div className={styles.deskIllustrationWrap}>
              <svg width="280" height="200" viewBox="0 0 280 200" fill="none" aria-hidden="true">
                <rect x="20" y="160" width="240" height="8" rx="4" fill="#D4CCC0" />
                <rect x="50" y="168" width="10" height="28" rx="2" fill="#BAAF9E" />
                <rect x="220" y="168" width="10" height="28" rx="2" fill="#BAAF9E" />
                {/* Desk Lamp */}
                <path d="M70 160 L90 90 L115 105" stroke="#6C47FF" strokeWidth="4" strokeLinecap="round" />
                <path d="M105 85 L135 105 L115 125 Z" fill="#6C47FF" />
                <polygon points="125,108 200,160 135,160" fill="rgba(254, 240, 138, 0.35)" />
                {/* Laptop */}
                <rect x="130" y="115" width="80" height="45" rx="3" fill="#1C1838" />
                <rect x="135" y="120" width="70" height="35" rx="2" fill="#2E285C" />
                <polygon points="120,160 220,160 210,155 130,155" fill="#A89E90" />
                {/* Coffee Mug */}
                <rect x="95" y="145" width="14" height="15" rx="3" fill="#E88065" />
                <path d="M109 148 C114 148 114 157 109 157" stroke="#E88065" strokeWidth="2" fill="none" />
              </svg>
              <span style={{ fontSize: '0.8rem', color: '#888099', marginTop: '0.5rem' }}>
                9:02 pm · reflection &amp; quiet focus
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 3: The Conversation Begins (9:05 PM)
          ==================================================================== */}
      <section className={styles.timelineSection}>
        <div className={styles.container}>
          <div className={styles.narrowContainer} style={{ padding: 0 }}>
            <div className={styles.kicker}>
              <span className={styles.kickerDot} />
              9:05 pm · the conversation begins
            </div>

            <h2 className={styles.editorialH2}>career clarity starts with a conversation.</h2>

            <div ref={timelineRef} className={styles.timelineScrollTrack}>
              {/* Continuous background track line */}
              <div className={styles.timelineBgLine} aria-hidden="true" />

              {/* Scroll-driven active purple fill line */}
              <motion.div
                style={{ height: timelineLineHeight }}
                className={styles.timelineActiveLine}
                aria-hidden="true"
              />

              {/* 4 sequential stage cards */}
              <div>
                {CONVERSATION_STAGES.map((stage, idx) => (
                  <TimelineStepCard
                    key={stage.id}
                    stage={stage}
                    index={idx}
                    scrollYProgress={timelineScrollProgress}
                  />
                ))}
              </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
              <Link to="/signup" className={styles.primaryBtn}>
                start my 15-minute discovery
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 4: What the Conversation Shows (9:20 PM - 360° Grid)
          ==================================================================== */}
      <section className={styles.reportGridSection}>
        <div className={styles.container}>
          <div className={styles.narrowContainer} style={{ textAlign: 'center', padding: 0 }}>
            <div className={styles.kicker}>
              <span className={styles.kickerDot} />
              9:20 pm · what the conversation shows
            </div>

            <h2 className={styles.editorialH2}>
              more than a score. a<br />
              clearer view of your career.
            </h2>

            <p className={styles.bodyText}>
              your personalized career intelligence report brings together what your first
              conversation reveals, and turns it into practical guidance you can act on.
            </p>
          </div>

          <div className={styles.reportCardsGrid}>
            <div className={styles.reportCard}>
              <h3 className={styles.reportCardTitle}>strengths &amp; potential</h3>
              <p className={styles.reportCardDesc}>
                recognize the strengths you demonstrate and the abilities you can build on.
              </p>
            </div>

            <div className={styles.reportCard}>
              <h3 className={styles.reportCardTitle}>career direction</h3>
              <p className={styles.reportCardDesc}>
                explore job roles and career paths aligned with your interests and aspirations.
              </p>
            </div>

            <div className={styles.reportCard}>
              <h3 className={styles.reportCardTitle}>skill gap discovery</h3>
              <p className={styles.reportCardDesc}>
                identify potential skills and knowledge gaps relevant to the direction you want to
                take.
              </p>
            </div>

            <div className={styles.reportCard}>
              <h3 className={styles.reportCardTitle}>communication insights</h3>
              <p className={styles.reportCardDesc}>
                understand how you express your ideas, experiences and goals.
              </p>
            </div>

            <div className={styles.reportCard}>
              <h3 className={styles.reportCardTitle}>job &amp; interview readiness</h3>
              <p className={styles.reportCardDesc}>
                see where to focus your preparation before pursuing opportunities.
              </p>
            </div>

            <div className={styles.reportCard}>
              <h3 className={styles.reportCardTitle}>personalized action roadmap</h3>
              <p className={styles.reportCardDesc}>
                get a practical plan with recommended priorities for the next 30, 60 and 90 days.
              </p>
            </div>
          </div>

          <div className={styles.narrowContainer} style={{ padding: 0 }}>
            <div className={styles.disclaimerNotice}>
              initial insights are based on a short conversation and are not a certification of
              ability. deeper assessments and practice help validate findings.
            </div>

            <div className={styles.reportCtaRow}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setShowSampleModal(true)}
              >
                view sample 360° report
              </button>
              <span className={styles.metaReassurance}>
                the sample is an example, not a real assessment
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 5: The Weeks After (Milestones)
          ==================================================================== */}
      <section className={styles.milestonesSection}>
        <div className={styles.container}>
          <div className={styles.kicker}>
            <span className={styles.kickerDot} />
            the weeks after · you&apos;re not on your own
          </div>

          <h2 className={styles.editorialH2}>
            we don&apos;t just show you what to
            <br />
            improve. we help you get there.
          </h2>

          <div className={styles.milestonesGrid}>
            <div className={styles.milestoneCard}>
              <span className={styles.milestoneDay}>day 3</span>
              <h3 className={styles.milestoneTitle}>ai interview practice</h3>
              <p className={styles.milestoneDesc}>
                prepare for technical, behavioral and hr interviews with guided, role-specific
                practice.
              </p>
              <div>
                <span className={styles.tagPill}>technical</span>
                <span className={styles.tagPill}>behavioral</span>
                <span className={styles.tagPill}>hr</span>
              </div>
            </div>

            <div className={styles.milestoneCard}>
              <span className={styles.milestoneDay}>day 12</span>
              <h3 className={styles.milestoneTitle}>personalized skill development</h3>
              <p className={styles.milestoneDesc}>
                know what to learn next and why it matters for your target role.
              </p>
              <div>
                <span className={styles.tagPill}>target role</span>
              </div>
            </div>

            <div className={styles.milestoneCard}>
              <span className={styles.milestoneDay}>day 30</span>
              <h3 className={styles.milestoneTitle}>career &amp; job readiness</h3>
              <p className={styles.milestoneDesc}>
                understand the capabilities employers may expect and prepare for relevant
                opportunities.
              </p>
              <div>
                <span className={styles.tagPill}>readiness</span>
              </div>
            </div>

            <div className={styles.milestoneCard}>
              <span className={styles.milestoneDay}>day 60</span>
              <h3 className={styles.milestoneTitle}>progress &amp; growth</h3>
              <p className={styles.milestoneDesc}>
                track completed actions and improve your career readiness over time.
              </p>
              <div>
                <span className={styles.tagPill}>progress tracking</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 6: When You're Ready (Day 45)
          ==================================================================== */}
      <section className={styles.readySection}>
        <div className={styles.container}>
          <div className={styles.readyContentWrap}>
            <div className={styles.kicker}>
              <span className={styles.kickerDot} />
              day 45 · when you feel ready
            </div>

            <h2 className={styles.editorialH2}>
              when you&apos;re
              <br />
              ready, the next
              <br />
              step is a real one.
            </h2>

            <p className={styles.bodyText} style={{ maxWidth: '680px' }}>
              vendors post the roles they are hiring for. you browse them, apply, and take the
              interview, with your preparation already behind you.
            </p>

            <div className={styles.threeColumnSteps}>
              <div className={styles.threeStepCard}>
                <span className={styles.threeStepCategory}>browse</span>
                <h3 className={styles.threeStepTitle}>see open roles</h3>
                <p className={styles.threeStepDesc}>read the requirements posted by vendors.</p>
              </div>

              <div className={styles.threeStepCard}>
                <span className={styles.threeStepCategory}>apply</span>
                <h3 className={styles.threeStepTitle}>apply with confidence</h3>
                <p className={styles.threeStepDesc}>
                  apply to roles that fit, and choose what you share.
                </p>
              </div>

              <div className={styles.threeStepCard}>
                <span className={styles.threeStepCategory}>interview</span>
                <h3 className={styles.threeStepTitle}>give the interview</h3>
                <p className={styles.threeStepDesc}>
                  take the interview for a role you applied to.
                </p>
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <span className={styles.tagPill}>job postings</span>
              <span className={styles.tagPill}>apply</span>
              <span className={styles.tagPill}>interview</span>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 7: For Vendors (Monday, 10:00 AM) - Redesigned matching Image 2
          ==================================================================== */}
      <section className={styles.vendorSection}>
        {/* Soft background aura */}
        <div className={styles.vendorBackgroundAura} aria-hidden="true" />

        <div className={styles.container}>
          <div className={styles.vendorLayoutGrid}>
            {/* Left Column */}
            <div className={styles.vendorLeftCol}>
              <div className={styles.vendorKickerPill}>
                <span className={styles.kickerDot} />
                monday, 10:00 am · for vendors, the other side of the table
              </div>

              <h2 className={styles.vendorHeading}>
                see the <span className={styles.italicPurple}>person</span>
                <br />
                behind the
                <br />
                application.
              </h2>

              <p className={styles.leadText} style={{ maxWidth: '520px' }}>
                vendors post the jobs they have open and what each role needs, read the career
                reports of candidates who apply, and interview the people who fit.
              </p>

              <div className={styles.vendorChecklist}>
                <span className={styles.vendorCheckPill}>
                  <span className={styles.vendorCheckPillCheck}>✓</span> post job requirements
                </span>
                <span className={styles.vendorCheckPill}>
                  <span className={styles.vendorCheckPillCheck}>✓</span> review candidate reports
                </span>
                <span className={styles.vendorCheckPill}>
                  <span className={styles.vendorCheckPillCheck}>✓</span> interview applicants
                </span>
              </div>

              <div>
                <button
                  type="button"
                  className={styles.vendorPrimaryBtn}
                  onClick={handleVendorClick}
                >
                  <span>I&apos;m a vendor</span>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </button>
              </div>

              <div className={styles.vendorDisclaimerBox}>
                <svg
                  className={styles.infoIcon}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>
                  reports are initial insights from a short conversation. they support your judgment
                  and do not replace it. candidates decide what they share.
                </span>
              </div>
            </div>

            {/* Right Column: Layered Mockup Card */}
            <div className={styles.vendorCardStackWrap}>
              <div className={styles.vendorBackdropLayer} aria-hidden="true" />

              <div className={styles.vendorPreviewMockup}>
                <div className={styles.vendorMockupHeader}>
                  <span className={styles.vendorMockupTitleSmall}>EXAMPLE VENDOR VIEW</span>
                  <span className={styles.mockupDisclaimerPill}>made-up candidates, not real data</span>
                </div>

                <div className={styles.roleTitleRow}>
                  <h4 className={styles.vendorMockupRole}>junior business analyst</h4>
                  <span className={styles.openRolePill}>
                    <span className={styles.openRoleDot} />
                    open role
                  </span>
                </div>

                <div className={styles.roleSkillsRow}>
                  <span className={styles.skillRequirementPill}>clear communication</span>
                  <span className={styles.skillRequirementPill}>spreadsheets</span>
                  <span className={styles.skillRequirementPill}>basic sql</span>
                </div>

                {/* Candidate A Card */}
                <div className={styles.candidateMockupCard}>
                  <div className={styles.candidateAvatarA}>A</div>
                  <div className={styles.candidateContent}>
                    <div className={styles.candidateMockupName}>candidate a</div>
                    <p className={styles.candidateMockupBio}>
                      shared career view: explains ideas clearly, curious about data. focus area:
                      sql practice.
                    </p>
                    <div>
                      <span className={styles.pillStrengths}>strengths</span>
                      <span className={styles.pillSkillGaps}>skill gaps</span>
                      <span className={styles.pillReadiness}>interview readiness</span>
                    </div>
                  </div>
                </div>

                {/* Candidate B Card */}
                <div className={styles.candidateMockupCard}>
                  <div className={styles.candidateAvatarB}>B</div>
                  <div className={styles.candidateContent}>
                    <div className={styles.candidateMockupName}>candidate b</div>
                    <p className={styles.candidateMockupBio}>
                      shared career view: strong in operations, moving from support. focus area:
                      structured interview answers.
                    </p>
                    <div>
                      <span className={styles.pillSwitcher}>career switcher</span>
                      <span className={styles.pillReadiness}>readiness focus</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 8: Whatever Your Career Stage (Interactive Switcher)
          ==================================================================== */}
      <section className={styles.stagesSection}>
        <div className={styles.container}>
          <div className={styles.kicker}>
            <span className={styles.kickerDot} />
            any morning · whoever you are
          </div>

          <h2 className={styles.editorialH2}>
            whatever your career
            <br />
            stage, there&apos;s a next step.
          </h2>

          <div className={styles.stageTabRow}>
            {CAREER_STAGES.map((stage) => (
              <button
                key={stage.id}
                type="button"
                className={`${styles.stageTabBtn} ${
                  activeStageId === stage.id ? styles.stageTabBtnActive : ''
                }`}
                onClick={() => setActiveStageId(stage.id)}
              >
                {stage.label}
              </button>
            ))}
          </div>

          <div className={styles.stagePreviewCard}>
            <div className={styles.stageContentCol}>
              <h3 className={styles.editorialH2} style={{ fontSize: '2rem' }}>
                {activeStage.title}
              </h3>
              <p className={styles.leadText}>{activeStage.description}</p>
              <div>
                {activeStage.focusTags.map((t) => (
                  <span key={t} className={styles.tagPill}>
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.stageImageWrap}>
              <img
                src={activeStage.image}
                alt={activeStage.title}
                className={styles.stageImage}
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 9: What Makes This Different (Comparison)
          ==================================================================== */}
      <section className={styles.differentiatorSection}>
        <div className={styles.container}>
          <div className={styles.kicker}>
            <span className={styles.kickerDot} />
            before you decide · what makes this different
          </div>

          <h2 className={styles.editorialH2}>
            not just another job portal. a career
            <br />
            companion that starts with you.
          </h2>

          <div className={styles.comparisonThreeCol}>
            <div className={styles.comparisonColCard}>
              <h3 className={styles.comparisonColTitle}>job portals</h3>
              <p className={styles.comparisonColBody}>show openings.</p>
            </div>

            <div className={styles.comparisonColCard}>
              <h3 className={styles.comparisonColTitle}>courses</h3>
              <p className={styles.comparisonColBody}>teach individual skills.</p>
            </div>

            <div className={styles.comparisonColCard}>
              <h3 className={styles.comparisonColTitle}>interview tools</h3>
              <p className={styles.comparisonColBody}>focus on practice.</p>
            </div>
          </div>

          <div className={styles.narrowContainer} style={{ padding: 0 }}>
            <p className={styles.leadText}>
              hirerighttt starts by understanding your career situation and connects discovery,
              guidance and improvement in one experience.
            </p>
            <div className={styles.punchlineQuote}>
              from &ldquo;what should i do?&rdquo; to &ldquo;here&apos;s my next step.&rdquo;
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 10: You Decide How Much to Share (Privacy & Expectations)
          ==================================================================== */}
      <section className={styles.privacySection}>
        <div className={styles.container}>
          <div className={styles.narrowContainer} style={{ padding: 0 }}>
            <div className={styles.kicker}>
              <span className={styles.kickerDot} />
              before you begin · what to expect
            </div>

            <h2 className={styles.editorialH2}>you decide how much to share.</h2>

            <div className={styles.principlesStack}>
              <div className={styles.principleRow}>
                <span className={styles.principleTitle}>nothing mandatory first.</span>
                <p className={styles.principleDesc}>
                  no long profile or resume upload before you start. you can add more later if you
                  choose.
                </p>
              </div>

              <div className={styles.principleRow}>
                <span className={styles.principleTitle}>your voice only with your permission.</span>
                <p className={styles.principleDesc}>
                  if voice is available, we ask first. a text option is offered where supported.
                </p>
              </div>

              <div className={styles.principleRow}>
                <span className={styles.principleTitle}>a clear notice before personal details.</span>
                <p className={styles.principleDesc}>
                  you&apos;ll see the privacy notice before any personal information is collected.
                </p>
              </div>

              <div className={styles.principleRow}>
                <span className={styles.principleTitle}>you choose what vendors see.</span>
                <p className={styles.principleDesc}>
                  vendors read your report only when you apply or choose to share it.
                </p>
              </div>

              <div className={styles.principleRow}>
                <span className={styles.principleTitle}>a first look, not a verdict.</span>
                <p className={styles.principleDesc}>
                  insights are initial, not a certification of ability, and we never promise a job.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 13: Closing Midnight Action Section (10:30 PM)
          ==================================================================== */}
      <section className={styles.closingSection}>
        <div className={styles.container}>
          <div className={styles.closingGrid}>
            <div>
              <div
                className={styles.kicker}
                style={{ color: 'var(--color-dark-muted)' }}
              >
                <span
                  className={styles.kickerDot}
                  style={{ backgroundColor: '#A78BFA' }}
                />
                10:30 pm · you breathe out
              </div>

              <h2 className={styles.closingH2}>
                your next
                <br />
                opportunity
                <br />
                starts with one
                <br />
                conversation.
              </h2>

              <p className={styles.closingLead}>
                give yourself 15 minutes to understand your strengths, discover what to work on,
                and build a clearer path toward the career you want.
              </p>

              <div className={styles.roleToggleWrap}>
                <span className={styles.roleToggleLabel}>i&apos;m joining as</span>
                <button
                  type="button"
                  className={`${styles.roleToggleBtn} ${
                    roleSelection === 'candidate' ? styles.roleToggleBtnActive : ''
                  }`}
                  onClick={() => setRoleSelection('candidate')}
                >
                  a candidate
                </button>
                <button
                  type="button"
                  className={`${styles.roleToggleBtn} ${
                    roleSelection === 'vendor' ? styles.roleToggleBtnActive : ''
                  }`}
                  onClick={() => setRoleSelection('vendor')}
                >
                  a vendor
                </button>
              </div>

              {/* Fast start form */}
              <form className={styles.fastStartCard} onSubmit={handleFastStartSubmit}>
                <span className={styles.stepIndicator}>step 1 of 1 · what should we call you?</span>
                <input
                  type="text"
                  className={styles.fastStartInput}
                  placeholder="your first name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
                <button type="submit" className={styles.primaryBtn} style={{ width: '100%' }}>
                  start my career discovery
                </button>
                <span
                  style={{
                    fontSize: '0.785rem',
                    color: 'var(--color-dark-muted)',
                    textAlign: 'center',
                  }}
                >
                  no resume required to get started • personalized ai-powered guidance
                </span>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 14: Marketing Footer (Matching PDF)
          ==================================================================== */}
      <footer className={styles.marketingFooter}>
        <div className={styles.container}>
          <div className={styles.footerInner}>
            <div className={styles.footerBrand}>
              HireRighttt
              <span style={{ fontSize: '0.85rem', color: '#8880A8', marginLeft: '0.75rem' }}>
                your personal ai career companion
              </span>
            </div>

            <div className={styles.footerLinks}>
              <Link to="/" className={styles.footerLink}>
                home
              </Link>
              <Link to="/how-it-works" className={styles.footerLink}>
                how it works
              </Link>
              <Link to="/signup?role=employer" className={styles.footerLink}>
                for vendors
              </Link>
              <Link to="/faqs" className={styles.footerLink}>
                faqs
              </Link>
            </div>
          </div>

          <p className={styles.footerCopyright}>
            © 2026 HireRighttt. all rights reserved. [replace legal entity, contact address,
            privacy and terms links before launch]
          </p>
        </div>
      </footer>

      {/* ====================================================================
          Sample 360° Career Intelligence Report Modal Preview
          ==================================================================== */}
      <AnimatePresence>
        {showSampleModal && (
          <motion.div
            className={styles.modalBackdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowSampleModal(false)}
          >
            <motion.div
              className={styles.modalContent}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setShowSampleModal(false)}
                aria-label="Close Sample Report"
              >
                ✕
              </button>

              <span className={styles.sampleBadge}>Sample 360° Career Intelligence Report</span>

              <h2
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: '1.85rem',
                  fontWeight: 500,
                  color: '#181424',
                  margin: '0 0 0.4rem 0',
                }}
              >
                Junior Business &amp; Product Analyst
              </h2>
              <p style={{ color: '#6A637C', fontSize: '0.95rem', margin: '0 0 1.5rem 0' }}>
                Generated after a 15-minute voice discovery conversation with your AI career
                companion.
              </p>

              <div className={styles.sampleReportGrid}>
                <div className={styles.sampleMetricCard}>
                  <div className={styles.metricScore}>94%</div>
                  <div className={styles.metricTitle}>Strengths &amp; Potential</div>
                  <div className={styles.metricDetail}>
                    Demonstrates rapid synthesis, curious problem solving, and clear structured
                    articulation.
                  </div>
                </div>

                <div className={styles.sampleMetricCard}>
                  <div className={styles.metricScore}>88%</div>
                  <div className={styles.metricTitle}>Communication Insights</div>
                  <div className={styles.metricDetail}>
                    Explains complex thoughts clearly; shows high active listening and stakeholder
                    awareness.
                  </div>
                </div>

                <div className={styles.sampleMetricCard}>
                  <div className={styles.metricScore}>76%</div>
                  <div className={styles.metricTitle}>Skill Gap Discovery</div>
                  <div className={styles.metricDetail}>
                    Identified targeted area for growth: practical SQL data queries and financial
                    spreadsheets.
                  </div>
                </div>

                <div className={styles.sampleMetricCard}>
                  <div className={styles.metricScore}>91%</div>
                  <div className={styles.metricTitle}>Job &amp; Interview Readiness</div>
                  <div className={styles.metricDetail}>
                    Strong candidate for entry-level analyst and associate consulting pathways.
                  </div>
                </div>
              </div>

              <div
                style={{
                  backgroundColor: '#FAF8F5',
                  border: '1px solid #EAE5DE',
                  borderRadius: '12px',
                  padding: '1rem 1.25rem',
                  marginBottom: '1.5rem',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.35rem' }}>
                  Personalized 30-60-90 Day Roadmap Preview
                </div>
                <div style={{ fontSize: '0.85rem', color: '#565063', lineHeight: 1.5 }}>
                  • <strong>Next 30 Days:</strong> complete SQL basics and take guided technical interview practice.
                  <br />
                  • <strong>Next 60 Days:</strong> build two business case studies and refine behavioral story structures.
                  <br />
                  • <strong>Next 90 Days:</strong> apply to verified partner roles with unlocked candidate report.
                </div>
              </div>

              <div style={{ textAlign: 'center' }}>
                <Link
                  to="/signup"
                  className={styles.primaryBtn}
                  onClick={() => setShowSampleModal(false)}
                >
                  start my career discovery
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
