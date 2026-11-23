import type { ProfileFormData } from '../data/wizard'
import {
  LOCATION_OPTIONS,
  NOTICE_OPTIONS,
  ROLE_OPTIONS,
} from '../data/wizard'
import {
  resumeExtractToProfilePatch,
  type ResumeExtract,
} from '../lib/resumeParser'
import { MotionItem, MotionStack } from '../motion/MotionStack'
import { CharacterTextarea } from './CharacterTextarea'
import { ResumeUpload } from './ResumeUpload'
import { SelectField } from './SelectField'
import styles from './AboutYouStep.module.css'

interface AboutYouStepProps {
  data: ProfileFormData
  onChange: <K extends keyof ProfileFormData>(
    key: K,
    value: ProfileFormData[K],
  ) => void
  onPatch: (patch: Partial<ProfileFormData>) => void
  onExtracted?: (info: { firstName?: string; fieldCount: number }) => void
  /** When set, only renders profile fields (no resume upload). */
  profileFieldsOnly?: boolean
  /** When false, hides resume upload (use with profileFieldsOnly or alone). */
  showResumeUpload?: boolean
  /** Section 2 text fields (about you narratives). */
  showNarrativeSection?: boolean
  /** Section 3 role / location / notice period. */
  showSnapshotSection?: boolean
}

export function AboutYouStep({
  data,
  onChange,
  onPatch,
  onExtracted,
  profileFieldsOnly = false,
  showResumeUpload = true,
  showNarrativeSection = true,
  showSnapshotSection = true,
}: AboutYouStepProps) {
  const roleOptions =
    data.currentRole && !ROLE_OPTIONS.includes(data.currentRole)
      ? [data.currentRole, ...ROLE_OPTIONS]
      : ROLE_OPTIONS

  const locationOptions =
    data.currentLocation && !LOCATION_OPTIONS.includes(data.currentLocation)
      ? [data.currentLocation, ...LOCATION_OPTIONS]
      : LOCATION_OPTIONS

  function applyExtract(extract: ResumeExtract) {
    const patch = resumeExtractToProfilePatch(extract)
    if (Object.keys(patch).length) onPatch(patch)

    // The name shown everywhere comes from the resume itself; the signup name is not overwritten.
    const resumeName = (patch as { fullName?: string }).fullName
    const nextFirst: string | undefined = resumeName ? resumeName.split(' ')[0] : undefined

    onExtracted?.({
      firstName: nextFirst,
      fieldCount: Object.keys(patch).length,
    })
  }

  const narrativeSection = showNarrativeSection ? (
    <MotionItem as="section" className={styles.card}>
      <div className={styles.sectionHead}>
        <h2>About you</h2>
        <h3>A few lines in your own words. Ava uses this to tailor your interview.</h3>
      </div>

      <div className={styles.twoCol}>
        <CharacterTextarea
          label="Short introduction"
          sublabel="Who you are and what you do."
          value={data.whoAreYou}
          maxLength={300}
          showCounter={false}
          placeholder="E.g. I'm a passionate software engineer with 3+ years of experience in building scalable web applications..."
          onChange={(value) => onChange('whoAreYou', value)}
        />
        <CharacterTextarea
          label="Background and goals"
          sublabel="What you have worked on and what you want next."
          value={data.whatDrivesYou}
          maxLength={300}
          showCounter={false}
          placeholder="E.g. I build checkout flows for fintech apps and want to grow into a lead role."
          onChange={(value) => onChange('whatDrivesYou', value)}
        />
      </div>

      <CharacterTextarea
        label="Key strengths"
        sublabel="Share your top 3-5 strengths."
        value={data.keyStrengths}
        maxLength={250}
        showCounter={false}
        placeholder="E.g. Problem solving, Team collaboration, Attention to detail, Adaptability..."
        onChange={(value) => onChange('keyStrengths', value)}
        rows={3}
      />
    </MotionItem>
  ) : null

  const snapshotSection = showSnapshotSection ? (
    <MotionItem as="section" className={styles.card}>
      <div className={styles.sectionHead}>
        <h2>Current snapshot</h2>
      </div>
      <div className={styles.threeCol}>
        <SelectField
          label="Current role"
          value={data.currentRole}
          options={roleOptions}
          placeholder="Select your role"
          onChange={(value) => onChange('currentRole', value)}
        />
        <SelectField
          label="Current location"
          value={data.currentLocation}
          options={locationOptions}
          placeholder="Select location"
          onChange={(value) => onChange('currentLocation', value)}
        />
        <SelectField
          label="Notice period"
          value={data.noticePeriod}
          options={NOTICE_OPTIONS}
          placeholder="Select notice period"
          onChange={(value) => onChange('noticePeriod', value)}
        />
      </div>
    </MotionItem>
  ) : null

  const profileFields = (
    <>
      {narrativeSection}
      {snapshotSection}
    </>
  )

  if (profileFieldsOnly) {
    return <MotionStack className={styles.stack}>{profileFields}</MotionStack>
  }

  return (
    <MotionStack className={styles.stack}>
      {showResumeUpload ? (
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
      ) : null}
      {profileFields}
    </MotionStack>
  )
}
