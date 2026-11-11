import { describe, expect, test } from "bun:test"
import { decodeEntities, type MdNode, parseMarkdown, safeUrl, splitReferences } from "../src/lib/markdown.ts"

const repo = { owner: "acme", repo: "web" }
const el = (tag: string, children: Array<MdNode> = [], attrs: Record<string, string | boolean> = {}) => ({ tag, attrs, children })

describe("parseMarkdown", () => {
  test("paragraphs, emphasis and GitHub's line breaks", () => {
    expect(parseMarkdown("Hello **bold** _it_\nnext")).toEqual([
      el("p", ["Hello ", el("strong", ["bold"]), " ", el("em", ["it"]), el("br"), "next"])
    ])
  })

  test("code is kept as written, without references or entity decoding", () => {
    expect(parseMarkdown("`#1 &amp;`\n\n```ts\nTES-1 #2\n```", repo)).toEqual([
      el("p", [el("code", ["#1 &amp;"])]),
      el("pre", ["TES-1 #2"])
    ])
  })

  test("task lists", () => {
    expect(parseMarkdown("- [x] done\n- todo")).toEqual([
      el("ul", [
        el("li", [el("input", [], { type: "checkbox", checked: true, disabled: true }), "done"], { task: true }),
        el("li", ["todo"])
      ])
    ])
  })

  test("ordered lists keep their start", () => {
    expect(parseMarkdown("3. c")).toEqual([el("ol", [el("li", ["c"])], { start: "3" })])
  })

  test("tables", () => {
    expect(parseMarkdown("| a | b |\n|:-|-:|\n| 1 | 2 |")).toEqual([
      el("table", [
        el("thead", [el("tr", [el("th", ["a"], { align: "left" }), el("th", ["b"], { align: "right" })])]),
        el("tbody", [el("tr", [el("td", ["1"], { align: "left" }), el("td", ["2"], { align: "right" })])])
      ])
    ])
  })

  test("HTML blocks wrap the markdown between them", () => {
    const tree = parseMarkdown("<details>\n<summary>Logs</summary>\n\n**hi**\n\n</details>\n\nafter")
    expect(tree).toEqual([
      el("details", [el("summary", ["Logs"]), el("p", [el("strong", ["hi"])])]),
      el("p", ["after"])
    ])
  })

  test("inline HTML", () => {
    expect(parseMarkdown("press <kbd>K</kbd><br>now")).toEqual([el("p", ["press ", el("kbd", ["K"]), el("br"), "now"])])
  })

  test("comments, scripts and unknown tags are dropped, keeping safe text", () => {
    expect(parseMarkdown("<!-- template -->\na <script>alert(1)</script><font color=red>b</font> <span onclick=x>c</span>")).toEqual([
      el("p", ["a b ", el("span", ["c"])])
    ])
  })

  test("unsafe URLs are dropped", () => {
    expect(parseMarkdown("[x](javascript:alert(1)) <a href=\"javascript:y\">y</a> ![i](data:image/png;base64,AA)")).toEqual([
      el("p", ["x y i"])
    ])
    expect(parseMarkdown("<img src=\"https://x.test/a.png\" width=20 onerror=\"x\">")).toEqual([
      el("img", [], { src: "https://x.test/a.png", width: "20" })
    ])
  })

  test("links open as links; text inside them is not scanned for references", () => {
    expect(parseMarkdown("[see #4](https://example.com)", repo)).toEqual([
      el("p", [el("a", ["see #4"], { href: "https://example.com" })])
    ])
  })

  test("references in text", () => {
    expect(parseMarkdown("Fixes #12, see other/lib#3 and TES-4.", repo)).toEqual([
      el("p", [
        "Fixes ",
        { ref: { kind: "github", owner: "acme", repo: "web", number: 12 }, text: "#12" },
        ", see ",
        { ref: { kind: "github", owner: "other", repo: "lib", number: 3 }, text: "other/lib#3" },
        " and ",
        { ref: { kind: "identifier", key: "TES", number: 4 }, text: "TES-4" },
        "."
      ])
    ])
  })

  test("a bare GitHub issue or pull request URL becomes a reference", () => {
    expect(parseMarkdown("https://github.com/acme/web/pull/7 https://github.com/o/r/issues/2", repo)).toEqual([
      el("p", [
        { ref: { kind: "github", owner: "acme", repo: "web", number: 7 }, text: "#7" },
        " ",
        { ref: { kind: "github", owner: "o", repo: "r", number: 2 }, text: "o/r#2" }
      ])
    ])
  })

  test("entities in text", () => {
    expect(parseMarkdown("a &amp; b &#x2192; c")).toEqual([el("p", ["a & b → c"])])
  })
})

describe("splitReferences", () => {
  test("#12 needs a repository", () => {
    expect(splitReferences("see #12", null)).toEqual(["see #12"])
  })

  test("ignores anchors, C# and words that only look like references", () => {
    expect(splitReferences("page#12 C#3 foo-TES-1 TES-1x", repo)).toEqual(["page#12 C#3 foo-TES-1 TES-1x"])
  })
})

describe("helpers", () => {
  test("safeUrl", () => {
    expect(safeUrl(" https://a.test ")).toBe("https://a.test")
    expect(safeUrl("mailto:a@b.test")).toBe("mailto:a@b.test")
    expect(safeUrl("JavaScript:alert(1)")).toBeNull()
    expect(safeUrl("/relative")).toBeNull()
  })

  test("decodeEntities leaves unknown ones alone", () => {
    expect(decodeEntities("&lt;b&gt; &bogus; &#0;")).toBe("<b> &bogus; &#0;")
  })
})
