import { promises as fs } from "fs"
import path from "path"
import { z } from "zod"
import { createTwoFilesPatch } from "diff"
import { assertExternalDirectory, joinBom, splitBom } from "./shared"
import { trimDiff } from "./edit"
import type { ToolContext, ToolDefinition, ToolResult } from "./types"

import DESCRIPTION from "./write.txt"


const args = {
  content: z.string().describe("The content to write to the file"),
  filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
}

const paramsSchema = z.object(args)
type Params = z.infer<typeof paramsSchema>

async function readExisting(filepath: string): Promise<{ exists: boolean; bom: boolean; text: string }> {
  try {
    const stat = await fs.stat(filepath)
    if (!stat.isFile()) return { exists: false, bom: false, text: "" }
    const bytes = await fs.readFile(filepath)
    const split = splitBom(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes))
    return { exists: true, bom: split.bom, text: split.text }
  } catch {
    return { exists: false, bom: false, text: "" }
  }
}

async function writeWithDirs(filepath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true })
  await fs.writeFile(filepath, content, "utf8")
}

const execute = async (params: Params, ctx: ToolContext): Promise<ToolResult> => {
  const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(ctx.directory, params.filePath)
  await assertExternalDirectory(ctx, filepath)

  const source = await readExisting(filepath)
  const next = splitBom(params.content)
  const desiredBom = source.bom || next.bom
  const contentNew = next.text
  const exists = source.exists

  const diff = trimDiff(createTwoFilesPatch(filepath, filepath, source.text, contentNew))
  await ctx.ask({
    permission: "edit",
    patterns: [path.relative(ctx.worktree, filepath)],
    always: ["*"],
    metadata: {
      filepath,
      diff,
    },
  })

  await writeWithDirs(filepath, joinBom(contentNew, desiredBom))

  return {
    title: path.relative(ctx.worktree, filepath),
    metadata: {
      diagnostics: {},
      filepath,
      exists,
    },
    output: "Wrote file successfully.",
  }
}

export const writeTool: ToolDefinition = {
  description: DESCRIPTION,
  args,
  execute,
}
