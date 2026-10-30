import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildScorecardViewModel } from './scorecardViewModel.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
let cachedCss = ''

function loadCss() {
  if (!cachedCss) {
    cachedCss = readFileSync(join(__dirname, 'templates', 'career-scorecard.css'), 'utf8')
  }
  return cachedCss
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function donutSvg(d) {
  return `<svg width="52" height="52" viewBox="0 0 36 36">
    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#f1f5f9" stroke-width="3.5"/>
    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="${esc(d.color)}" stroke-width="3.5" stroke-dasharray="${d.score}, 100" stroke-linecap="round"/>
    <text x="18" y="19" text-anchor="middle" font-size="7" font-weight="800" fill="#0f172a">${d.score}%</text>
  </svg>`
}

function radarGridSvg(axes, radarPoints) {
  const rings = [0.25, 0.5, 0.75, 1]
    .map((lvl) => {
      const r = 75 * lvl
      const pts = axes
        .map((_, i) => {
          const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2
          return `${(110 + r * Math.cos(angle)).toFixed(1)},${(110 + r * Math.sin(angle)).toFixed(1)}`
        })
        .join(' ')
      return `<polygon points="${pts}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`
    })
    .join('')
  const spokes = axes
    .map((axis, i) => {
      const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2
      const x2 = 110 + 75 * Math.cos(angle)
      const y2 = 110 + 75 * Math.sin(angle)
      const lx = 110 + 94 * Math.cos(angle)
      const ly = 110 + 94 * Math.sin(angle)
      return `<g>
        <line x1="110" y1="110" x2="${x2}" y2="${y2}" stroke="#cbd5e1" stroke-width="1"/>
        <text x="${lx}" y="${ly + 3}" text-anchor="middle" font-size="7" font-weight="700" fill="#475569">${esc(axis.label)}</text>
        <text x="${lx}" y="${ly + 10}" text-anchor="middle" font-size="6.5" font-weight="800" fill="#1e40af">(${axis.val}%)</text>
      </g>`
    })
    .join('')
  return `<svg width="200" height="200" viewBox="0 0 220 220">${rings}${spokes}<polygon points="${radarPoints}" fill="rgba(37,99,235,0.18)" stroke="#2563eb" stroke-width="2"/></svg>`
}

/**
 * @param {Parameters<typeof buildScorecardViewModel>[0]} input
 */
export function renderCareerScorecardHtml(input) {
  const vm = buildScorecardViewModel(input)
  const css = loadCss()

  const qaRowsHtml = vm.qaRows
    .map(
      (q) => `<tr>
        <td style="text-align:center"><span class="row-circle">${q.index}</span></td>
        <td><span class="topic-tag">${esc(q.topic)}</span></td>
        <td>${esc(q.question)}</td>
        <td style="text-align:center"><strong>${typeof q.questionScore === 'number' ? `${q.questionScore}%` : `${q.total30 ?? q.total40 ?? '—'}`}</strong></td>
        <td>${esc(q.stars)}</td>
        <td>${esc(q.feedback)}</td>
      </tr>`,
    )
    .join('')

  const skillsHtml = vm.skillPills.length
    ? vm.skillPills.map((s) => `<span class="skill-pill">${esc(s)}</span>`).join('')
    : '<span class="skill-pill" style="opacity:0.7">Skills from profile</span>'

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>HireRight Career Report — ${esc(vm.candidateName)}</title>
<style>${css}</style></head><body>
<div class="dashboard">
  <header class="header">
    <div class="brand-row">
      <div><span class="logo-badge">HireRight</span><div class="brand-sub">AI-Powered Career Intelligence Dashboard</div></div>
    </div>
    <div class="profile-row">
      <div style="display:flex;gap:12px;align-items:center">
        <div class="avatar">${esc(vm.candidateName.charAt(0).toUpperCase())}</div>
        <div class="candidate">
          <h1>${esc(vm.candidateName)}</h1>
          <p>${esc(vm.displayRole)} | ${esc(vm.displayExperience)}</p>
          <p>${esc(vm.roleTitle)}</p>
        </div>
      </div>
      <div class="meta-grid">
        <div><span class="meta-label">Candidate ID:</span> <span class="meta-value">${esc(vm.candidateId)}</span></div>
        <div><span class="meta-label">Resume:</span> <span class="meta-value">PRIVATE</span></div>
        <div><span class="meta-label">Interview Status:</span> <span class="meta-value" style="color:#16a34a">Completed</span></div>
        <div><span class="meta-label">Career Track:</span> <span class="meta-value">${esc(vm.roleTitle)}</span></div>
        <div style="grid-column:span 2"><span class="meta-label">Interview Date:</span> <span class="meta-value">${esc(vm.interviewDate)}</span></div>
      </div>
    </div>
    <div class="skills-ribbon">
      <div><strong>Primary Skills:</strong> ${skillsHtml}</div>
      <div class="industry-badge">Industry Status: ${esc(vm.statusLabel)}</div>
    </div>
  </header>

  <section class="row3">
    <div class="card speedo-wrap">
      <div class="card-title">HireRight Career Score™</div>
      <svg width="180" height="100" viewBox="0 0 200 110">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#e2e8f0" stroke-width="16" stroke-linecap="round"/>
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#g)" stroke-width="16" stroke-dasharray="251.2" stroke-dashoffset="${vm.speedoOffset}" stroke-linecap="round"/>
        <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#ef4444"/><stop offset="40%" stop-color="#f59e0b"/>
          <stop offset="70%" stop-color="#10b981"/><stop offset="100%" stop-color="#059669"/>
        </linearGradient></defs>
        <line x1="100" y1="100" x2="${vm.needleX}" y2="${vm.needleY}" stroke="#1e3a8a" stroke-width="3" stroke-linecap="round"/>
        <circle cx="100" cy="100" r="5" fill="#1e3a8a"/>
      </svg>
      <div class="score-value">${vm.careerScore}</div>
      <div class="score-outof">/ 1000</div>
      <div class="score-badge">${esc(vm.statusLabel)}</div>
      <div class="score-hint">${esc(vm.scoreSubHint)}</div>
    </div>
    <div class="card">
      <div class="card-title">Score Band Explanation</div>
      <div class="band-item"><span class="band-badge" style="background:#166534">850 – 1000</span> Premium Market-Ready Talent</div>
      <div class="band-item"><span class="band-badge" style="background:#15803d">700 – 849</span> Industry Ready</div>
      <div class="band-item"><span class="band-badge" style="background:#d97706">550 – 699</span> Growth Potential</div>
      <div class="band-item"><span class="band-badge" style="background:#dc2626">Below 550</span> Skill Enhancement Recommended</div>
      <p style="font-size:9px;margin-top:8px"><strong>Interpretation:</strong> ${esc(vm.bandInterpretation)}</p>
    </div>
    <div class="card">
      <div class="card-title">Career Health Distribution</div>
      <div class="donut-row">${vm.donuts.map((d) => `<div class="donut-col">${donutSvg(d)}<div class="donut-label">${esc(d.label)}</div><div class="donut-tag" style="color:${esc(d.color)}">${esc(d.tag)}</div></div>`).join('')}</div>
    </div>
  </section>

  <section class="row2">
    <div class="card">
      <div class="card-title">Detailed Career Health Metrics</div>
      ${vm.healthMetrics.map((hm) => `<div class="health-row">
        <span>${esc(hm.label)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${hm.score}%;background:${esc(hm.color)}"></div></div>
        <span>${hm.score}%</span>
        <span style="color:${esc(hm.color)};font-weight:800;font-size:8px">${esc(hm.tag)}</span>
      </div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title">Specialized Interview Pattern Assessment™</div>
      <div class="pattern-stats">
        <div class="pattern-stat"><div class="pattern-num">${vm.sessionStats.durationMinutes}</div><div class="pattern-label">Minutes</div></div>
        <div class="pattern-stat"><div class="pattern-num">${vm.sessionStats.questionCount}</div><div class="pattern-label">Questions</div></div>
        <div class="pattern-stat"><div class="pattern-num">${vm.sessionStats.overallInterviewScore}/100</div><div class="pattern-label">Overall</div></div>
      </div>
      <div class="interview-pill">Interview Type: ${esc(vm.sessionStats.interviewType)}</div>
      ${vm.starPatterns.map((p) => `<div style="font-size:8px;margin-bottom:4px"><strong>${esc(p.name)}</strong> ${esc(p.stars)} — ${esc(p.level)}</div>`).join('')}
    </div>
  </section>

  <section class="card" style="margin-bottom:12px">
    <div class="card-title">Actual Interview Questions &amp; Scoring</div>
    <table class="qa-table"><thead><tr>
      <th>#</th><th>Topic</th><th>Question</th><th>Score</th><th>Performance</th><th>AI Feedback</th>
    </tr></thead><tbody>${qaRowsHtml || '<tr><td colspan="6">No Q&amp;A rows</td></tr>'}</tbody></table>
  </section>

  <section class="row4">
    <div class="card">${radarGridSvg(vm.radarAxes, vm.radarPoints)}<div class="card-title" style="margin-top:6px">Skill Strength Radar</div></div>
    <div class="card">
      <div class="card-title">Career Growth Potential</div>
      ${vm.careerPaths.map((g) => `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:9px;font-weight:700"><span>${esc(g.role)}</span><span>${g.match}%</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${g.match}%;background:#2563eb"></div></div></div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title">Market-Based Improvement Priorities</div>
      ${vm.priorities.map((p) => `<div class="priority-item"><span class="priority-num">${p.num}</span><div><strong>${esc(p.title)}</strong><div style="font-size:8px">${esc(p.text)}</div></div></div>`).join('')}
    </div>
  </section>

  <section class="row2">
    <div class="card">
      <div class="card-title">Resume Positioning Intelligence™</div>
      <div class="pos-grid">${vm.positioningItems.map((t) => `<div class="pos-box">${esc(t)}</div>`).join('')}</div>
      <p style="font-size:8px;background:#f1f5f9;padding:6px;border-radius:6px">${esc(vm.positioningFooter)}</p>
    </div>
    <div class="card">
      <div class="card-title">Industry Alignment</div>
      <p style="font-size:9px;font-weight:700;color:#166534">${vm.industryAlignment}% — ${esc(vm.industryAlignmentCaption)}</p>
      <div class="card-title" style="margin-top:8px">Top Strengths</div>
      <ul class="strengths">${(vm.strengths.length ? vm.strengths : ['Complete interview for strengths']).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="card-title">Growth Areas</div>
      <ul class="strengths">${(vm.improvements.length ? vm.improvements : ['Practice structured answers']).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>
  </section>

  <section class="card coach-box">
    <div class="card-title">Career Coach Notes™</div>
    <p style="margin:0">${esc(vm.coachNotes)}</p>
  </section>

  <div class="footer-banner">Final Career Status: ${esc(vm.statusLabel)}</div>
  <p style="font-size:9px;font-weight:700;margin-top:8px">Recommended for:</p>
  <div class="role-tags">${vm.recommendedRoles.map((r) => `<span class="role-tag">${esc(r)}</span>`).join('')}</div>
  <p style="font-size:9px;margin-top:8px"><strong>Next growth step:</strong> ${esc(vm.nextRecommendedStep)}</p>
</div></body></html>`
}
