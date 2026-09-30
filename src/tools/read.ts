import { promises as fs, createReadStream } from "fs"
import path from "path"
import { z } from "zod"
import { assertExternalDirectory } from "./shared"
import type { ToolContext, ToolDefinition } from "./types"

import DESCRIPTION from "./read.txt"


const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
const MAX_BYTES = 50 * 1024
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`
const SAMPLE_BYTES = 4096
const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

const args = {
  filePath: z.string().describe("The absolute path to the file or directory to read"),
  offset: z.number().int().nonnegative().optional().describe("The line number to start reading from (1-indexed)"),
  limit: z.number().int().nonnegative().optional().describe("The maximum number of lines to read (defaults to 2000)"),
}

const paramsSchema = z.object(args)
type Params = z.infer<typeof paramsSchema>

const BINARY_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".class", ".jar", ".war", ".7z",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
  ".bin", ".dat", ".obj", ".o", ".a", ".lib", ".wasm", ".pyc", ".pyo",
])

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
}

function sniffMime(bytes: Uint8Array, filepath: string): string {
  const at = (offset: number, prefix: number[]) => prefix.every((value, index) => bytes[offset + index] === value)
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (at(0, [0x42, 0x4d])) return "image/bmp"
  if (at(0, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp"
  return MIME_BY_EXTENSION[path.extname(filepath).toLowerCase()] ?? "application/octet-stream"
}

function isBinaryFile(filepath: string, bytes: Uint8Array): boolean {
  if (BINARY_EXTENSIONS.has(path.extname(filepath).toLowerCase())) return true
  if (bytes.length === 0) return false
  let nonPrintable = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) nonPrintable++
  }
  return nonPrintable / bytes.length > 0.3
}

async function miss(ctx: ToolContext, filepath: string): Promise<never> {
  const dir = path.dirname(filepath)
  const base = path.basename(filepath)
  let items: string[] = []
  try {
    items = (await fs.readdir(dir))
      .filter(
        (item) =>
          item.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(item.toLowerCase()),
      )
      .slice(0, 3)
  } catch {
    items = []
  }
  if (items.length > 0) {
    throw new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${items.map((item) => path.join(dir, item)).join("\n")}`)
  }
  throw new Error(`File not found: ${filepath}`)
}

async function listDirectory(filepath: string): Promise<string[]> {
  const items = await fs.readdir(filepath, { withFileTypes: true })
  const names: string[] = []
  for (const item of items) {
    if (item.isDirectory()) {
      names.push(item.name + "/")
      continue
    }
    if (item.isSymbolicLink()) {
      try {
        const stat = await fs.stat(path.join(filepath, item.name))
        if (stat.isDirectory()) {
          names.push(item.name + "/")
          continue
        }
      } catch {
        // broken symlink: keep plain name
      }
    }
    names.push(item.name)
  }
  return names.sort((a, b) => a.localeCompare(b))
}

async function readLines(
  filepath: string,
  opts: { limit: number; offset: number },
): Promise<{ raw: string[]; count: number; cut: boolean; more: boolean; offset: number }> {
  const start = opts.offset - 1
  const raw: string[] = []
  const flags = { bytes: 0, count: 0, cut: false, more: false, done: false }
  const decoder = new TextDecoder("utf-8")
  const stream = createReadStream(filepath)
  const emitLine = (line: string) => {
    if (flags.done) return
    flags.count += 1
    if (flags.count <= start) return
    if (raw.length >= opts.limit) {
      flags.more = true
      return
    }
    const out = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : line
    const size = Buffer.byteLength(out, "utf-8") + (raw.length > 0 ? 1 : 0)
    if (flags.bytes + size <= MAX_BYTES) {
      raw.push(out)
      flags.bytes += size
      return
    }
    flags.cut = true
    flags.more = true
    flags.done = true
  }
  let pending = ""
  for await (const chunk of stream) {
    const text = pending + decoder.decode(chunk, { stream: true })
    let newline = 0
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "\n") continue
      emitLine(text.slice(newline, i))
      newline = i + 1
      if (flags.done) break
    }
    pending = flags.done ? "" : text.slice(newline)
    if (flags.done) break
  }
  if (!flags.done && pending !== "") emitLine(pending)
  stream.close()
  return { raw, count: flags.count, cut: flags.cut, more: flags.more, offset: opts.offset }
}

