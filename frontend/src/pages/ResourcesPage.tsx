import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { HrIcon } from '../components/HrIcon'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import { fadeUp, staggerContainer } from '../motion/variants'
import styles from './ResourcesPage.module.css'

type Category = 'all' | 'star' | 'rubric' | 'hardware' | 'guides' | 'faq'

const SAMPLE_STAR_PROMPTS = [
  {
    tag: 'Behavioral · Leadership',
    question: 'Describe a challenging technical disagreement you had with a team member and how you resolved it.',
    sample:
      'Situation: During our Q3 migration, my tech lead favored a monolithic Redis cache, while I advocated for partitioned DynamoDB clusters to avoid a single point of failure.\nTask: I needed to resolve the deadlock within 48 hours without delaying our launch.\nAction: I created a quick benchmark script simulating 50K concurrent writes and shared the p99 latency numbers openly. We then held a 30-minute sync comparing costs and failover risks.\nResult: The team unanimously chose DynamoDB, cutting our failover recovery time from 4 minutes to under 200ms with zero production downtime.',
  },
  {
    tag: 'Technical Depth · System Design',
    question: 'How do you handle sudden 10x traffic spikes in a distributed microservices environment?',
    sample:
      'Situation: Our e-commerce checkout service experienced an unpredicted flash-sale spike, jumping from 2,000 to 22,000 requests per second.\nTask: My goal was to protect the database layer and ensure zero lost payment transactions.\nAction: I implemented an asynchronous queuing buffer with RabbitMQ, leveraged Redis for read-through inventory cache, and enabled aggressive autoscaling policies based on CPU and ingress queue depth.\nResult: The system absorbed the traffic spike with a 99.98% success rate, and average latency remained under 120ms throughout the flash event.',
  },
  {
    tag: 'Problem Solving · Incident Response',
    question: 'Walk us through a critical production bug you discovered and how you fixed it under pressure.',
    sample:
      'Situation: At 2 PM on release day, users reported intermittent session logouts following a token refresh refactor.\nTask: I had to identify the root cause within 15 minutes before the issue affected enterprise customers.\nAction: I inspected our telemetry logs in Datadog, isolated a race condition in the JWT refresh interceptor, rolled back the single worker container, and wrote a thread-safe mutex lock with unit tests.\nResult: Service was restored in 11 minutes. I subsequently authored a post-mortem and added regression tests to our CI/CD pipeline.',
  },
]

const GUIDES = [
  {
    id: 'guide-1',
    tag: 'Candidate Prep',
    title: 'The Complete AI Video Interview Playbook (2025 Edition)',
    readTime: '6 min read',
    image: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=600&h=360&fit=crop',
    excerpt: 'How Ava analyzes your tone, content density, and system architecture explanations. Step-by-step preparation timeline.',
    content: `
### Key Principles for Scoring High with Ava
1. **Be Structured**: Use the STAR method (Situation, Task, Action, Result) for all scenario-based questions.
2. **Quantify Results**: Replace phrases like "it was faster" with "it reduced p95 latency by 38%".
3. **Pacing and Eye-Contact**: Speak steadily at 120–140 words per minute while maintaining direct gaze with the camera. Ava’s gaze tracker recognizes focused forward attention.
4. **Target 60–150 Spoken Words**: Concise, data-driven answers score higher than rambling explanations.
    `,
  },
  {
    id: 'guide-2',
    tag: 'Anti-Cheat & Ethics',
    title: 'Transparent Anti-Cheat: How Our AI Proctor Protects Candidates',
    readTime: '5 min read',
    image: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=600&h=360&fit=crop',
    excerpt: 'Understand face detection, multi-person tracking, and local recording privacy. Why fair testing benefits genuine talent.',
    content: `
### What the Proctor Evaluates
- **Single Person Verification**: Ava verifies that only the candidate is present in the camera frame.
- **Forward Focus**: Minor natural head movements are completely fine; sustained multi-second side-looks to off-screen notes trigger caution markers.
- **Privacy Assurance**: Your video recording is stored locally and securely, viewable only by verified recruiters hiring for that specific position.
    `,
  },
  {
    id: 'guide-3',
    tag: 'Engineering',
    title: 'System Design for Live Screens: Trade-Offs and Architecture',
    readTime: '8 min read',
    image: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=600&h=360&fit=crop',
    excerpt: 'Frameworks to discuss caching, CAP theorem, database sharding, and fault tolerance clearly in under 3 minutes.',
    content: `
### System Design Framework
1. **Requirements Clarification**: State functional and non-functional requirements (throughput, availability vs consistency).
2. **High-Level Components**: Ingress, API gateway, cache tier, compute layer, persistence.
3. **Deep Dive**: Identify the primary bottleneck (e.g. write volume or read fan-out) and discuss exact mitigation strategies.
    `,
  },
]

