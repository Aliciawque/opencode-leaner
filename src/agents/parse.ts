export type AgentValue = string | number | boolean | null | { [key: string]: AgentValue }

export type AgentDef = {
  prompt: string
  [key: string]: unknown
}

const KNOWN_FRONTMATTER_FIELDS = new Set([
  "model",
  "variant",
  "description",
  "mode",
  "hidden",
  "color",
  "steps",
  "options",
  "permission",
  "disable",
  "temperature",
  "top_p",
])

export function parseAgent(source: string, fallbackName: string): { name: string; def: AgentDef } {
  const { data, body } = splitFrontmatter(source)
  const def: AgentDef = { prompt: body.trim() }
  let name = fallbackName
  for (const [key, value] of Object.entries(data)) {
    if (key === "name") {
      if (typeof value === "string" && value) name = value
      continue
    }
    if (KNOWN_FRONTMATTER_FIELDS.has(key)) {
      def[key] = value
    } else {
      def.options = { ...(def.options as Record<string, unknown> | undefined), [key]: value }
    }
  }
  return { name, def }
}

function splitFrontmatter(source: string): { data: Record<string, AgentValue>; body: string } {
  const match = source.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!match) throw new Error("agent file is missing YAML frontmatter")
  const [data] = parseBlock(match[1].split(/\r?\n/), 0, 0)
  return { data: data as Record<string, AgentValue>, body: source.slice(match[0].length) }
}

function parseBlock(lines: string[], start: number, indent: number): [AgentValue, number] {
  const out: Record<string, AgentValue> = {}
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }
    const ind = indentOf(line)
    if (ind < indent) break
    if (ind > indent) throw new Error(`unexpected indentation in agent frontmatter: ${JSON.stringify(line)}`)
    const m = line.trim().match(/^("([^"]*)"|'([^']*)'|([^:\s]+))\s*:(.*)$/)
    if (!m) throw new Error(`invalid line in agent frontmatter: ${JSON.stringify(line)}`)
    const key = m[2] ?? m[3] ?? m[4]
    const rest = (m[5] ?? "").trim()
    if (rest === "") {
      let k = i + 1
      while (k < lines.length && isBlank(lines[k])) k++
      if (k < lines.length && indentOf(lines[k]) > indent) {
        const [value, next] = parseBlock(lines, k, indentOf(lines[k]))
        out[key] = value
        i = next
      } else {
        out[key] = null
        i = k
      }
    } else {
      out[key] = parseScalar(rest)
      i++
    }
  }
  return [out, i]
}

function isBlank(line: string): boolean {
  const t = line.trim()
  return t === "" || t.startsWith("#")
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function parseScalar(raw: string): AgentValue {
  if (raw === "true") return true
  if (raw === "false") return false
  if (raw === "null") return null
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  if (/^(?:'[^']*'|"[^"]*")$/.test(raw)) return raw.slice(1, -1)
  return raw
}
