import { promises as fs } from "fs"
import path from "path"
import { z } from "zod"
import { assertExternalDirectory, runRg } from "./shared"
import type { ToolContext, ToolDefinition, ToolResult } from "./types"

import DESCRIPTION from "./glob.txt"


const LIMIT = 100

const args = {
  pattern: z.string().describe("The glob pattern to match files against"),
  path: z
    .string()
    .optional()
    .describe(
      `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
    ),
}

const paramsSchema = z.object(args)
type Params = z.infer<typeof paramsSchema>

const execute = async (params: Params, ctx: ToolContext): Promise<ToolResult> => {
  await ctx.ask({
    permission: "glob",
    patterns: [params.pattern],
    always: ["*"],
    metadata: {
      pattern: params.pattern,
      path: params.path,
    },
  })

  const search = path.isAbsolute(params.path ?? "") ? (params.path ?? "") : path.resolve(ctx.directory, params.path ?? ".")
  let info
  try {
    info = await fs.stat(search)
  } catch {
    info = undefined
  }
  if (info?.isFile()) throw new Error(`glob path must be a directory: ${search}`)
  await assertExternalDirectory(ctx, search, "directory")

  const result = await runRg(["--no-config", "--files", `--glob=${params.pattern}`, "--glob=!**/.git/**", "."], search, ctx.abort)
  if (result.code === 2) {
    throw new Error(result.stderr.trim() || `ripgrep failed with code ${result.code}`)
  }
  if (result.code !== 0 && result.code !== 1) {
    throw new Error(result.stderr.trim() || `ripgrep failed with code ${result.code}`)
  }

  const files: string[] = []
  for (const line of result.stdout.split("\n")) {
    if (line.length === 0) continue
    const relative = line
      .replace(/^(?:[.\\/])+/, "")
      .replace(/^[\\/]+/, "")
      .replaceAll("\\", "/")
    files.push(path.resolve(search, relative))
    if (files.length >= LIMIT + 1) break
  }

  const truncated = files.length === LIMIT
  const output: string[] = []
  if (files.length === 0) output.push("No files found")
  if (files.length > 0) {
    output.push(...files.slice(0, LIMIT))
    if (truncated) {
      output.push("")
      output.push(`(Results are truncated: showing first ${LIMIT} results. Consider using a more specific path or pattern.)`)
    }
  }

  return {
    title: path.relative(ctx.worktree, search),
    metadata: { count: files.length, truncated },
    output: output.join("\n"),
  }
}

export const globTool: ToolDefinition = {
  description: DESCRIPTION,
  args,
  execute,
}