const FAQS = [
  {
    q: 'Can I retake my AI interview if I am unsatisfied with my score?',
    a: 'Yes! HireRight encourages continuous improvement. You can retake the AI video interview at any time. Your profile matches and employer submissions will automatically update to reflect your highest certified score.',
  },
  {
    q: 'What equipment do I need to take the interview?',
    a: 'You only need a modern web browser (Google Chrome, Microsoft Edge, or Safari), a working webcam, and a microphone. For best results, use headphones with a built-in microphone and sit in a well-lit, quiet room.',
  },
  {
    q: 'What happens if my camera or internet connection drops mid-interview?',
    a: 'Your answers and progress are saved after every question. If your connection drops, simply reopen the interview studio to resume where you left off. You also have the option to type answers as a fallback if microphone support is unavailable.',
  },
  {
    q: 'How does Ava evaluate non-native English speakers?',
    a: 'Ava’s scoring engine focuses on technical depth, problem-solving reasoning, and structural clarity (STAR methodology), rather than native accent or colloquialisms. The scoring models are calibrated to avoid demographic and regional bias.',
  },
  {
    q: 'Do employers see my entire video or just the scores?',
    a: 'Employers receive a comprehensive talent dashboard that includes your overall score, category breakdown (Technical Depth, Communication, Problem Solving, System Design), strengths & areas for growth, and an interactive video playback timeline with proctor integrity markers.',
  },
]

