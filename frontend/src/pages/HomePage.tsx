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
import { HomeHeroPreview } from '../components/HomeHeroPreview'
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
    label: 'Students',
    title: 'Students',
    description: 'Explore careers, understand your interests and learn what future roles may require.',
    focusTags: ['Career exploration', 'Foundational strengths', 'Internship readiness'],
    image: '/assets/students-group.jpg',
  },
  {
    id: 'graduates',
    label: 'Fresh graduates',
    title: 'Fresh graduates',
    description: 'Bridge the gap between coursework and industry expectations, discover initial job roles, and practice your first professional interviews.',
    focusTags: ['Entry roles', 'Communication skills', 'First-job readiness'],
    image: '/hero-candidate-new.jpg',
  },
  {
    id: 'job-seekers',
    label: 'Job seekers',
    title: 'Job seekers',
    description: 'Discover how to stand out from typical applicant pools, uncover unrecognized strengths, and present a verified 360° view to recruiters.',
    focusTags: ['Interview practice', 'Standing out', 'Verified capabilities'],
    image: '/sidebar_talent_workspace.jpg',
  },
  {
    id: 'professionals',
    label: 'Working professionals',
    title: 'Working professionals',
    description: 'Evaluate promotion readiness, benchmark leadership competencies, and plan structured lateral or upward career moves with confidence.',
    focusTags: ['Promotion roadmap', 'Leadership competencies', 'Market alignment'],
    image: '/hero-professional.jpg',
  },
  {
    id: 'switchers',
    label: 'Career switchers',
    title: 'Career switchers',
    description: 'Map your transferable skills into new industries, pinpoint exact knowledge gaps, and tell your transition story credibly.',
    focusTags: ['Transferable skills', 'Targeted bridge skills', 'Role transition'],
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
    time: '9:05 PM',
    title: 'Talk for 15 minutes',
    description:
      'have a natural ai-guided conversation about your interests, experiences, skills, aspirations and challenges.',
    purpleTags: ['AI-guided conversation'],
    neutralTags: ['No resume needed'],
  },
  {
    id: 'stage-2',
    time: '9:20 PM',
    title: 'Discover your 360° view',
    description:
      'receive initial insights into strengths, potential gaps, communication, career direction and job readiness.',
    purpleTags: ['Initial insights', 'Strengths'],
    neutralTags: ['Gaps'],
  },
  {
    id: 'stage-3',
    time: '9:25 PM',
    title: 'Know your next steps',
    description:
      'get prioritized recommendations for career exploration, skill improvement and interview preparation.',
    purpleTags: ['Prioritized recommendations'],
    neutralTags: [],
  },
  {
    id: 'stage-4',
    time: 'Next week',
    title: 'Keep moving forward',
    description:
      'practice interviews, follow a development plan and update your insights as you improve.',
    purpleTags: ['Interview practice', 'Development plan', 'Updated insights'],
    neutralTags: ['Apply to jobs', 'Interviews'],
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
      navigate('/organizations/signup')
    }
  }

  const activeStage = CAREER_STAGES.find((s) => s.id === activeStageId) || CAREER_STAGES[0]

  function handleFastStartSubmit(e: FormEvent) {
    e.preventDefault()
    if (roleSelection === 'vendor') {
      navigate('/organizations/signup')
    } else {
      navigate('/signup', {
        state: { firstName: firstName.trim() || undefined, reason: 'fast_start_discovery' },
      })
    }
  }

  function handleVendorClick() {
    navigate('/organizations/signup')
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
                One 15-minute conversation. Your 360° career view.
              </p>

              <p className={styles.leadText}>
                Whether you&apos;re a student exploring your future, searching for your first job,
                preparing for your next opportunity, or planning a career change, HireRighttt helps
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
            <div className={styles.heroVisual}>
              <HomeHeroPreview />
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
                9:02 PM · The questions that keep you up
              </div>

              <h2 className={styles.editorialH2}>
                Great potential
                <br />
                deserves
                <br />
                clear direction.
              </h2>

              <div className={styles.questionsList}>
                <div className={styles.questionItem}>Not sure which career is right for you?</div>
                <div className={styles.questionItem}>Applying for jobs but struggling to stand out?</div>
                <div className={styles.questionItem}>
                  Preparing for interviews without knowing what to focus on?
                </div>
              </div>

              <p className={styles.bodyText}>
                Every career journey brings different questions. HireRighttt starts by listening, then
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
                We don&apos;t start with a form. We start with you.
              </p>
            </div>

            <figure className={styles.questionsPhoto}>
              <img
                src="/assets/night-desk-focus.jpg"
                alt="A young man working on a laptop at a desk late in the evening"
                width={1024}
                height={571}
                loading="lazy"
                decoding="async"
              />
            </figure>
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
              9:05 PM · The conversation begins
            </div>

            <h2 className={styles.editorialH2}>Career clarity starts with a conversation.</h2>

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
                Start my 15-minute discovery
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
              9:20 PM · What the conversation shows
            </div>

            <h2 className={styles.editorialH2}>
              More than a score. A<br />
              clearer view of your career.
            </h2>

            <p className={styles.bodyText}>
              Your personalized career intelligence report brings together what your first
              conversation reveals, and turns it into practical guidance you can act on.
            </p>
          </div>

          <div className={styles.reportCardsGrid}>
            <div className={styles.reportCard}>
              <h3 className={styles.reportCardTitle}>Strengths &amp; potential</h3>
              <p className={styles.reportCardDesc}>
                Recognize the strengths you demonstrate and the abilities you can build on.
              </p>
            </div>

            <div className={styles.reportCard}>
              <h3 className={styles.reportCardTitle}>Career direction</h3>
              <p className={styles.reportCardDesc}>
                Explore job roles and career paths aligned with your interests and aspirations.
              </p>
            </div>

            <div className={styles.reportCard}>
              <h3 className={styles.reportCardTitle}>Skill gap discovery</h3>
              <p className={styles.reportCardDesc}>
                Identify potential skills and knowledge gaps relevant to the direction you want to
                take.
              </p>
            </div>

            <div className={styles.reportCard}>
              <h3 className={styles.reportCardTitle}>Communication insights</h3>
              <p className={styles.reportCardDesc}>
                Understand how you express your ideas, experiences and goals.
              </p>
            </div>

            <div className={styles.reportCard}>
              <h3 className={styles.reportCardTitle}>Job &amp; interview readiness</h3>
              <p className={styles.reportCardDesc}>
                See where to focus your preparation before pursuing opportunities.
              </p>
            </div>

            <div className={styles.reportCard}>
              <h3 className={styles.reportCardTitle}>Personalized action roadmap</h3>
              <p className={styles.reportCardDesc}>
                Get a practical plan with recommended priorities for the next 30, 60 and 90 days.
              </p>
            </div>
          </div>

          <div className={styles.narrowContainer} style={{ padding: 0 }}>
            <div className={styles.disclaimerNotice}>
              Initial insights are based on a short conversation and are not a certification of
              ability. Deeper assessments and practice help validate findings.
            </div>

            <div className={styles.reportCtaRow}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setShowSampleModal(true)}
              >
                View sample 360° report
              </button>
              <span className={styles.metaReassurance}>
                The sample is an example, not a real assessment
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
            The weeks after · You&apos;re not on your own
          </div>

          <h2 className={styles.editorialH2}>
            We don&apos;t just show you what to
            <br />
            improve. We help you get there.
          </h2>

          <div className={styles.milestonesGrid}>
            <div className={styles.milestoneCard}>
              <span className={styles.milestoneDay}>Day 3</span>
              <h3 className={styles.milestoneTitle}>AI interview practice</h3>
              <p className={styles.milestoneDesc}>
                Prepare for technical, behavioral and HR interviews with guided, role-specific
                practice.
              </p>
              <div>
                <span className={styles.tagPill}>Technical</span>
                <span className={styles.tagPill}>Behavioral</span>
                <span className={styles.tagPill}>HR</span>
              </div>
            </div>

            <div className={styles.milestoneCard}>
              <span className={styles.milestoneDay}>Day 12</span>
              <h3 className={styles.milestoneTitle}>Personalized skill development</h3>
              <p className={styles.milestoneDesc}>
                Know what to learn next and why it matters for your target role.
              </p>
              <div>
                <span className={styles.tagPill}>Target role</span>
              </div>
            </div>

            <div className={styles.milestoneCard}>
              <span className={styles.milestoneDay}>Day 30</span>
              <h3 className={styles.milestoneTitle}>Career &amp; job readiness</h3>
              <p className={styles.milestoneDesc}>
                Understand the capabilities employers may expect and prepare for relevant
                opportunities.
              </p>
              <div>
                <span className={styles.tagPill}>Readiness</span>
              </div>
            </div>

            <div className={styles.milestoneCard}>
              <span className={styles.milestoneDay}>Day 60</span>
              <h3 className={styles.milestoneTitle}>Progress &amp; growth</h3>
              <p className={styles.milestoneDesc}>
                Track completed actions and improve your career readiness over time.
              </p>
              <div>
                <span className={styles.tagPill}>Progress tracking</span>
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
              Day 45 · When you feel ready
            </div>

            <h2 className={styles.editorialH2}>
              When you&apos;re
              <br />
              ready, the next
              <br />
              step is a real one.
            </h2>

            <p className={styles.bodyText} style={{ maxWidth: '680px' }}>
              Vendors post the roles they are hiring for. You browse them, apply, and take the
              interview, with your preparation already behind you.
            </p>

            <div className={styles.threeColumnSteps}>
              <div className={styles.threeStepCard}>
                <span className={styles.threeStepCategory}>Browse</span>
                <h3 className={styles.threeStepTitle}>See open roles</h3>
                <p className={styles.threeStepDesc}>Read the requirements posted by vendors.</p>
              </div>

              <div className={styles.threeStepCard}>
                <span className={styles.threeStepCategory}>Apply</span>
                <h3 className={styles.threeStepTitle}>Apply with confidence</h3>
                <p className={styles.threeStepDesc}>
                  Apply to roles that fit, and choose what you share.
                </p>
              </div>

              <div className={styles.threeStepCard}>
                <span className={styles.threeStepCategory}>Interview</span>
                <h3 className={styles.threeStepTitle}>Give the interview</h3>
                <p className={styles.threeStepDesc}>
                  Take the interview for a role you applied to.
                </p>
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <span className={styles.tagPill}>Job postings</span>
              <span className={styles.tagPill}>Apply</span>
              <span className={styles.tagPill}>Interview</span>
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
                Monday, 10:00 AM · For vendors, the other side of the table
              </div>

              <h2 className={styles.vendorHeading}>
                See the <span className={styles.italicPurple}>person</span>
                <br />
                behind the
                <br />
                application.
              </h2>

              <p className={styles.leadText} style={{ maxWidth: '520px' }}>
                Vendors post the jobs they have open and what each role needs, read the career
                reports of candidates who apply, and interview the people who fit.
              </p>

              <div className={styles.vendorChecklist}>
                <span className={styles.vendorCheckPill}>
                  <span className={styles.vendorCheckPillCheck}>✓</span> Post job requirements
                </span>
                <span className={styles.vendorCheckPill}>
                  <span className={styles.vendorCheckPillCheck}>✓</span> Review candidate reports
                </span>
                <span className={styles.vendorCheckPill}>
                  <span className={styles.vendorCheckPillCheck}>✓</span> Interview applicants
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
                  Reports are initial insights from a short conversation. They support your judgment
                  and do not replace it. Candidates decide what they share.
                </span>
              </div>
            </div>

            {/* Right Column: Layered Mockup Card */}
            <div className={styles.vendorCardStackWrap}>
              <div className={styles.vendorBackdropLayer} aria-hidden="true" />

              <div className={styles.vendorPreviewMockup}>
                <div className={styles.vendorMockupHeader}>
                  <span className={styles.vendorMockupTitleSmall}>EXAMPLE VENDOR VIEW</span>
                  <span className={styles.mockupDisclaimerPill}>Made-up candidates, not real data</span>
                </div>

                <div className={styles.roleTitleRow}>
                  <h4 className={styles.vendorMockupRole}>Junior business analyst</h4>
                  <span className={styles.openRolePill}>
                    <span className={styles.openRoleDot} />
                    Open role
                  </span>
                </div>

                <div className={styles.roleSkillsRow}>
                  <span className={styles.skillRequirementPill}>Clear communication</span>
                  <span className={styles.skillRequirementPill}>Spreadsheets</span>
                  <span className={styles.skillRequirementPill}>Basic SQL</span>
                </div>

                {/* Candidate A Card */}
                <div className={styles.candidateMockupCard}>
                  <div className={styles.candidateAvatarA}>A</div>
                  <div className={styles.candidateContent}>
                    <div className={styles.candidateMockupName}>Candidate A</div>
                    <p className={styles.candidateMockupBio}>
                      Shared career view: explains ideas clearly, curious about data. Focus area:
                      SQL practice.
                    </p>
                    <div>
                      <span className={styles.pillStrengths}>Strengths</span>
                      <span className={styles.pillSkillGaps}>Skill gaps</span>
                      <span className={styles.pillReadiness}>Interview readiness</span>
                    </div>
                  </div>
                </div>

                {/* Candidate B Card */}
                <div className={styles.candidateMockupCard}>
                  <div className={styles.candidateAvatarB}>B</div>
                  <div className={styles.candidateContent}>
                    <div className={styles.candidateMockupName}>Candidate B</div>
                    <p className={styles.candidateMockupBio}>
                      Shared career view: strong in operations, moving from support. Focus area:
                      structured interview answers.
                    </p>
                    <div>
                      <span className={styles.pillSwitcher}>Career switcher</span>
                      <span className={styles.pillReadiness}>Readiness focus</span>
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
            Any morning · Whoever you are
          </div>

          <h2 className={styles.editorialH2}>
            Whatever your career
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
            Before you decide · What makes this different
          </div>

          <h2 className={styles.editorialH2}>
            Not just another job portal. A career
            <br />
            companion that starts with you.
          </h2>

          <div className={styles.comparisonThreeCol}>
            <div className={styles.comparisonColCard}>
              <h3 className={styles.comparisonColTitle}>Job portals</h3>
              <p className={styles.comparisonColBody}>Show openings.</p>
            </div>

            <div className={styles.comparisonColCard}>
              <h3 className={styles.comparisonColTitle}>Courses</h3>
              <p className={styles.comparisonColBody}>Teach individual skills.</p>
            </div>

            <div className={styles.comparisonColCard}>
              <h3 className={styles.comparisonColTitle}>Interview tools</h3>
              <p className={styles.comparisonColBody}>Focus on practice.</p>
            </div>
          </div>

          <div className={styles.narrowContainer} style={{ padding: 0 }}>
            <p className={styles.leadText}>
              HireRighttt starts by understanding your career situation and connects discovery,
              guidance and improvement in one experience.
            </p>
            <div className={styles.punchlineQuote}>
              From &ldquo;What should I do?&rdquo; to &ldquo;Here&apos;s my next step.&rdquo;
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
              Before you begin · What to expect
            </div>

            <h2 className={styles.editorialH2}>You decide how much to share.</h2>

            <div className={styles.principlesStack}>
              <div className={styles.principleRow}>
                <span className={styles.principleTitle}>Nothing mandatory first.</span>
                <p className={styles.principleDesc}>
                  No long profile or resume upload before you start. You can add more later if you
                  choose.
                </p>
              </div>

              <div className={styles.principleRow}>
                <span className={styles.principleTitle}>Your voice only with your permission.</span>
                <p className={styles.principleDesc}>
                  If voice is available, we ask first. A text option is offered where supported.
                </p>
              </div>

              <div className={styles.principleRow}>
                <span className={styles.principleTitle}>A clear notice before personal details.</span>
                <p className={styles.principleDesc}>
                  You&apos;ll see the privacy notice before any personal information is collected.
                </p>
              </div>

              <div className={styles.principleRow}>
                <span className={styles.principleTitle}>You choose what vendors see.</span>
                <p className={styles.principleDesc}>
                  Vendors read your report only when you apply or choose to share it.
                </p>
              </div>

              <div className={styles.principleRow}>
                <span className={styles.principleTitle}>A first look, not a verdict.</span>
                <p className={styles.principleDesc}>
                  Insights are initial, not a certification of ability, and we never promise a job.
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
                10:30 PM · You breathe out
              </div>

              <h2 className={styles.closingH2}>
                Your next
                <br />
                opportunity
                <br />
                starts with one
                <br />
                conversation.
              </h2>

              <p className={styles.closingLead}>
                Give yourself 15 minutes to understand your strengths, discover what to work on,
                and build a clearer path toward the career you want.
              </p>

              <div className={styles.roleToggleWrap}>
                <span className={styles.roleToggleLabel}>I&apos;m joining as</span>
                <button
                  type="button"
                  className={`${styles.roleToggleBtn} ${
                    roleSelection === 'candidate' ? styles.roleToggleBtnActive : ''
                  }`}
                  onClick={() => setRoleSelection('candidate')}
                >
                  A candidate
                </button>
                <button
                  type="button"
                  className={`${styles.roleToggleBtn} ${
                    roleSelection === 'vendor' ? styles.roleToggleBtnActive : ''
                  }`}
                  onClick={() => setRoleSelection('vendor')}
                >
                  A vendor
                </button>
              </div>

              {/* Fast start form */}
              <form className={styles.fastStartCard} onSubmit={handleFastStartSubmit}>
                <span className={styles.stepIndicator}>Step 1 of 1 · What should we call you?</span>
                <input
                  type="text"
                  className={styles.fastStartInput}
                  placeholder="Your first name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
                <button type="submit" className={styles.primaryBtn} style={{ width: '100%' }}>
                  Start my career discovery
                </button>
                <span
                  style={{
                    fontSize: '0.785rem',
                    color: 'var(--color-dark-muted)',
                    textAlign: 'center',
                  }}
                >
                  No resume required to get started • personalized AI-powered guidance
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
                Your personal AI career companion
              </span>
            </div>

            <div className={styles.footerLinks}>
              <Link to="/why" className={styles.footerLink}>
                Why us?
              </Link>
              <Link to="/pricing" className={styles.footerLink}>
                Pricing
              </Link>
              <Link to="/career-view" className={styles.footerLink}>
                360° Report
              </Link>
              <Link to="/solutions" className={styles.footerLink}>
                For organizations
              </Link>
              <Link to="/contact" className={styles.footerLink}>
                Contact us
              </Link>
              <Link to="/privacy" className={styles.footerLink}>
                Privacy
              </Link>
              <Link to="/terms" className={styles.footerLink}>
                Terms
              </Link>
            </div>
          </div>

          <p className={styles.footerCopyright}>
            © {new Date().getFullYear()} HireRighttt. All rights reserved.
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
                  • <strong>Next 30 Days:</strong> Complete SQL basics and take guided technical interview practice.
                  <br />
                  • <strong>Next 60 Days:</strong> Build two business case studies and refine behavioral story structures.
                  <br />
                  • <strong>Next 90 Days:</strong> Apply to verified partner roles with unlocked candidate report.
                </div>
              </div>

              <div style={{ textAlign: 'center' }}>
                <Link
                  to="/signup"
                  className={styles.primaryBtn}
                  onClick={() => setShowSampleModal(false)}
                >
                  Start my career discovery
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
