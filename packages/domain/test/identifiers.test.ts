import { describe, expect, test } from "bun:test"
import { identifier, isValidProjectKey, parseIdentifier, projectKeyFor } from "../src/index.ts"

describe("project keys and identifiers", () => {
  test("keys are the first three letters of the name", () => {
    expect(projectKeyFor("test", [])).toBe("TES")
    expect(projectKeyFor("Issue project", [])).toBe("ISS")
    expect(projectKeyFor("rune-browser", [])).toBe("RUN")
    expect(projectKeyFor("2048 game", [])).toBe("GAM")
    expect(projectKeyFor("Ünïcode", [])).toBe("UNI")
    expect(projectKeyFor("x", [])).toBe("PRJ")
  })

  test("a taken key gets a digit", () => {
    expect(projectKeyFor("Issues", ["ISS"])).toBe("IS2")
    expect(projectKeyFor("Issues", ["iss", "IS2"])).toBe("IS3")
    expect(projectKeyFor("Grand", ["GRA"])).toBe("GR2")
  })

  test("identifiers use the project key, else the team key", () => {
    expect(identifier({ key: "GRD" }, { number: 12 }, { key: "TES" })).toBe("TES-12")
    expect(identifier({ key: "GRD" }, { number: 12 }, null)).toBe("GRD-12")
    expect(identifier({ key: "GRD" }, { number: 0 }, { key: "TES" })).toBe("TES-…")
    expect(parseIdentifier("tes-12")).toEqual({ key: "TES", number: 12 })
    expect(parseIdentifier("IS2-4")).toEqual({ key: "IS2", number: 4 })
    expect(parseIdentifier("not an id")).toBeNull()
  })

  test("valid keys", () => {
    expect(["TES", "IS2", "AB", "WEBUI"].every(isValidProjectKey)).toBe(true)
    expect(["T", "tes", "2AB", "TOOLONG", "A-B"].some(isValidProjectKey)).toBe(false)
  })
})
