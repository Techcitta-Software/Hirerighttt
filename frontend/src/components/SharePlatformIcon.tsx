type Props = {
  id: string
  size?: number
}

/** Brand-style icons for job link sharing (inline SVG, no external assets). */
export function SharePlatformIcon({ id, size = 40 }: Props) {
  const s = size
  switch (id) {
    case 'gmail':
      return (
        <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
          <path fill="#4caf50" d="M45 16.2L24 28.5 3 16.2V38a3 3 0 003 3h36a3 3 0 003-3V16.2z" />
          <path fill="#ffc107" d="M45 11.8V16.2L24 28.5 3 16.2V11.8L24 24.1 45 11.8z" />
          <path fill="#f44336" d="M3 11.8v4.4L24 28.5 45 16.2v-4.4L24 24.1 3 11.8z" />
          <path fill="#2196f3" d="M3 11.8L24 24.1 45 11.8 41 7H7L3 11.8z" />
        </svg>
      )
    case 'outlook':
    case 'outlook-live':
      return (
        <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
          <rect width="48" height="48" rx="8" fill="#0078d4" />
          <path
            fill="#fff"
            d="M14 16h12.5c4.4 0 8 3.6 8 8s-3.6 8-8 8H14V16zm4 4v8h8.5c2.2 0 4-1.8 4-4s-1.8-4-4-4H18z"
          />
          <ellipse cx="13" cy="24" rx="7" ry="9" fill="#28a8ea" />
          <path fill="#fff" d="M10 24a3 3 0 106 0 3 3 0 10-6 0z" />
        </svg>
      )
    case 'mailto':
      return (
        <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
          <rect width="48" height="48" rx="10" fill="#64748b" />
          <path
            fill="#fff"
            d="M10 16h28a2 2 0 012 2v16a2 2 0 01-2 2H10a2 2 0 01-2-2V18a2 2 0 012-2zm0 4l14 10 14-10v12H10V20z"
          />
        </svg>
      )
    case 'whatsapp':
      return (
        <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
          <circle cx="24" cy="24" r="24" fill="#25d366" />
          <path
            fill="#fff"
            d="M34.5 28.5c-.6-.3-3.5-1.7-4-1.9-.5-.2-.9-.3-1.2.3-.3.6-1.3 1.9-1.6 2.3-.3.4-.6.4-1.2.1-3.5-1.8-5.8-3.2-8.1-7.2-.6-1 .6-1 1.7-3.3.2-.4 0-.7-.1-1-.1-.3-1.2-2.9-1.6-4-.4-1.1-.9-1-1.2-1h-1c-.4 0-1 .1-1.5.7-.5.6-2 2-2 4.8s2 5.6 2.3 6c.3.4 4 6.1 9.7 8.6 1.4.6 2.4 1 3.2 1.3 1.3.4 2.5.3 3.4.2 1-.1 3.5-1.4 4-2.8.5-1.4.5-2.6.4-2.8-.1-.2-.5-.3-1.1-.6z"
          />
        </svg>
      )
    case 'telegram':
      return (
        <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
          <circle cx="24" cy="24" r="24" fill="#229ed9" />
          <path
            fill="#fff"
            d="M33.2 15.2L10.5 23.8c-1.2.5-1.2 1.2-.2 1.5l5.8 1.8 2.2 6.8c.3.8.5 1.1 1.1 1.1.6 0 .9-.3 1.3-.9l3.1-3 6.4 4.7c1.2.7 2 .3 2.3-1.1l3.7-17.5c.4-1.7-.6-2.4-1.7-2z"
          />
        </svg>
      )
    case 'linkedin':
      return (
        <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
          <rect width="48" height="48" rx="8" fill="#0a66c2" />
          <path
            fill="#fff"
            d="M14 20h4v16h-4V20zm2-6a2.3 2.3 0 110 4.6 2.3 2.3 0 010-4.6zM18 20h4v2.2h.1c.6-1.1 2-2.2 4.1-2.2 4.4 0 5.2 2.9 5.2 6.7V36h-4v-9.5c0-2.3 0-5.2-3.2-5.2-3.2 0-3.7 2.5-3.7 5v9.7h-4V20z"
          />
        </svg>
      )
    default:
      return (
        <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden>
          <circle cx="24" cy="24" r="24" fill="#e2e8f0" />
          <path fill="#64748b" d="M24 14v20M14 24h20" strokeWidth="3" />
        </svg>
      )
  }
}

export function sharePlatformShortLabel(id: string, fallback: string): string {
  const map: Record<string, string> = {
    gmail: 'Gmail',
    outlook: 'Outlook',
    'outlook-live': 'Outlook.com',
    mailto: 'Mail app',
    whatsapp: 'WhatsApp',
    telegram: 'Telegram',
    linkedin: 'LinkedIn',
  }
  return map[id] || fallback
}
