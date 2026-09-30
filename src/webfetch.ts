import { z } from "zod"
import { Parser } from "htmlparser2"
import TurndownService from "turndown"
import type { ToolContext, ToolDefinition, ToolResult } from "./types"

import DESCRIPTION from "./webfetch.txt"


const MAX_RESPONSE_SIZE = 5 * 1024 * 1024
const DEFAULT_TIMEOUT = 30 * 1000
const MAX_TIMEOUT = 120 * 1000

const args = {
  url: z.string().describe("The URL to fetch content from"),
  format: z.enum(["text", "markdown", "html"]).default("markdown").describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
  timeout: z.number().optional().describe("Optional timeout in seconds (max 120)"),
}

const paramsSchema = z.object(args)
type Params = z.infer<typeof paramsSchema>

function isImageAttachment(mime: string): boolean {
  return mime.startsWith("image/") && mime !== "image/svg+xml"
}

function extractTextFromHTML(html: string): string {
  let text = ""
  let skipDepth = 0

  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) {
        skipDepth++
      }
    },
    ontext(input) {
      if (skipDepth === 0) text += input
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--
    },
  })

  parser.write(html)
  parser.end()

  return text.trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}

async function fetchWithRetry(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, { headers, signal })
  if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
    return fetch(url, { headers: { ...headers, "User-Agent": "opencode" }, signal })
  }
  return response
}

const execute = async (params: Params, ctx: ToolContext): Promise<ToolResult> => {
  if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
    throw new Error("URL must start with http:// or https://")
  }

  await ctx.ask({
    permission: "webfetch",
    patterns: [params.url],
    always: ["*"],
    metadata: {
      url: params.url,
      format: params.format,
      timeout: params.timeout,
    },
  })

  const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

  let acceptHeader = "*/*"
  switch (params.format) {
    case "markdown":
      acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
      break
    case "text":
      acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
      break
    case "html":
      acceptHeader = "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
      break
  }
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    Accept: acceptHeader,
    "Accept-Language": "en-US,en;q=0.9",
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeout)
  const onAbort = () => controller.abort(ctx.abort.reason ?? new Error("aborted"))
  ctx.abort.addEventListener("abort", onAbort, { once: true })
  let response: Response
  try {
    response = await fetchWithRetry(params.url, headers, controller.signal)
  } finally {
    clearTimeout(timer)
    ctx.abort.removeEventListener("abort", onAbort)
  }
  if (controller.signal.aborted) {
    throw new Error("Request timed out")
  }
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  const contentLength = response.headers.get("content-length")
  if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
    throw new Error("Response too large (exceeds 5MB limit)")
  }

  const arrayBuffer = await response.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
    throw new Error("Response too large (exceeds 5MB limit)")
  }

  const contentType = response.headers.get("content-type") || ""
  const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
  const title = `${params.url} (${contentType})`

  if (isImageAttachment(mime)) {
    const base64Content = Buffer.from(arrayBuffer).toString("base64")
    return {
      title,
      output: "Image fetched successfully",
      metadata: {},
      attachments: [
        {
          type: "file",
          mime,
          url: `data:${mime};base64,${base64Content}`,
        },
      ],
    }
  }

  const content = new TextDecoder().decode(arrayBuffer)

  switch (params.format) {
    case "markdown":
      if (contentType.includes("text/html")) {
        const markdown = convertHTMLToMarkdown(content)
        return { output: markdown, title, metadata: {} }
      }
      return { output: content, title, metadata: {} }

    case "text":
      if (contentType.includes("text/html")) {
        return { output: extractTextFromHTML(content), title, metadata: {} }
      }
      return { output: content, title, metadata: {} }

    case "html":
      return { output: content, title, metadata: {} }

    default:
      return { output: content, title, metadata: {} }
  }
}

export const webfetchTool: ToolDefinition = {
  description: DESCRIPTION,
  args,
  execute,
}
