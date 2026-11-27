import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  EMPLOYMENT_TYPE_OPTIONS,
  EXPERIENCE_OPTIONS,
  SKILL_OPTIONS,
  SUGGESTED_SKILLS,
  DEFAULT_SKILLS,
  createEmptyExperience,
  mentionedInResume,
  type ProfileFormData,
  type WorkExperience,
} from '../data/wizard'
import { HrIcon } from './HrIcon'
import { MotionStack } from '../motion/MotionStack'
import { SelectField } from './SelectField'
import {
  profileHasRoleContextForSkills,
  suggestSkillsForProfile,
} from '../lib/roleSkillSuggestions'
import { toMonthInputValue } from '../lib/resumeExperience'
import styles from './SkillsStep.module.css'

interface SkillsStepProps {
  data: ProfileFormData
  onChange: <K extends keyof ProfileFormData>(
    key: K,
    value: ProfileFormData[K],
  ) => void
}


function hasFilledWorkExperience(
  items: ProfileFormData['workExperiences'],
): boolean {
  return items.some(
    (w) =>
      Boolean(w.jobTitle?.trim()) ||
      Boolean(w.company?.trim()) ||
      Boolean(w.responsibilities?.trim()),
  )
}

export function SkillsStep({ data, onChange }: SkillsStepProps) {
  const [skillDraft, setSkillDraft] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const trimmedDraft = skillDraft.trim().toLowerCase()

  const matchingSuggestions = trimmedDraft
    ? SKILL_OPTIONS.filter(
        (skill) =>
          skill.toLowerCase().includes(trimmedDraft) &&
          !data.skills.some((item) => item.toLowerCase() === skill.toLowerCase()),
      ).slice(0, 8)
    : []

  // The suggestion helpers read only these fields, so the memos depend on exactly them.
  const { currentRole, preferredRoles, workExperiences, resumeText, skills } = data

  const roleBasedSuggestions = useMemo(
    () =>
      suggestSkillsForProfile(
        { currentRole, preferredRoles, workExperiences, resumeText, skills },
        SKILL_OPTIONS,
        14,
      ),
    [currentRole, preferredRoles, workExperiences, resumeText, skills],
  )

  const hasRoleContext = useMemo(
    () =>
      profileHasRoleContextForSkills({ currentRole, preferredRoles, workExperiences, resumeText }),
    [currentRole, preferredRoles, workExperiences, resumeText],
  )

  const idleSuggestions = useMemo(() => {
    const pool = hasRoleContext
      ? roleBasedSuggestions
      : // Popular skills first (new profiles start empty; these are one tap to add).
        [...DEFAULT_SKILLS, ...SUGGESTED_SKILLS].filter(
          (skill) =>
            !data.skills.some(
              (item) => item.toLowerCase() === skill.toLowerCase(),
            ),
        )
    return pool.slice(0, 14)
  }, [hasRoleContext, roleBasedSuggestions, data.skills])

  const availableSuggestions = trimmedDraft
    ? SKILL_OPTIONS.filter(
        (skill) =>
          skill.toLowerCase().includes(trimmedDraft) &&
          !data.skills.some((item) => item.toLowerCase() === skill.toLowerCase()),
      ).slice(0, 14)
    : idleSuggestions

  const experienceOptions =
    data.totalExperience && !EXPERIENCE_OPTIONS.includes(data.totalExperience)
      ? [data.totalExperience, ...EXPERIENCE_OPTIONS]
      : EXPERIENCE_OPTIONS

  const hasResumeWorkHistory =
    Boolean(data.resumeText?.trim()) &&
    /\b(work\s+experience|professional\s+experience|employment|internship)/i.test(
      data.resumeText,
    )

  const showFresherEmptyState =
    data.noPriorWorkExperience && !hasFilledWorkExperience(data.workExperiences)

  // Latest onChange for the effect below, which must re-run only when the work history or the flag changes.
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (hasFilledWorkExperience(data.workExperiences) && data.noPriorWorkExperience) {
      onChangeRef.current('noPriorWorkExperience', false)
    }
  }, [data.workExperiences, data.noPriorWorkExperience])

  function addSkill(raw: string) {
    const skill = raw.trim()
    if (!skill) return
    if (data.skills.some((item) => item.toLowerCase() === skill.toLowerCase())) {
      setSkillDraft('')
      setSelectedIndex(0)
      return
    }
    onChange('skills', [...data.skills, skill])
    setSkillDraft('')
    setSelectedIndex(0)
  }

  function removeSkill(skill: string) {
    onChange(
      'skills',
      data.skills.filter((item) => item !== skill),
    )
  }

  function onSkillKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (matchingSuggestions.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % matchingSuggestions.length)
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (matchingSuggestions.length > 0) {
        setSelectedIndex(
          (prev) => (prev - 1 + matchingSuggestions.length) % matchingSuggestions.length,
        )
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (matchingSuggestions.length > 0 && matchingSuggestions[selectedIndex]) {
        addSkill(matchingSuggestions[selectedIndex])
      } else {
        addSkill(skillDraft)
      }
    } else if (event.key === 'Escape') {
      setIsFocused(false)
    }
  }

  function updateExperience(
    id: string,
    patch: Partial<WorkExperience>,
  ) {
    onChange(
      'workExperiences',
      data.workExperiences.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    )
  }

  function addExperience() {
    onChange('noPriorWorkExperience', false)
    onChange('workExperiences', [
      ...data.workExperiences,
      createEmptyExperience(),
    ])
  }

  function removeExperience(id: string) {
    onChange(
      'workExperiences',
      data.workExperiences.filter((item) => item.id !== id),
    )
  }

  return (
    <MotionStack className={styles.stack}>
      <section className={styles.card} aria-labelledby="skills-title">
        <div className={styles.sectionHead}>
          <h2 id="skills-title">Skills</h2>
          <p>Add skills relevant to the roles you&apos;re interested in.</p>
        </div>

        <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="skill-input">
          Your skills
        </label>
        <div className={styles.inputWrapper}>
          <input
            id="skill-input"
            className={styles.textInput}
            type="text"
            value={skillDraft}
            placeholder="Type a skill, e.g. React, Python, Docker"
            onChange={(event) => {
              setSkillDraft(event.target.value)
              setSelectedIndex(0)
              setIsFocused(true)
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            onKeyDown={onSkillKeyDown}
            autoComplete="off"
          />

          {isFocused && matchingSuggestions.length > 0 && (
            <div className={styles.dropdownMenu} role="listbox">
              {matchingSuggestions.map((skill, index) => (
                <button
                  key={skill}
                  type="button"
                  className={`${styles.dropdownItem} ${
                    index === selectedIndex ? styles.dropdownItemActive : ''
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    addSkill(skill)
                  }}
                >
                  <span>{skill}</span>
                  <span className={styles.addBadge}>Add</span>
                </button>
              ))}
            </div>
          )}
        </div>
        </div>

        {data.skills.length > 0 && (
          <div className={styles.tagList}>
            <AnimatePresence mode="popLayout">
              {data.skills.map((skill) => (
                <motion.span
                  key={skill}
                  className={styles.skillTag}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                >
                  {skill}
                  <button
                    type="button"
                    className={styles.tagRemove}
                    aria-label={`Remove ${skill}`}
                    onClick={() => removeSkill(skill)}
                  >
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M4.5 4.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
        )}

        {availableSuggestions.length > 0 && (
          <div className={styles.suggestions}>
            <p className={styles.suggestLabel}>
              {trimmedDraft
                ? 'Matching suggestions'
                : hasRoleContext
                  ? 'Suggested for your roles'
                  : 'Suggested'}
            </p>
            <div className={styles.suggestRow}>
              {availableSuggestions.map((skill) => (
                <button
                  key={skill}
                  type="button"
                  className={styles.suggestChip}
                  onClick={() => addSkill(skill)}
                >
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  {skill}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className={styles.card} aria-labelledby="work-title">
        <div className={styles.sectionHead}>
          <h2 id="work-title">Work experience</h2>
          <p>Add your work experience details (optional for freshers).</p>
        </div>

        <div className={styles.fresherToggleBox}>
          <label className={styles.fresherCheckboxLabel}>
            <input
              type="checkbox"
              checked={data.noPriorWorkExperience}
              disabled={hasFilledWorkExperience(data.workExperiences)}
              onChange={(e) => {
                if (e.target.checked) {
                  onChange('noPriorWorkExperience', true)
                  onChange('workExperiences', [])
                } else {
                  onChange('noPriorWorkExperience', false)
                  onChange('workExperiences', [createEmptyExperience()])
                }
              }}
            />
            <span>I&apos;m a fresher and don&apos;t have prior work experience (0 years)</span>
          </label>
        </div>

        {showFresherEmptyState ? (
          <div className={styles.fresherEmptyCard}>
            <span className={styles.fresherBadge}>
              <HrIcon name="leaf" size={14} /> Fresher, 0 years prior experience
            </span>
            <h3>No prior work experience</h3>
            <p>
              You marked this profile as fresher. Ava and hiring teams will focus on skills, projects and fundamentals. Uncheck the box above if you have employment history to add.
            </p>
            <button
              type="button"
              className={styles.addExpBtnOutline}
              onClick={addExperience}
            >
              Add work experience (optional)
            </button>
          </div>
        ) : data.workExperiences.length === 0 ? (
          <div className={styles.fresherEmptyCard}>
            <h3>
              {hasResumeWorkHistory
                ? 'We could not auto-fill jobs from your resume'
                : 'Add your work experience'}
            </h3>
            <p>
              {hasResumeWorkHistory
                ? 'Your resume mentions experience. Add roles manually below, or re-upload a PDF/DOCX with a clear work experience section.'
                : 'List employers and roles so employers and Ava can tailor interviews to your background.'}
            </p>
            <button
              type="button"
              className={styles.addExpBtnOutline}
              onClick={addExperience}
            >
              Add work experience
            </button>
          </div>
        ) : (
          <div className={styles.experienceList}>
            {data.workExperiences.map((exp, index) => {
              const isDimmed = !exp.company.trim() && !exp.jobTitle.trim()
              const isScraped = Boolean(
                exp.fromResume || mentionedInResume(data.resumeText, exp.company),
              )
              const fid = `exp-${exp.id}`

              return (
                <motion.article
                  key={exp.id}
                  className={`${styles.experienceCard} ${isDimmed ? styles.dimmedExperienceCard : ''}`}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  aria-label={`Experience ${index + 1}`}
                >
                  <div className={styles.expTop}>
                    <div className={styles.expTitleRow}>
                      <span className={styles.expIcon} aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          <rect x="3.5" y="7" width="17" height="12.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
                          <path d="M3.5 12H20.5" stroke="currentColor" strokeWidth="1.6" />
                        </svg>
                      </span>
                      <h3 className={styles.expIndex}>Experience {index + 1}</h3>
                      {isScraped ? (
                        <span className={styles.scrapedBadge}>
                          <HrIcon name="check" size={12} /> From your resume
                        </span>
                      ) : isDimmed ? (
                        <span className={styles.dimmedBadge}>
                          Optional for freshers
                        </span>
                      ) : (
                        <span className={styles.manualBadge}>
                          Added
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className={styles.removeExp}
                      onClick={() => removeExperience(exp.id)}
                    >
                      Remove
                    </button>
                  </div>

                  <div className={styles.twoCol}>
                    <div className={styles.field}>
                      <label htmlFor={`${fid}-title`}>Job title</label>
                      <input
                        id={`${fid}-title`}
                        className={styles.textInput}
                        value={exp.jobTitle}
                        placeholder="e.g. Software Engineer"
                        onChange={(event) =>
                          updateExperience(exp.id, {
                            jobTitle: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`${fid}-company`}>Company</label>
                      <input
                        id={`${fid}-company`}
                        className={styles.textInput}
                        value={exp.company}
                        placeholder="e.g. Infosys (leave empty if fresher)"
                        onChange={(event) =>
                          updateExperience(exp.id, {
                            company: event.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className={styles.threeCol}>
                    <SelectField
                      label="Employment type"
                      value={exp.employmentType}
                      options={EMPLOYMENT_TYPE_OPTIONS}
                      placeholder="Select type"
                      onChange={(value) =>
                        updateExperience(exp.id, { employmentType: value })
                      }
                    />
                    <div className={styles.field}>
                      <label htmlFor={`${fid}-start`}>Start date</label>
                      <input
                        id={`${fid}-start`}
                        className={styles.textInput}
                        type="month"
                        value={toMonthInputValue(exp.startDate)}
                        onChange={(event) =>
                          updateExperience(exp.id, {
                            startDate: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`${fid}-end`}>End date</label>
                      {exp.currentlyWorking ? (
                        <input
                          id={`${fid}-end`}
                          className={styles.textInput}
                          value="Present"
                          readOnly
                        />
                      ) : (
                        <input
                          id={`${fid}-end`}
                          className={styles.textInput}
                          type="month"
                          value={toMonthInputValue(exp.endDate)}
                          onChange={(event) =>
                            updateExperience(exp.id, {
                              endDate: event.target.value,
                            })
                          }
                        />
                      )}
                    </div>
                  </div>

                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={exp.currentlyWorking}
                      onChange={(event) =>
                        updateExperience(exp.id, {
                          currentlyWorking: event.target.checked,
                          endDate: event.target.checked ? '' : exp.endDate,
                        })
                      }
                    />
                    I currently work here
                  </label>

                  <div className={styles.field}>
                    <label htmlFor={`${fid}-location`}>
                      Location <span className={styles.optional}>(optional)</span>
                    </label>
                    <input
                      id={`${fid}-location`}
                      className={styles.textInput}
                      value={exp.location}
                      placeholder="e.g. Hyderabad, India"
                      onChange={(event) =>
                        updateExperience(exp.id, {
                          location: event.target.value,
                        })
                      }
                    />
                  </div>

                  <div className={styles.field}>
                    <label htmlFor={`${fid}-resp`}>
                      Key responsibilities <span className={styles.optional}>(optional)</span>
                    </label>
                    <textarea
                      id={`${fid}-resp`}
                      className={styles.textarea}
                      rows={5}
                      maxLength={600}
                      value={exp.responsibilities}
                      placeholder="Describe what you achieved in this role…"
                      aria-describedby={`${fid}-resp-count`}
                      onChange={(event) =>
                        updateExperience(exp.id, {
                          responsibilities: event.target.value,
                        })
                      }
                    />
                    <span id={`${fid}-resp-count`} className={styles.counter}>
                      {(exp.responsibilities ?? '').length}/600
                    </span>
                  </div>
                </motion.article>
              )
            })}
          </div>
        )}

        {data.workExperiences.length > 0 && (
          <button
            type="button"
            className={styles.addExp}
            onClick={addExperience}
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            Add another experience
          </button>
        )}
      </section>

      <section className={styles.card} aria-label="Total experience">
        <SelectField
          label="Total experience"
          value={data.totalExperience}
          options={experienceOptions}
          placeholder="Select experience"
          onChange={(value) => onChange('totalExperience', value)}
        />
      </section>
    </MotionStack>
  )
}
