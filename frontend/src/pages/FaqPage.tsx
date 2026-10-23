import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import styles from './FaqPage.module.css'

interface FaqItem {
  question: string
  answer: string
}

const FAQS: FaqItem[] = [
  {
    question: 'Do I need a resume to begin?',
    answer: 'No. Start with a short conversation. You may choose to add more information later.',
  },
  {
    question: 'Who is HireRighttt for?',
    answer:
      'HireRighttt is built for anyone navigating their career — students, fresh graduates, job seekers, working professionals looking to advance, and career switchers.',
  },
  {
    question: 'What happens in the 15-minute conversation?',
    answer:
      'You will have an interactive conversation with Ava, our AI career companion, exploring your background, strengths, interests, and aspirations to build a comprehensive picture of your potential.',
  },
  {
    question: 'What do I receive afterward?',
    answer:
      'You receive a detailed 360° Career Intelligence Report featuring clear competency scores, personalized recommendations, identified strengths, and actionable next steps.',
  },
  {
    question: 'Can it help me get a job?',
    answer:
      'Yes. Beyond career clarity, your verified 360° report and score can be shared directly with hiring employers and matched opportunities on our platform.',
  },
  {
    question: 'Is the 15-minute assessment final?',
    answer:
      'No. You can retake the discovery conversation or practice specific modules as you build new skills, gain experience, or refine your goals.',
  },
]

export function FaqPage() {
  // Default first item (index 0) open, matching the screenshot
  const [openIndices, setOpenIndices] = useState<number[]>([0])

  function toggleIndex(index: number) {
    if (openIndices.includes(index)) {
      setOpenIndices(openIndices.filter((i) => i !== index))
    } else {
      setOpenIndices([...openIndices, index])
    }
  }

  return (
    <div className={styles.page}>
      <MarketingNavBar />

      {/* ====================================================================
          Page Header
          ==================================================================== */}
      <section className={styles.pageHeader}>
        <div className={styles.shell}>
          <motion.p
            className={styles.overline}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >FAQs</motion.p>

          <motion.h1
            className={styles.heading}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            Frequently Asked{' '}
            <span className={styles.gradientText}>Questions</span>
          </motion.h1>
        </div>
      </section>

      {/* ====================================================================
          Accordion Section
          ==================================================================== */}
      <section className={styles.accordionSection}>
        <div className={styles.shell}>
          <div className={styles.accordionList}>
            {FAQS.map((faq, index) => {
              const isOpen = openIndices.includes(index)
              return (
                <motion.div
                  key={faq.question}
                  className={`${styles.accordionItem} ${isOpen ? styles.accordionItemOpen : ''}`}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.05 * index }}
                >
                  <button
                    type="button"
                    className={styles.accordionHeader}
                    onClick={() => toggleIndex(index)}
                    aria-expanded={isOpen}
                  >
                    <h2 className={styles.questionText}>{faq.question}</h2>
                    <span className={styles.iconWrap} aria-hidden>
                      {isOpen ? '−' : '+'}
                    </span>
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        className={styles.accordionBody}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: 'easeInOut' }}
                      >
                        <p className={styles.answerText}>{faq.answer}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>

          <motion.div
            className={styles.bottomCtaArea}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
          >
            <p className={styles.ctaPrompt}>Ready to find your next step?</p>
            <Link to="/signup" className={styles.ctaBtn}>
              START MY CAREER DISCOVERY
            </Link>
          </motion.div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
