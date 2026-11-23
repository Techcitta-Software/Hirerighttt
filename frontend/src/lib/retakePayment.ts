/**
 * Paid interview retakes (backend: services/retake_payments.py, dispatch/payment_routes.py).
 * The server enforces the rule at /api/interview/start (402 RETAKE_PAYMENT_REQUIRED), so the retake page must check
 * the status and take the Razorpay payment first; it used to send everyone straight to the interview room, where the
 * start failed for anyone who had used the free interview.
 */
import { apiFetch } from './api'

export type RetakeStatus = {
  completedInterviews: number
  freeInterviewAvailable: boolean
  retakeCredits: number
  canStartCareerInterview: boolean
  priceInr: number
  paymentsConfigured: boolean
  razorpayKeyId: string | null
}

type RetakeOrder = { orderId: string; amount: number; currency: string; keyId: string; priceInr: number }

type RazorpaySuccess = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }

type RazorpayInstance = { open: () => void; on: (event: string, cb: (resp: unknown) => void) => void }
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance

declare global {
  interface Window {
    Razorpay?: RazorpayCtor
  }
}

export const RAZORPAY_CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || data.detail || `Request failed (${res.status})`)
  return data as T
}

export function fetchRetakeStatus(): Promise<RetakeStatus> {
  return call<RetakeStatus>('/api/payments/retake/status')
}

/** What the retake page offers for a given status. */
export type RetakeAction = 'start-free' | 'start-credit' | 'pay' | 'unavailable'

export function retakeActionFor(status: RetakeStatus | null): RetakeAction {
  if (!status) return 'start-free'  // status unknown (no database): let the server decide at interview start
  if (status.freeInterviewAvailable) return 'start-free'
  if (status.retakeCredits > 0) return 'start-credit'
  return status.paymentsConfigured ? 'pay' : 'unavailable'
}

let checkoutScript: Promise<RazorpayCtor> | null = null

export function loadRazorpayCheckout(): Promise<RazorpayCtor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  if (checkoutScript) return checkoutScript
  checkoutScript = new Promise<RazorpayCtor>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = RAZORPAY_CHECKOUT_SRC
    script.async = true
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Payment window failed to load.')))
    script.onerror = () => {
      checkoutScript = null
      reject(new Error('Could not load the payment window. Check your connection and try again.'))
    }
    document.head.appendChild(script)
  })
  return checkoutScript
}

/**
 * Creates the order on the server, opens Razorpay Checkout and verifies the payment on the server.
 * Resolves with the new status (one unused credit) or rejects with a readable error; closing the window rejects
 * with "Payment cancelled."
 */
export async function payForRetake(prefill: { name?: string; email?: string; contact?: string }): Promise<RetakeStatus> {
  const order = await call<RetakeOrder>('/api/payments/retake/order', { method: 'POST', body: '{}' })
  const Razorpay = await loadRazorpayCheckout()
  const paid = await new Promise<RazorpaySuccess>((resolve, reject) => {
    const checkout = new Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: 'HireRighttt',
      description: 'AI interview retake',
      prefill,
      handler: (resp: RazorpaySuccess) => resolve(resp),
      modal: { ondismiss: () => reject(new Error('Payment cancelled.')) },
    })
    checkout.on('payment.failed', () => reject(new Error('The payment failed. You were not charged; try again.')))
    checkout.open()
  })
  return call<RetakeStatus>('/api/payments/retake/verify', { method: 'POST', body: JSON.stringify(paid) })
}
