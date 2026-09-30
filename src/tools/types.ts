export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  directory: string
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
  ask(input: {
    permission: string
    patterns: string[]
    always: string[]
    metadata: { [key: string]: any }
  }): Promise<void>
}

export type ToolAttachment = {
  type: "file"
  mime: string
  url: string
  filename?: string
}

export type ToolResult =
  | string
  | {
      title?: string
      output: string
      metadata?: { [key: string]: any }
      attachments?: ToolAttachment[]
    }

export type ToolDefinition = {
  description: string
  args: { [key: string]: unknown }
  execute(args: any, context: ToolContext): Promise<ToolResult>
}
