import type { ProfileFormData } from '../data/wizard'
import {
  createEmptyMetric,
  LOCATION_OPTIONS,
  NOTICE_OPTIONS,
  ROLE_OPTIONS,
} from '../data/wizard'
import type { ResumeExtract } from '../lib/resumeParser'
import { updateUserName } from '../lib/store'
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
}

export function AboutYouStep({
  data,
  onChange,
  onPatch,
  onExtracted,
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
    const patch: Partial<ProfileFormData> = {}
    if (extract.whoAreYou) patch.whoAreYou = extract.whoAreYou
    // "Can you brief me more?" — manual only; resume/AI must not pre-fill this field.
    if (extract.keyStrengths) patch.keyStrengths = extract.keyStrengths
    if (extract.currentRole) patch.currentRole = extract.currentRole
    if (extract.totalExperience) patch.totalExperience = extract.totalExperience
    if (extract.currentLocation) patch.currentLocation = extract.currentLocation
    if (extract.skills?.length) patch.skills = extract.skills
    if (extract.experienceSummary) patch.experienceSummary = extract.experienceSummary
    if (extract.workExperiences !== undefined) {
      patch.workExperiences = extract.workExperiences
    }
    if (extract.achievements?.length) patch.achievements = extract.achievements
    if (extract.metrics !== undefined) {
      patch.metrics = extract.metrics.length
        ? extract.metrics
        : [createEmptyMetric()]
    }
    if (extract.certifications?.length) patch.certifications = extract.certifications
    if (extract.resumeText) patch.resumeText = extract.resumeText

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

  return (
    <MotionStack className={styles.stack}>
      <MotionItem>
        <ResumeUpload
          file={data.resumeFile}
          existingFileName={data.resumeName}
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

      <MotionItem as="section" className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>2. Tell Us About Yourself</h2>
          <h3>Help us know you better in a few words.</h3>
        </div>

        <div className={styles.twoCol}>
          <CharacterTextarea
            label="What I know about you"
            sublabel="Introduce yourself in a few lines."
            value={data.whoAreYou}
            maxLength={300}
            placeholder="E.g. I'm a passionate software engineer with 3+ years of experience in building scalable web applications..."
            onChange={(value) => onChange('whoAreYou', value)}
          />
          <CharacterTextarea
            label="Can you brief me more?"
            sublabel="Add a little more detail about your background and goals."
            value={data.whatDrivesYou}
            maxLength={300}
            placeholder="Type your answer here…"
            onChange={(value) => onChange('whatDrivesYou', value)}
          />
        </div>

        <CharacterTextarea
          label="What are your key strengths?"
          sublabel="Share your top 3-5 strengths."
          value={data.keyStrengths}
          maxLength={250}
          placeholder="E.g. Problem solving, Team collaboration, Attention to detail, Adaptability..."
          onChange={(value) => onChange('keyStrengths', value)}
          rows={3}
        />
      </MotionItem>

      <MotionItem as="section" className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>3. Your Current Snapshot</h2>
        </div>
        <div className={styles.threeCol}>
          <SelectField
            label="Current Role"
            value={data.currentRole}
            options={roleOptions}
            placeholder="Select your role"
            onChange={(value) => onChange('currentRole', value)}
          />
          <SelectField
            label="Current Location"
            value={data.currentLocation}
            options={locationOptions}
            placeholder="Select location"
            onChange={(value) => onChange('currentLocation', value)}
          />
          <SelectField
            label="Notice Period"
            value={data.noticePeriod}
            options={NOTICE_OPTIONS}
            placeholder="Select notice period"
            onChange={(value) => onChange('noticePeriod', value)}
          />
        </div>
      </MotionItem>
    </MotionStack>
  )
}
