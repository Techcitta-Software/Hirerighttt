import { useRef } from 'react'
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion'

export interface TimelineStage {
  id: string
  time: string
  title: string
  description: string
  purpleTags: string[]
  grayTags: string[]
}

const TIMELINE_STAGES: TimelineStage[] = [
  {
    id: 'stage-1',
    time: '9:05 pm',
    title: 'talk for 15 minutes',
    description:
      'have a natural ai-guided conversation about your interests, experiences, skills, aspirations and challenges.',
    purpleTags: ['ai-guided conversation'],
    grayTags: ['no resume needed'],
  },
  {
    id: 'stage-2',
    time: '9:20 pm',
    title: 'discover your 360° view',
    description:
      'receive initial insights into strengths, potential gaps, communication, career direction and job readiness.',
    purpleTags: ['initial insights', 'strengths'],
    grayTags: ['gaps'],
  },
  {
    id: 'stage-3',
    time: '9:25 pm',
    title: 'know your next steps',
    description:
      'get prioritized recommendations for career exploration, skill improvement and interview preparation.',
    purpleTags: ['prioritized recommendations'],
    grayTags: [],
  },
  {
    id: 'stage-4',
    time: 'next week',
    title: 'keep moving forward',
    description:
      'practice interviews, follow a development plan and update your insights as you improve.',
    purpleTags: ['interview practice', 'development plan', 'updated insights'],
    grayTags: ['apply to jobs', 'interviews'],
  },
]

interface TimelineCardProps {
  stage: TimelineStage
  index: number
  total: number
  scrollYProgress: MotionValue<number>
}

function TimelineCard({ stage, index, total, scrollYProgress }: TimelineCardProps) {
  // Define progressive activation thresholds for each stage based on scroll progress
  // Stage 0 (first card) is active from entry; stages 1, 2, 3 progressively activate on scroll
  const startThreshold = index === 0 ? 0 : index / total - 0.05
  const fullThreshold = index === 0 ? 0.08 : (index + 0.45) / total

  // Smooth opacity and scale transform as the user scrolls into each stage
  const opacity = useTransform(
    scrollYProgress,
    [startThreshold, fullThreshold],
    [index === 0 ? 1 : 0.28, 1],
  )
  const scale = useTransform(
    scrollYProgress,
    [startThreshold, fullThreshold],
    [index === 0 ? 1 : 0.98, 1],
  )
  const translateY = useTransform(
    scrollYProgress,
    [startThreshold, fullThreshold],
    [index === 0 ? 0 : 12, 0],
  )

  // Purple ring & dot state transform
  const nodeBorderColor = useTransform(
    scrollYProgress,
    [startThreshold, fullThreshold],
    [index === 0 ? '#6C47FF' : '#E2E8F0', '#6C47FF'],
  )
  const nodeDotScale = useTransform(
    scrollYProgress,
    [startThreshold, fullThreshold],
    [index === 0 ? 1 : 0.75, 1],
  )
  const nodeDotColor = useTransform(
    scrollYProgress,
    [startThreshold, fullThreshold],
    [index === 0 ? '#6C47FF' : '#CBD5E1', '#6C47FF'],
  )

  return (
    <motion.div
      style={{ opacity, scale, y: translateY }}
      className="relative flex items-start gap-5 sm:gap-7 transition-all duration-300"
    >
      {/* Timeline Node Icon (Circular ring with inner dot) */}
      <motion.div
        style={{ borderColor: nodeBorderColor }}
        className="relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 bg-white shadow-sm ring-4 ring-[#FAF8F5]"
      >
        <motion.div
          style={{ scale: nodeDotScale, backgroundColor: nodeDotColor }}
          className="h-3 w-3 rounded-full"
        />
      </motion.div>

      {/* Rounded Rectangular Card */}
      <div className="flex-1 rounded-2xl border border-slate-100 bg-white p-5 sm:p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-shadow duration-300 hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
        {/* Stage Header */}
        <h3 className="font-serif text-lg sm:text-xl font-medium tracking-tight text-slate-900">
          <span className="text-slate-800">{stage.time}</span>
          <span className="mx-1.5 text-slate-400">·</span>
          <span>{stage.title}</span>
        </h3>

        {/* Stage Description */}
        <p className="mt-2 text-sm sm:text-base leading-relaxed text-slate-600">
          {stage.description}
        </p>

        {/* Badge Tags (Soft pastel purple & neutral gray) */}
        <div className="mt-4 flex flex-wrap gap-2">
          {stage.purpleTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full border border-purple-100 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700 transition-colors"
            >
              {tag}
            </span>
          ))}

          {stage.grayTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full border border-stone-200 bg-[#EFECE6] px-3 py-1 text-xs font-medium text-stone-700 transition-colors"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

export function ScrollTimeline() {
  const containerRef = useRef<HTMLDivElement>(null)

  // Track scroll progress through this timeline container
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start 65%', 'end 75%'],
  })

  // Animate the continuous vertical purple connecting line downwards as you scroll
  const lineHeight = useTransform(scrollYProgress, [0, 1], ['0%', '100%'])

  return (
    <section className="relative w-full bg-[#FAF8F5] py-16 sm:py-24 text-slate-900">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        {/* Section Header */}
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 text-xs sm:text-sm font-medium lowercase tracking-wide text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-[#6C47FF]" />
            9:05 pm · the conversation begins
          </div>
          <h2 className="mt-3 font-serif text-3xl sm:text-4xl lg:text-5xl font-normal lowercase tracking-tight text-slate-900">
            career clarity starts with a conversation.
          </h2>
        </div>

        {/* Vertical Timeline Stack with Scroll Progress */}
        <div ref={containerRef} className="relative">
          {/* Continuous Neutral Connecting Background Line */}
          <div
            className="absolute left-[19px] top-5 bottom-5 w-[2px] bg-slate-200"
            aria-hidden="true"
          />

          {/* Animated Active Purple Fill Line Driven by Scroll */}
          <motion.div
            style={{ height: lineHeight }}
            className="absolute left-[19px] top-5 w-[2px] bg-[#6C47FF] origin-top"
            aria-hidden="true"
          />

          {/* Vertical Cards Stack */}
          <div className="space-y-6 sm:space-y-8">
            {TIMELINE_STAGES.map((stage, idx) => (
              <TimelineCard
                key={stage.id}
                stage={stage}
                index={idx}
                total={TIMELINE_STAGES.length}
                scrollYProgress={scrollYProgress}
              />
            ))}
          </div>
        </div>

        {/* Bottom CTA Button */}
        <div className="mt-12 text-center">
          <a
            href="/signup"
            className="inline-flex items-center justify-center rounded-full bg-[#6C47FF] px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition-all duration-200 hover:bg-[#5835E8] hover:shadow-xl hover:shadow-purple-500/35 hover:-translate-y-0.5"
          >
            start my 15-minute discovery
          </a>
        </div>
      </div>
    </section>
  )
}

export default ScrollTimeline
