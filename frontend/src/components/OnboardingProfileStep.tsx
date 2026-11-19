import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ProfileFormData } from '../data/wizard'
import { AboutYouStep } from './AboutYouStep'
import { PerformanceStep } from './PerformanceStep'
import { ResumeUpload } from './ResumeUpload'
import { SkillsStep } from './SkillsStep'
import {
  resumeExtractToProfilePatch,
  type ResumeExtract,
} from '../lib/resumeParser'
import { updateUserName } from '../lib/store'
import { MotionStack } from '../motion/MotionStack'
import { easeOut } from '../motion/variants'
import styles from './OnboardingProfileStep.module.css'

interface OnboardingProfileStepProps {
  data: ProfileFormData
  onChange: <K extends keyof ProfileFormData>(
    key: K,
    value: ProfileFormData[K],
  ) => void
  onPatch: (patch: Partial<ProfileFormData>) => void
  onExtracted?: (info: { firstName?: string; fieldCount: number }) => void
}

export function OnboardingProfileStep({
  data,
  onChange,
  onPatch,
  onExtracted,
}: OnboardingProfileStepProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  function applyExtract(extract: ResumeExtract) {
    const patch = resumeExtractToProfilePatch(extract)
    if (Object.keys(patch).length) onPatch(patch)

    let nextFirst: string | undefined
    if (extract.fullName) {
      const updated = updateUserName(extract.fullName)
      nextFirst = updated?.name.split(' ')[0]
    }

    onExtracted?.({
      firstName: nextFirst,
      fieldCount: Object.keys(patch).length,
    })
  }

  const hasResume = Boolean(data.resumeFile || data.resumeName || data.resumeText?.trim())
  const filledJobs = data.workExperiences.filter((w) => w.jobTitle.trim() || w.company.trim())
  const summaryRows: Array<[string, string]> = [
    ['Current role', data.currentRole.trim()],
    ['Experience', data.totalExperience.trim()],
    ['Location', data.currentLocation.trim()],
    [
      'Skills',
      data.skills.length
        ? `${data.skills.slice(0, 5).join(', ')}${data.skills.length > 5 ? ` +${data.skills.length - 5} more` : ''}`
        : '',
    ],
    [
      'Work history',
      filledJobs.length ? `${filledJobs.length} ${filledJobs.length === 1 ? 'role' : 'roles'}` : '',
    ],
  ]

  const narrativeBlock = (
    <AboutYouStep
      data={data}
      onChange={onChange}
      onPatch={onPatch}
      profileFieldsOnly
      showResumeUpload={false}
      showNarrativeSection
      showSnapshotSection={false}
    />
  )

  const snapshotBlock = (
    <AboutYouStep
      data={data}
      onChange={onChange}
      onPatch={onPatch}
      profileFieldsOnly
      showResumeUpload={false}
      showNarrativeSection={false}
      showSnapshotSection
    />
  )

  const skillsAndPerformance = (
    <>
      <SkillsStep data={data} onChange={onChange} />
      <PerformanceStep data={data} onChange={onChange} />
    </>
  )

  return (
    <MotionStack className={styles.stack}>
      <div>
        <ResumeUpload
          file={data.resumeFile}
          existingFileName={data.resumeFile ? data.resumeName : null}
          onFileChange={(file) => {
            onChange('resumeFile', file)
            onChange('resumeName', file ? file.name : null)
          }}
          onParsed={applyExtract}
          onStored={(info) => {
            onPatch({
              resumeUrl: info.resumeUrl,
              resumeStoragePath: info.resumeStoragePath,
              resumeFileId: info.resumeFileId ?? null,
              storageProvider: info.storageProvider ?? null,
            })
          }}
        />
      </div>

      {hasResume ? (
        <>
          {detailsOpen ? (
            <div className={styles.detailsToolbar}>
              <button
                type="button"
                className={styles.collapseBtn}
                onClick={() => setDetailsOpen(false)}
              >
                Hide details
              </button>
            </div>
          ) : (
            <div className={styles.collapsedBar}>
              <div className={styles.collapsedCopy}>
                <p className={styles.collapsedHint}>
                  We&apos;ve pre-filled your profile from your resume. Check it looks right, or edit any field.
                </p>
                <dl className={styles.summaryList}>
                  {summaryRows.map(([label, value]) => (
                    <div key={label} className={styles.summaryRow}>
                      <dt>{label}</dt>
                      <dd className={value ? undefined : styles.summaryMissing}>{value || 'Not found — add it'}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <button
                type="button"
                className={styles.detailsToggle}
                onClick={() => setDetailsOpen(true)}
              >
                Review details
              </button>
            </div>
          )}

          <AnimatePresence initial={false}>
            {detailsOpen ? (
              <motion.div
                key="profile-extended"
                className={styles.detailsWrap}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: easeOut }}
              >
                {narrativeBlock}
                {snapshotBlock}
                {skillsAndPerformance}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </>
      ) : (
        <>
          {narrativeBlock}
          {snapshotBlock}
          {skillsAndPerformance}
        </>
      )}
    </MotionStack>
  )
}
