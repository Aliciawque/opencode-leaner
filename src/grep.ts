import { promises as fs } from "fs"
import path from "path"
import { z } from "zod"
import { assertExternalDirectory, runRg } from "./shared"
import type { ToolContext, ToolDefinition, ToolResult } from "./types"

import DESCRIPTION from "./grep.txt"


const LIMIT = 100
const MAX_RECORD_BYTES = 64 * 1024
const MAX_LINE_CHARS = 2000

const args = {
  pattern: z.string().describe("The regex pattern to search for in file contents"),
  path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
  include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
}

const paramsSchema = z.object(args)
type Params = z.infer<typeof paramsSchema>

type Match = {
  path: string
  line: number
  text: string
}

const execute = async (params: Params, ctx: ToolContext): Promise<ToolResult> => {
  if (!params.pattern) throw new Error("pattern is required")

  await ctx.ask({
    permission: "grep",
    patterns: [params.pattern],
    always: ["*"],
    metadata: {
      pattern: params.pattern,
      path: params.path,
      include: params.include,
    },
  })

  const requested = path.isAbsolute(params.path ?? ctx.directory)
    ? (params.path ?? ctx.directory)
    : path.join(ctx.directory, params.path ?? ".")
  let requestedInfo
  try {
    requestedInfo = await fs.stat(requested)
  } catch {
    requestedInfo = undefined
  }
  await assertExternalDirectory(ctx, requested, requestedInfo?.isDirectory() ? "directory" : "file")

  const search = path.resolve(requested)
  let info
  try {
    info = await fs.stat(search)
  } catch {
    info = undefined
  }
  const cwd = info?.isDirectory() ? search : path.dirname(search)

  const rgArgs = [
    "--no-config",
    "--json",
    "--hidden",
    "--no-messages",
    ...(params.include ? [`--glob=${params.include}`] : []),
    "--glob=!**/.git/**",
    "--",
    params.pattern,
    info?.isDirectory() ? "." : path.basename(search),
  ]

  const result = await runRg(rgArgs, cwd, ctx.abort)
  const stderr = result.stderr
  if (result.code === 2 && (stderr.includes("regex parse error") || stderr.includes("error parsing regex"))) {
    throw new Error(stderr.trim())
  }
  if (result.code !== 0 && result.code !== 1) {
    throw new Error(stderr.trim() || `ripgrep failed with code ${result.code}`)
  }
  if (result.code === 1) {
    return {
      title: params.pattern,
      metadata: { matches: 0, truncated: false },
      output: "No files found",
    }
  }

  const rows: Match[] = []
  for (const line of result.stdout.split("\n")) {
    if (line.length === 0) continue
    if (Buffer.byteLength(line, "utf8") > MAX_RECORD_BYTES) {
      throw new Error(`Ripgrep JSON record exceeded ${MAX_RECORD_BYTES} bytes`)
    }
    let json
    try {
      json = JSON.parse(line) as any
    } catch {
      throw new Error("Invalid ripgrep JSON output")
    }
    if (!json || typeof json !== "object" || json.type !== "match") continue
    const data = json.data
    const relative = String(data.path?.text ?? "")
      .replace(/^(?:[.\\/])+/, "")
      .replace(/^[\\/]+/, "")
      .replaceAll("\\", "/")
    const base = requestedInfo?.isDirectory() ? requested : path.dirname(requested)
    rows.push({
      path: path.resolve(base, relative),
      line: Number(data.line_number ?? 0),
      text: String(data.lines?.text ?? "").slice(0, MAX_LINE_CHARS),
    })
    if (rows.length > LIMIT) break
  }

  if (rows.length === 0) {
    return {
      title: params.pattern,
      metadata: { matches: 0, truncated: false },
      output: "No files found",
    }
  }

  const truncated = rows.length === LIMIT
  const total = rows.length
  const hasMore = truncated
  const output: string[] = [`Found ${total} matches${hasMore ? " (more matches available)" : ""}`]

  let current = ""
  for (const match of rows) {
    if (current !== match.path) {
      if (current !== "") output.push("")
      current = match.path
      output.push(`${match.path}:`)
    }
    output.push(`  Line ${match.line}: ${match.text}`)
  }

  if (truncated) {
    output.push("")
    output.push("(Results truncated. Consider using a more specific path or pattern.)")
  }

  return {
    title: params.pattern,
    output: output.join("\n"),
    metadata: { matches: total, truncated },
  }
}

export const grepTool: ToolDefinition = {
  description: DESCRIPTION,
  args,
  execute,
}
