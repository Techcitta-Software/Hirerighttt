import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { beginImmediateInterview } from '../lib/interviewTestMode'

/** Sets immediate-interview flag and opens the live studio (skips scheduled invite gate). */
export function InterviewNowPage() {
  const navigate = useNavigate()
  useEffect(() => {
    beginImmediateInterview(navigate, { returnToWizard: false, replace: true })
  }, [navigate])
  return null
}
