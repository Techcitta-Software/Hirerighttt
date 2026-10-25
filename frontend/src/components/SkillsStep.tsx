import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  EMPLOYMENT_TYPE_OPTIONS,
  EXPERIENCE_OPTIONS,
  SKILL_OPTIONS,
  SUGGESTED_SKILLS,
  createEmptyExperience,
  type ProfileFormData,
  type WorkExperience,
} from '../data/wizard'
import { HrIcon } from './HrIcon'
import { MotionButton } from '../motion/MotionButton'
import { MotionItem, MotionStack } from '../motion/MotionStack'
import { SelectField } from './SelectField'
import {
  profileHasRoleContextForSkills,
  suggestSkillsForProfile,
} from '../lib/roleSkillSuggestions'
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

  const roleBasedSuggestions = useMemo(
    () => suggestSkillsForProfile(data, SKILL_OPTIONS, 14),
    [
      data.currentRole,
      data.preferredRoles,
      data.workExperiences,
      data.resumeText,
      data.skills,
    ],
  )

  const hasRoleContext = useMemo(
    () => profileHasRoleContextForSkills(data),
    [
      data.currentRole,
      data.preferredRoles,
      data.workExperiences,
      data.resumeText,
    ],
  )

  const idleSuggestions = useMemo(() => {
    const pool = hasRoleContext
      ? roleBasedSuggestions
      : SUGGESTED_SKILLS.filter(
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

  useEffect(() => {
    if (hasFilledWorkExperience(data.workExperiences) && data.noPriorWorkExperience) {
      onChange('noPriorWorkExperience', false)
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
      <MotionItem as="section" className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>1. Add Your Skills</h2>
          <h3>Add skills relevant to the roles you&apos;re interested in.</h3>
        </div>

        <label className={styles.fieldLabel} htmlFor="skill-input">
          Your Skills
        </label>
        <div className={styles.inputWrapper}>
          <input
            id="skill-input"
            className={styles.textInput}
            type="text"
            value={skillDraft}
            placeholder="Type a skill (e.g. React, Python, Docker, AI)..."
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
                  <span className={styles.addBadge}>+ Add</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {data.skills.length > 0 && (
          <div className={styles.tagList}>
            <AnimatePresence mode="popLayout">
              {data.skills.map((skill) => (
              <motion.span
                key={skill}
                className={styles.skillTag}
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                whileHover={{ y: -2, scale: 1.04 }}
              >
                {skill}
                <motion.button
                  type="button"
                  className={styles.tagRemove}
                  aria-label={`Remove ${skill}`}
                  onClick={() => removeSkill(skill)}
                  whileTap={{ scale: 0.85 }}
                >
                  ×
                </motion.button>
              </motion.span>
              ))}
            </AnimatePresence>
          </div>
        )}

        {availableSuggestions.length > 0 && (
          <div className={styles.suggestions}>
            <p className={styles.suggestLabel}>
              {trimmedDraft
                ? 'Matching Suggestions'
                : hasRoleContext
                  ? 'Suggested for your roles'
                  : 'Suggested'}
            </p>
            <div className={styles.suggestRow}>
              {availableSuggestions.map((skill) => (
                <motion.button
                  key={skill}
                  type="button"
                  className={styles.suggestChip}
                  onClick={() => addSkill(skill)}
                  whileHover={{ y: -2, scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                >
                  + {skill}
                </motion.button>
              ))}
            </div>
          </div>
        )}
      </MotionItem>

      <MotionItem as="section" className={styles.card}>
        <div className={styles.sectionHead}>
          <h2>2. Work Experience</h2>
          <h3>Add your work experience details (optional for freshers).</h3>
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
            <span>I am a fresher / I don&apos;t have prior work experience (0 years)</span>
          </label>
        </div>

        {showFresherEmptyState ? (
          <div className={styles.fresherEmptyCard}>
            <div className={styles.fresherBadge}>
              <HrIcon name="leaf" size={16} /> Fresher / 0 Years Prior Experience
            </div>
            <h4>No prior work experience</h4>
            <p>
              You marked this profile as fresher. Ava and hiring teams will focus on skills, projects, and fundamentals. Uncheck the box above if you have employment history to add.
            </p>
            <button
              type="button"
              className={styles.addExpBtnOutline}
              onClick={addExperience}
            >
              + Add Work Experience (Optional)
            </button>
          </div>
        ) : data.workExperiences.length === 0 ? (
          <div className={styles.fresherEmptyCard}>
            <h4>
              {hasResumeWorkHistory
                ? 'We could not auto-fill jobs from your resume'
                : 'Add your work experience'}
            </h4>
            <p>
              {hasResumeWorkHistory
                ? 'Your resume mentions experience — add roles manually below, or re-upload a PDF/DOCX with a clear Work Experience section.'
                : 'List employers and roles so employers and Ava can tailor interviews to your background.'}
            </p>
            <button
              type="button"
              className={styles.addExpBtnOutline}
              onClick={addExperience}
            >
              + Add Work Experience
            </button>
          </div>
        ) : (
          <div className={styles.experienceList}>
            {data.workExperiences.map((exp, index) => {
              const isDimmed = !exp.company.trim() && !exp.jobTitle.trim()
              const isScraped = Boolean(
                data.resumeText &&
                  exp.company.trim() &&
                  data.resumeText
                    .toLowerCase()
                    .includes(exp.company.trim().toLowerCase().slice(0, 4)),
              )

              return (
                <motion.article
                  key={exp.id}
                  className={`${styles.experienceCard} ${isDimmed ? styles.dimmedExperienceCard : ''}`}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -3 }}
                >
                  <div className={styles.expIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path
                        d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                      <rect
                        x="3.5"
                        y="7"
                        width="17"
                        height="12.5"
                        rx="2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M3.5 12H20.5"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                    </svg>
                  </div>

                  <div className={styles.expBody}>
                    <div className={styles.expTop}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <p className={styles.expIndex}>Experience {index + 1}</p>
                        {isScraped ? (
                          <span className={styles.scrapedBadge}>
                            <HrIcon name="check" size={12} /> Scraped from resume
                          </span>
                        ) : isDimmed ? (
                          <span className={styles.dimmedBadge}>
                            <HrIcon name="sparkle" size={12} /> Optional for freshers
                          </span>
                        ) : (
                          <span className={styles.manualBadge}>
                            <HrIcon name="check" size={12} /> Added
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
                        <label>
                          Job Title <span className={styles.req}>*</span>
                        </label>
                        <input
                          className={styles.textInput}
                          value={exp.jobTitle}
                          placeholder="e.g. Software Engineer, Frontend Developer..."
                          onChange={(event) =>
                            updateExperience(exp.id, {
                              jobTitle: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className={styles.field}>
                        <label>
                          Company <span className={styles.req}>*</span>
                        </label>
                        <input
                          className={styles.textInput}
                          value={exp.company}
                          placeholder="e.g. Google, Infosys, Microsoft... (leave empty if fresher)"
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
                    label="Employment Type"
                    value={exp.employmentType}
                    options={EMPLOYMENT_TYPE_OPTIONS}
                    placeholder="Select type"
                    onChange={(value) =>
                      updateExperience(exp.id, { employmentType: value })
                    }
                  />
                  <div className={styles.field}>
                    <label>
                      Start Date <span className={styles.req}>*</span>
                    </label>
                    <div className={styles.dateWrap}>
                      <input
                        className={styles.textInput}
                        type="month"
                        value={exp.startDate}
                        onChange={(event) =>
                          updateExperience(exp.id, {
                            startDate: event.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label>End Date</label>
                    {exp.currentlyWorking ? (
                      <input
                        className={styles.textInput}
                        value="Present"
                        readOnly
                      />
                    ) : (
                      <input
                        className={styles.textInput}
                        type="month"
                        value={exp.endDate}
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
                  <span className={styles.checkboxUi} aria-hidden="true" />
                  I currently work here
                </label>

                <div className={styles.field}>
                  <label>Location</label>
                  <input
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
                  <label>Key Responsibilities</label>
                  <div className={styles.textareaWrap}>
                    <textarea
                      className={styles.textarea}
                      rows={5}
                      maxLength={600}
                      value={exp.responsibilities}
                      placeholder="• Describe what you achieved in this role..."
                      onChange={(event) =>
                        updateExperience(exp.id, {
                          responsibilities: event.target.value,
                        })
                      }
                    />
                    <span className={styles.counter}>
                      {exp.responsibilities.length}/600
                    </span>
                  </div>
                </div>
              </div>
            </motion.article>
          )
        })}
          </div>
        )}

        {data.workExperiences.length > 0 && (
          <MotionButton
            type="button"
            className={styles.addExp}
            onClick={addExperience}
            lift
          >
            <span aria-hidden="true">+</span> Add Another Experience
          </MotionButton>
        )}
      </MotionItem>

      <MotionItem as="section" className={styles.card}>
        <div className={styles.totalStack}>
          <div className={styles.totalSelect}>
            <SelectField
              label="Total Experience"
              value={data.totalExperience}
              options={experienceOptions}
              placeholder="Select experience"
              onChange={(value) => onChange('totalExperience', value)}
            />
          </div>
          <motion.aside
            className={styles.motivate}
            whileHover={{ y: -3, scale: 1.01 }}
          >
            <div className={styles.motivateIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 19V11M10 19V7M16 19V13M22 19H2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <p className={styles.motivateTitle}>Keep going!</p>
              <p>
                You&apos;re doing great. This information helps us find the best
                opportunities for you.
              </p>
            </div>
          </motion.aside>
        </div>
      </MotionItem>

    </MotionStack>
  )
}