export function ResourcesPage() {
  const [category, setCategory] = useState<Category>('all')
  const [activePromptIdx, setActivePromptIdx] = useState(0)
  const [userAnswer, setUserAnswer] = useState(SAMPLE_STAR_PROMPTS[0].sample)
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)
  const [selectedGuide, setSelectedGuide] = useState<(typeof GUIDES)[0] | null>(null)

  const activePrompt = SAMPLE_STAR_PROMPTS[activePromptIdx]
  const wordCount = userAnswer.trim() ? userAnswer.trim().split(/\s+/).length : 0

  function loadSamplePrompt(index: number) {
    setActivePromptIdx(index)
    setUserAnswer(SAMPLE_STAR_PROMPTS[index].sample)
  }

  function getWordCountStatus(count: number) {
    if (count < 60) return { label: `${count} words (Too brief — aim for 60+)`, cls: styles.wordCountLow }
    if (count <= 160) return { label: `${count} words (Perfect length: 60–150 words)`, cls: styles.wordCountOk }
    return { label: `${count} words (A bit lengthy — consider condensing)`, cls: styles.wordCountHigh }
  }

  const wordStatus = getWordCountStatus(wordCount)

  return (
    <div className={styles.page}>
      <SiteNav />

      <main className={styles.shell}>
        {/* HERO SECTION */}
        <motion.div
          className={styles.hero}
          initial="hidden"
          animate="show"
          variants={staggerContainer}
        >
          <motion.div className={styles.badge} variants={fadeUp}>
            <span className={styles.badgeDot} aria-hidden />
            AI Interview Master Resource Hub
          </motion.div>
          <motion.h1 className={styles.title} variants={fadeUp}>
            Ace Your Interview.{' '}
            <span className={styles.titleRose}>Prove Your </span>
            <span className={styles.titleGradient}>Mastery.</span>
          </motion.h1>
          <motion.p className={styles.subtitle} variants={fadeUp}>
            Everything you need to master your AI video screening with Ava — interactive STAR response tools, camera setup checklists, scoring rubrics, and engineering guides.
          </motion.p>

          {/* CATEGORY FILTER */}
          <motion.div className={styles.filterBar} variants={fadeUp}>
            {[
              { id: 'all', label: 'All Resources' },
              { id: 'star', label: 'STAR Method Builder' },
              { id: 'rubric', label: 'Scoring Rubrics' },
              { id: 'hardware', label: 'Setup Checklist' },
              { id: 'guides', label: 'Prep Guides' },
              { id: 'faq', label: 'FAQ' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`${styles.filterBtn} ${category === tab.id ? styles.filterBtnActive : ''}`}
                onClick={() => setCategory(tab.id as Category)}
              >
                {tab.label}
              </button>
            ))}
          </motion.div>
        </motion.div>

        {/* SECTION 1: INTERACTIVE STAR METHOD BUILDER */}
        {(category === 'all' || category === 'star') && (
          <motion.section
            className={styles.section}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.1 }}
            variants={staggerContainer}
          >
            <div className={styles.sectionHeader}>
              <div className={styles.sectionKicker}>INTERACTIVE WORKSHOP</div>
              <h2 className={styles.sectionTitle}>The STAR Response Framework</h2>
              <p className={styles.sectionDesc}>
                Ava scores responses structured in Situation, Task, Action, and Result significantly higher than unstructured answers. Test and fine-tune your responses below.
              </p>
            </div>

            <div className={styles.starCard}>
              <div className={styles.starPillars}>
                <div className={styles.starPillarItem}>
                  <div className={styles.starLetter}>S</div>
                  <h4>Situation</h4>
                  <p>Set the context in 1–2 sentences. What was the project, timeline, and stakes?</p>
                </div>
                <div className={styles.starPillarItem}>
                  <div className={styles.starLetter}>T</div>
                  <h4>Task</h4>
                  <p>State your specific responsibility or the central obstacle to solve.</p>
                </div>
                <div className={styles.starPillarItem}>
                  <div className={styles.starLetter}>A</div>
                  <h4>Action</h4>
                  <p>Detail your exact decisions, tools, code, or architecture tradeoffs.</p>
                </div>
                <div className={styles.starPillarItem}>
                  <div className={styles.starLetter}>R</div>
                  <h4>Result</h4>
                  <p>Conclude with measurable business or engineering impact (%, ms, revenue).</p>
                </div>
              </div>

              {/* SIMULATOR */}
              <div className={styles.starSimulator}>
                <div className={styles.simHeader}>
                  <div>
                    <span className={styles.simTag}>{activePrompt.tag}</span>
                    <h3 className={styles.simPrompt} style={{ marginTop: 8 }}>
                      &ldquo;{activePrompt.question}&rdquo;
                    </h3>
                  </div>
                  <div className={styles.simActions}>
                    {SAMPLE_STAR_PROMPTS.map((p, idx) => (
                      <button
                        key={p.tag}
                        type="button"
                        className={`${styles.actionBtn} ${
                          idx === activePromptIdx ? styles.actionBtnActive : ''
                        }`}
                        onClick={() => loadSamplePrompt(idx)}
                      >
                        Sample #{idx + 1}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  className={styles.simTextarea}
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  placeholder="Draft your spoken answer here using the STAR structure..."
                  rows={6}
                />

                <div className={styles.simStats}>
                  <div className={`${styles.wordCount} ${wordStatus.cls}`}>
                    {wordStatus.label}
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={() => setUserAnswer('')}
                    >
                      Clear
                    </button>
                    <Link to="/interview" className={styles.primaryAction}>
                      Practice Out Loud →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {/* SECTION 2: SCORING RUBRIC EXPLORER */}
        {(category === 'all' || category === 'rubric') && (
          <motion.section
            className={styles.section}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.1 }}
            variants={staggerContainer}
          >
            <div className={styles.sectionHeader}>
              <div className={styles.sectionKicker}>TRANSPARENT EVALUATION</div>
              <h2 className={styles.sectionTitle}>What Ava Looks For</h2>
              <p className={styles.sectionDesc}>
                No black-box scoring. Ava scores Correctness (AI-checked), Depth, and Communication — with higher communication weight on project questions and higher correctness+depth on technical questions.
              </p>
            </div>

            <div className={styles.rubricGrid}>
              <div className={styles.rubricCard}>
                <div className={styles.rubricTop}>
                  <span className={styles.rubricIcon} aria-hidden>
                    <HrIcon name="cpu" size={28} />
                  </span>
                  <span className={styles.rubricWeight}>AI + HEURISTIC</span>
                </div>
                <h3>Answer Correctness</h3>
                <p>Whether your answer is accurate for the question and consistent with your résumé — technical soundness for skill questions.</p>
                <ul className={styles.rubricList}>
                  <li>Up to ~45% weight on technical / skill questions</li>
                  <li>Penalizes invented employers or facts</li>
                  <li>Scored primarily by Gemini when configured</li>
                </ul>
              </div>

              <div className={styles.rubricCard}>
                <div className={styles.rubricTop}>
                  <span className={styles.rubricIcon} aria-hidden>
                    <HrIcon name="puzzle" size={28} />
                  </span>
                  <span className={styles.rubricWeight}>VARIES BY QUESTION</span>
                </div>
                <h3>Depth</h3>
                <p>Specificity: tools, trade-offs, metrics, ownership, and completeness of your examples.</p>
                <ul className={styles.rubricList}>
                  <li>Paired with correctness on technical turns (~80% combined)</li>
                  <li>Concrete outcomes and numbers boost depth</li>
                  <li>Generic buzzwords score lower</li>
                </ul>
              </div>

              <div className={styles.rubricCard}>
                <div className={styles.rubricTop}>
                  <span className={styles.rubricIcon} aria-hidden>
                    <HrIcon name="message" size={28} />
                  </span>
                  <span className={styles.rubricWeight}>UP TO 50% ON PROJECTS</span>
                </div>
                <h3>Communication</h3>
                <p>Clarity and structure for spoken answers — STAR-style narratives without penalizing accent or minor grammar.</p>
                <ul className={styles.rubricList}>
                  <li>Higher weight on project & certification questions</li>
                  <li>~20% weight on pure technical skill questions</li>
                  <li>Ideal length roughly 60–150 words per answer</li>
                </ul>
              </div>
            </div>
          </motion.section>
        )}

        {/* SECTION 3: SETUP CHECKLIST */}
        {(category === 'all' || category === 'hardware') && (
          <motion.section
            className={styles.section}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.1 }}
            variants={staggerContainer}
          >
            <div className={styles.sectionHeader}>
              <div className={styles.sectionKicker}>ENVIRONMENT PREP</div>
              <h2 className={styles.sectionTitle}>Studio Setup Checklist</h2>
              <p className={styles.sectionDesc}>
                Take 3 minutes to optimize your space before launching the interview studio.
              </p>
            </div>

            <div className={styles.checklistGrid}>
              <div className={styles.checkCard}>
                <div className={styles.checkCardHeader}>
                  <div className={styles.checkIconBox}>
                    <HrIcon name="sun" size={22} />
                  </div>
                  <h3>Lighting & Framing</h3>
                </div>
                <ul className={styles.checkList}>
                  <li className={styles.checkItem}>
                    <span>✓</span>
                    <span><strong>Front lighting:</strong> Have light facing you, never directly behind you.</span>
                  </li>
                  <li className={styles.checkItem}>
                    <span>✓</span>
                    <span><strong>Eye-level camera:</strong> Elevate laptop so camera is at natural eye height.</span>
                  </li>
                  <li className={styles.checkItem}>
                    <span>✓</span>
                    <span><strong>Center framing:</strong> Keep head and shoulders clearly centered in the box.</span>
                  </li>
                </ul>
              </div>

              <div className={styles.checkCard}>
                <div className={styles.checkCardHeader}>
                  <div className={styles.checkIconBox}>
                    <HrIcon name="mic" size={22} />
                  </div>
                  <h3>Audio & Acoustics</h3>
                </div>
                <ul className={styles.checkList}>
                  <li className={styles.checkItem}>
                    <span>✓</span>
                    <span><strong>Headset recommended:</strong> Prevents speaker echo during speech recognition.</span>
                  </li>
                  <li className={styles.checkItem}>
                    <span>✓</span>
                    <span><strong>Quiet room:</strong> Close windows and silence phone notifications.</span>
                  </li>
                  <li className={styles.checkItem}>
                    <span>✓</span>
                    <span><strong>Consistent volume:</strong> Speak clearly at normal conversational volume.</span>
                  </li>
                </ul>
              </div>

              <div className={styles.checkCard}>
                <div className={styles.checkCardHeader}>
                  <div className={styles.checkIconBox}>
                    <HrIcon name="shield-check" size={22} />
                  </div>
                  <h3>Proctor Integrity</h3>
                </div>
                <ul className={styles.checkList}>
                  <li className={styles.checkItem}>
                    <span>✓</span>
                    <span><strong>Single person only:</strong> No other individuals may enter camera frame.</span>
                  </li>
                  <li className={styles.checkItem}>
                    <span>✓</span>
                    <span><strong>Direct gaze:</strong> Keep attention focused on Ava and the screen.</span>
                  </li>
                  <li className={styles.checkItem}>
                    <span>✓</span>
                    <span><strong>Browser permissions:</strong> Allow camera and mic permissions when prompted.</span>
                  </li>
                </ul>
              </div>
            </div>
          </motion.section>
        )}

        {/* SECTION 4: PREP GUIDES */}
        {(category === 'all' || category === 'guides') && (
          <motion.section
            className={styles.section}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.1 }}
            variants={staggerContainer}
          >
            <div className={styles.sectionHeader}>
              <div className={styles.sectionKicker}>DEEP DIVES</div>
              <h2 className={styles.sectionTitle}>Curated Interview Playbooks</h2>
              <p className={styles.sectionDesc}>
                In-depth articles written by recruiters and engineering leaders to help you excel.
              </p>
            </div>

            <div className={styles.articlesGrid}>
              {GUIDES.map((guide) => (
                <article key={guide.id} className={styles.articleCard}>
                  <img src={guide.image} alt={guide.title} className={styles.articleImage} />
                  <div className={styles.articleBody}>
                    <div className={styles.articleMeta}>
                      <span className={styles.articleTag}>{guide.tag}</span>
                      <span className={styles.articleTime}>{guide.readTime}</span>
                    </div>
                    <h3>{guide.title}</h3>
                    <p>{guide.excerpt}</p>
                    <button
                      type="button"
                      className={styles.readMoreBtn}
                      onClick={() => setSelectedGuide(guide)}
                    >
                      Read Playbook <span>→</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </motion.section>
        )}

        {/* SECTION 5: FAQ */}
        {(category === 'all' || category === 'faq') && (
          <motion.section
            className={styles.section}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.1 }}
            variants={staggerContainer}
          >
            <div className={styles.sectionHeader}>
              <div className={styles.sectionKicker}>FREQUENTLY ASKED QUESTIONS</div>
              <h2 className={styles.sectionTitle}>Everything You Need to Know</h2>
              <p className={styles.sectionDesc}>
                Answers to top questions regarding scoring, proctoring privacy, and job matching.
              </p>
            </div>

            <div className={styles.faqList}>
              {FAQS.map((faq, idx) => (
                <div key={faq.q} className={styles.faqItem}>
                  <button
                    type="button"
                    className={styles.faqQuestion}
                    onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                    aria-expanded={expandedFaq === idx}
                  >
                    <span>{faq.q}</span>
                    <span
                      className={styles.faqChevron}
                      style={{
                        transform: expandedFaq === idx ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    >
                      ▼
                    </span>
                  </button>
                  {expandedFaq === idx && (
                    <motion.div
                      className={styles.faqAnswer}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      {faq.a}
                    </motion.div>
                  )}
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {/* CTA BANNER */}
        <div className={styles.ctaBanner}>
          <h2>Ready to Prove Your Skills?</h2>
          <p>
            Join thousands of candidates who have skipped the resume screening bottleneck and unlocked top roles through their verified AI interview score.
          </p>
          <div className={styles.ctaBtns}>
            <Link to="/interview" className={styles.primaryCta}>
              Enter Interview Studio Now →
            </Link>
            <Link to="/signup" className={styles.secondaryCta}>
              Create Free Candidate Account
            </Link>
          </div>
        </div>
      </main>

      {/* ARTICLE MODAL */}
      <AnimatePresence>
        {selectedGuide && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.8)',
              backdropFilter: 'blur(8px)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
            }}
            onClick={() => setSelectedGuide(null)}
          >
            <motion.div
              style={{
                background: '#0f172a',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: 20,
                maxWidth: 680,
                width: '100%',
                maxHeight: '90vh',
                overflowY: 'auto',
                padding: 32,
                color: '#f8fafc',
                position: 'relative',
              }}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <button
                type="button"
                onClick={() => setSelectedGuide(null)}
                style={{
                  position: 'absolute',
                  top: 20,
                  right: 20,
                  background: 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '50%',
                  width: 36,
                  height: 36,
                  cursor: 'pointer',
                  fontSize: '1.2rem',
                }}
              >
                <HrIcon name="close" size={18} />
              </button>
              <span style={{ color: '#fda4af', fontSize: '0.85rem', fontWeight: 700 }}>
                {selectedGuide.tag} · {selectedGuide.readTime}
              </span>
              <h2 style={{ fontSize: '1.7rem', margin: '10px 0 16px', color: '#fff' }}>
                {selectedGuide.title}
              </h2>
              <div
                style={{
                  fontSize: '0.98rem',
                  lineHeight: 1.7,
                  color: '#cbd5e1',
                  whiteSpace: 'pre-line',
                }}
              >
                {selectedGuide.content}
              </div>
              <div style={{ marginTop: 28, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className={styles.primaryCta}
                  onClick={() => setSelectedGuide(null)}
                >
                  Close Guide
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <SiteFooter />
    </div>
  )
}