const execute = async (params: Params, ctx: ToolContext) => {
  let filepath = params.filePath
  if (!path.isAbsolute(filepath)) filepath = path.resolve(ctx.directory, filepath)
  const title = path.relative(ctx.worktree, filepath)

  let stat
  try {
    stat = await fs.stat(filepath)
  } catch {
    stat = undefined
  }

  await assertExternalDirectory(ctx, filepath, stat?.isDirectory() ? "directory" : "file")

  await ctx.ask({
    permission: "read",
    patterns: [path.relative(ctx.worktree, filepath)],
    always: ["*"],
    metadata: {},
  })

  if (!stat) return await miss(ctx, filepath)

  if (stat.isDirectory()) {
    const items = await listDirectory(filepath)
    const limit = params.limit ?? DEFAULT_READ_LIMIT
    const offset = params.offset || 1
    const start = offset - 1
    const sliced = items.slice(start, start + limit)
    const truncated = start + sliced.length < items.length
    return {
      title,
      output: [
        `<path>${filepath}</path>`,
        `<type>directory</type>`,
        `<entries>`,
        sliced.join("\n"),
        truncated
          ? `\n(Showing ${sliced.length} of ${items.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
          : `\n(${items.length} entries)`,
        `</entries>`,
      ].join("\n"),
      metadata: {
        preview: sliced.slice(0, 20).join("\n"),
        truncated,
        loaded: [] as string[],
      },
    }
  }

  const sample = Buffer.alloc(Math.min(SAMPLE_BYTES, stat.size))
  if (stat.size > 0) {
    const handle = await fs.open(filepath, "r")
    try {
      await handle.read(sample, 0, sample.length, 0)
    } finally {
      await handle.close()
    }
  }

  const mime = sniffMime(new Uint8Array(sample), filepath)
  if (SUPPORTED_IMAGE_MIMES.has(mime) || mime === "application/pdf") {
    const bytes = await fs.readFile(filepath)
    const message = mime === "application/pdf" ? "PDF read successfully" : "Image read successfully"
    return {
      title,
      output: message,
      metadata: { preview: message, truncated: false, loaded: [] as string[] },
      attachments: [{ type: "file" as const, mime, url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` }],
    }
  }

  if (isBinaryFile(filepath, new Uint8Array(sample))) {
    throw new Error(`Cannot read binary file: ${filepath}`)
  }

  const file = await readLines(filepath, { limit: params.limit ?? DEFAULT_READ_LIMIT, offset: params.offset || 1 })
  if (file.count < file.offset && !(file.count === 0 && file.offset === 1)) {
    throw new Error(`Offset ${file.offset} is out of range for this file (${file.count} lines)`)
  }

  let output = [`<path>${filepath}</path>`, `<type>file</type>`, "<content>\n"].join("\n")
  output += file.raw.map((line, i) => `${i + file.offset}: ${line}`).join("\n")

  const last = file.offset + file.raw.length - 1
  const next = last + 1
  if (file.cut) {
    output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${file.offset}-${last}. Use offset=${next} to continue.)`
  } else if (file.more) {
    output += `\n\n(Showing lines ${file.offset}-${last} of ${file.count}. Use offset=${next} to continue.)`
  } else {
    output += `\n\n(End of file - total ${file.count} lines)`
  }
  output += "\n</content>"

  return {
    title,
    output,
    metadata: {
      preview: file.raw.slice(0, 20).join("\n"),
      truncated: file.more || file.cut,
      loaded: [] as string[],
    },
  }
}

export const readTool: ToolDefinition = {
  description: DESCRIPTION,
  args,
  execute,
}
