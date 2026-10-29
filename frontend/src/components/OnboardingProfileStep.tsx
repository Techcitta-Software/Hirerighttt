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
import { MotionItem, MotionStack } from '../motion/MotionStack'
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
      <MotionItem>
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
      </MotionItem>

      {hasResume ? (
        <>
          {narrativeBlock}
          {snapshotBlock}

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
            <MotionItem className={styles.collapsedBar}>
              <p className={styles.collapsedHint}>
                We&apos;ve pre-filled your profile from your resume. Review or edit any field
                before you continue.
              </p>
              <button
                type="button"
                className={styles.detailsToggle}
                onClick={() => setDetailsOpen(true)}
              >
                Update / review details
              </button>
            </MotionItem>
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
