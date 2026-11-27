import { describe, expect, it } from 'vitest'
import { planPdfPages } from './printScorecard'

describe('planPdfPages', () => {
  it('breaks three blocks that overflow one page on a block boundary', () => {
    // 40 + 40 fit. The third block fits on a fresh page and does not fit in the remainder,
    // so the break is between blocks, not through one.
    expect(planPdfPages([40, 40, 40], 100)).toEqual([
      [0, 1],
      [2],
    ])
  })

  it('does not share a tall block continuation page with the next block', () => {
    // 150 needs two pages (100 + 50). 30 would fit in the leftover 50, and must still start after the slice.
    const pages = planPdfPages([40, 150, 30], 100)
    expect(pages).toEqual([[0], [1], [1], [2]])
    for (const page of pages) {
      if (page.includes(1)) expect(page).not.toContain(2)
    }
  })

  it('preserves block order', () => {
    const pages = planPdfPages([20, 30, 60, 200, 15], 100)
    const flat = pages.flat()
    expect(flat).toEqual([...flat].sort((a, b) => a - b))
    const order: number[] = []
    for (const index of flat) {
      if (order[order.length - 1] !== index) order.push(index)
    }
    expect(order).toEqual([0, 1, 2, 3, 4])
    expect(pages).toEqual([[0, 1], [2], [3], [3], [4]])
  })
})
