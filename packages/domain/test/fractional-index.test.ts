import { describe, expect, test } from "bun:test"
import { keyBetween } from "../src/fractional-index.ts"

describe("keyBetween", () => {
  test("open ends", () => {
    expect(keyBetween(null, null)).toBe("a0")
    expect(keyBetween("a0", null)).toBe("a1")
    expect(keyBetween(null, "a0")).toBe("Zz")
  })

  test("always sorts strictly between", () => {
    let lo = "a0"
    let hi = "a1"
    for (let i = 0; i < 200; i++) {
      const mid = keyBetween(lo, hi)
      expect(lo < mid && mid < hi).toBe(true)
      if (i % 2) lo = mid
      else hi = mid
    }
  })

  test("repeated prepend and append stay ordered", () => {
    const keys = [keyBetween(null, null)]
    for (let i = 0; i < 100; i++) {
      keys.unshift(keyBetween(null, keys[0]!))
      keys.push(keyBetween(keys.at(-1)!, null))
    }
    expect([...keys].sort()).toEqual(keys)
  })
})
