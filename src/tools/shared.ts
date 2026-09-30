import { spawn } from "child_process"
import path from "path"
import type { ToolContext } from "./types"

const BOM = "\uFEFF"

export function splitBom(text: string): { bom: boolean; text: string } {
  if (text.charCodeAt(0) !== 0xfeff) return { bom: false, text }
  return { bom: true, text: text.slice(1) }
}

export function joinBom(text: string, bom: boolean): string {
  const stripped = splitBom(text).text
  if (!bom) return stripped
  return BOM + stripped
}

export function containsPath(root: string, file: string): boolean {
  if (file === root) return true
  const sep = process.platform === "win32" ? /[\\/]/ : /[/]/
  const normalized = file.split(sep).join("/")
  const base = (root.endsWith("/") ? root : root + "/").split(sep).join("/")
  if (process.platform === "win32") return normalized.toLowerCase().startsWith(base.toLowerCase())
  return normalized.startsWith(base)
}

export function insideProject(ctx: ToolContext, file: string): boolean {
  if (containsPath(ctx.directory, file)) return true
  if (ctx.worktree === "/") return false
  return containsPath(ctx.worktree, file)
}

export async function assertExternalDirectory(
  ctx: ToolContext,
  target: string,
  kind: "file" | "directory" = "file",
): Promise<void> {
  if (insideProject(ctx, target)) return
  const dir = kind === "directory" ? target : path.dirname(target)
  const glob = path.join(dir, "*").split(path.sep).join("/")
  await ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: { filepath: target, parentDir: dir },
  })
}

export function runRg(
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("rg", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk))
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk))
    const onAbort = () => {
      if (!child.killed) child.kill("SIGTERM")
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener("abort", onAbort, { once: true })
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort)
      reject(error)
    })
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}
