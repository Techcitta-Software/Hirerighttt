import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { markImmediateInterview } from '../lib/interviewInviteGate'

/** Sets immediate-interview flag and opens the live studio (skips scheduled invite gate). */
export function InterviewNowPage() {
  const navigate = useNavigate()
  useEffect(() => {
    markImmediateInterview()
    navigate('/interview', { replace: true })
  }, [navigate])
  return null
}
