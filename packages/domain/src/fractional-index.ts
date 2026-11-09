/**
 * Fractional indexing: string keys that sort between any two other keys, so a
 * reorder only rewrites one row. Base-62 digits, an integer part whose length
 * is encoded in its head character, then a fraction. Follows the scheme in
 * "Implementing Fractional Indexing" (David Greenspan, Figma).
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const ZERO = "a0"

const intLength = (head: string): number => {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2
  if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2
  throw new Error(`invalid order key head: ${head}`)
}

const intPart = (key: string): string => {
  const len = intLength(key[0]!)
  if (len > key.length) throw new Error(`invalid order key: ${key}`)
  return key.slice(0, len)
}

const validate = (key: string) => {
  if (key === "A" + DIGITS[0]!.repeat(26)) throw new Error(`invalid order key: ${key}`)
  const i = intPart(key)
  if (key.slice(i.length).endsWith(DIGITS[0]!)) throw new Error(`invalid order key: ${key}`)
}

const midpoint = (a: string, b: string | null): string => {
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`)
  if (a.endsWith("0") || (b && b.endsWith("0"))) throw new Error("trailing zero")
  if (b) {
    let n = 0
    while ((a[n] ?? "0") === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const da = a ? DIGITS.indexOf(a[0]!) : 0
  const db = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length
  if (db - da > 1) return DIGITS[Math.round(0.5 * (da + db))]!
  if (b && b.length > 1) return b.slice(0, 1)
  return DIGITS[da]! + midpoint(a.slice(1), null)
}

const incrementInt = (x: string): string | null => {
  const [head, ...digs] = x.split("")
  let carry = true
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]!) + 1
    if (d === DIGITS.length) digs[i] = "0"
    else {
      digs[i] = DIGITS[d]!
      carry = false
    }
  }
  if (carry) {
    if (head === "Z") return "a0"
    if (head === "z") return null
    const h = String.fromCharCode(head!.charCodeAt(0) + 1)
    if (h > "a") digs.push("0")
    else digs.pop()
    return h + digs.join("")
  }
  return head + digs.join("")
}

const decrementInt = (x: string): string | null => {
  const [head, ...digs] = x.split("")
  let borrow = true
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]!) - 1
    if (d === -1) digs[i] = DIGITS[DIGITS.length - 1]!
    else {
      digs[i] = DIGITS[d]!
      borrow = false
    }
  }
  if (borrow) {
    if (head === "a") return "Z" + DIGITS[DIGITS.length - 1]
    if (head === "A") return null
    const h = String.fromCharCode(head!.charCodeAt(0) - 1)
    if (h < "Z") digs.push(DIGITS[DIGITS.length - 1]!)
    else digs.pop()
    return h + digs.join("")
  }
  return head + digs.join("")
}

/** A key that sorts strictly between `a` and `b`. Either side may be null (open end). */
export const keyBetween = (a: string | null, b: string | null): string => {
  if (a !== null) validate(a)
  if (b !== null) validate(b)
  if (a !== null && b !== null && a >= b) throw new Error(`${a} >= ${b}`)
  if (a === null) {
    if (b === null) return ZERO
    const ib = intPart(b)
    const fb = b.slice(ib.length)
    if (ib === "A" + DIGITS[0]!.repeat(26)) return ib + midpoint("", fb)
    if (ib < b) return ib
    const res = decrementInt(ib)
    if (res === null) throw new Error("cannot decrement any more")
    return res
  }
  if (b === null) {
    const ia = intPart(a)
    const fa = a.slice(ia.length)
    const i = incrementInt(ia)
    return i === null ? ia + midpoint(fa, null) : i
  }
  const ia = intPart(a)
  const fa = a.slice(ia.length)
  const ib = intPart(b)
  const fb = b.slice(ib.length)
  if (ia === ib) return ia + midpoint(fa, fb)
  const i = incrementInt(ia)
  if (i === null) throw new Error("cannot increment any more")
  return i < b ? i : ia + midpoint(fa, null)
}
