import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SiteFooter } from '../components/SiteFooter'
import { INVITE_ERROR_KEY } from '../lib/pendingJobApply'
import { HomePage } from './HomePage'
import { SolutionsPage } from './SolutionsPage'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size
    },
  }
}

const html = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el))

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
})
afterEach(() => vi.unstubAllGlobals())

describe('SolutionsPage (for hiring teams)', () => {
  it('sends organisation CTAs to organisation sign-up, not the candidate sign-up', () => {
    const page = html(createElement(SolutionsPage))
    const out = page.slice(page.indexOf('<main'), page.indexOf('</main>'))
    expect(out).not.toMatch(/href="\/signup"/)
    // 4 solution cards + the closing "Get Started Free" button
    expect(out.match(/href="\/organizations\/signup"/g)?.length).toBe(5)
  })

  it('gives each "Explore Solution" link a distinct accessible name', () => {
    const out = html(createElement(SolutionsPage))
    const labels = [...out.matchAll(/aria-label="(Explore solution: [^"]+)"/g)].map((m) => m[1])
    expect(labels).toHaveLength(4)
    expect(new Set(labels).size).toBe(4)
  })

  it('has no focusable button that does nothing in the decorative studio mock-up', () => {
    const out = html(createElement(SolutionsPage))
    expect(out).not.toContain('Microphone active')
  })
})

describe('HomePage hero', () => {
  it('autoplays the background video by default', () => {
    const out = html(createElement(HomePage))
    expect(out).toMatch(/<video[^>]*autoplay/i)
  })

  it('does not autoplay or preload the background video when reduced motion is requested', () => {
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q.includes('reduce') }),
    })
    const out = html(createElement(HomePage))
    const video = out.match(/<video[^>]*>/i)?.[0] ?? ''
    expect(video).not.toMatch(/autoplay/i)
    expect(video).toContain('preload="none"')
    expect(out).toContain('aria-label="Play background motion"')
  })

  it('keeps a single primary CTA in the hero and only safe external links', () => {
    const out = html(createElement(HomePage))
    const hero = out.slice(out.indexOf('id="hero-title"'), out.indexOf('id="journey"'))
    expect(hero.match(/start the conversation/g)).toHaveLength(1)
    for (const m of out.matchAll(/<a [^>]*target="_blank"[^>]*>/g)) expect(m[0]).toMatch(/rel="[^"]*noopener/)
  })
})

describe('SiteFooter social links', () => {
  it('does not link to generic social home pages (no real HireRighttt profiles yet)', () => {
    const out = html(createElement(SiteFooter))
    expect(out).not.toMatch(/href="https:\/\/(www\.)?(linkedin|instagram|facebook)\.com\/?"/)
    for (const m of out.matchAll(/<a [^>]*target="_blank"[^>]*>/g)) expect(m[0]).toMatch(/rel="[^"]*noopener/)
  })

  it('home page still shows the job-link notice above the hero', () => {
    sessionStorage.setItem(INVITE_ERROR_KEY, 'Job link not found or expired.')
    const out = html(createElement(HomePage))
    const main = out.slice(out.indexOf('<main'))
    expect(main.indexOf('Job link not found or expired.')).toBeGreaterThan(-1)
    expect(main.indexOf('Job link not found or expired.')).toBeLessThan(main.indexOf('id="hero-title"'))
  })
})
