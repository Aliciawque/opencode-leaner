type ModelInfo = {
  providerID: string
  id: string
}

type MessagesTransformOutput = {
  messages: Array<{ info?: { sessionID?: string } }>
}

type SystemTransformInput = {
  sessionID?: string
  model: ModelInfo
}

type SystemTransformOutput = {
  system: string[]
}

type ParamsInput = {
  sessionID: string
  model: ModelInfo
}

type HeadersInput = {
  sessionID: string
}

type HeadersOutput = {
  headers: Record<string, string>
}

export type DebugContextHooks = {
  "experimental.chat.messages.transform": (input: Record<string, never>, output: MessagesTransformOutput) => Promise<void>
  "experimental.chat.system.transform": (input: SystemTransformInput, output: SystemTransformOutput) => Promise<void>
  "chat.params": (input: ParamsInput, output: Record<string, unknown>) => Promise<void>
  "chat.headers": (input: HeadersInput, output: HeadersOutput) => Promise<void>
}

/**
 * When OPENCODE_LEANER_DEBUG_CONTEXT=1, appends the outgoing messages, system prompt,
 * params, and headers to a file for offline inspection.
 * File path is set via OPENCODE_LEANER_DEBUG_CONTEXT_PATH, defaulting to
 * /tmp/opencode-context-debug.txt.
 */
export const DebugContextPlugin: (input: unknown) => Promise<DebugContextHooks> = async (_input) => {
  const file = process.env.OPENCODE_LEANER_DEBUG_CONTEXT_PATH ?? "/tmp/opencode-context-debug.txt"

  const json = (v: unknown): string => {
    try {
      return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2)
    } catch {
      return "(failed to serialize)"
    }
  }

  const append = async (section: string, data: string) => {
    if (process.env.OPENCODE_LEANER_DEBUG_CONTEXT !== "1") return
    const fs = await import("node:fs")
    fs.appendFileSync(file, `\n=== ${section} | ${new Date().toISOString()} ===\n${data}\n`)
  }

  return {
    "experimental.chat.messages.transform": async (_i, output) => {
      const session = output.messages[0]?.info?.sessionID ?? "n/a"
      await append(`messages | session ${session}`, json(output.messages))
    },
    "experimental.chat.system.transform": async (input, output) => {
      await append(
        `system | ${input.model.providerID}/${input.model.id} | session ${input.sessionID ?? "n/a"}`,
        output.system.join("\n"),
      )
    },
    "chat.params": async (input, output) => {
      await append(`params | ${input.model.providerID}/${input.model.id} | session ${input.sessionID}`, json(output))
    },
    "chat.headers": async (input, output) => {
      await append(`headers | session ${input.sessionID}`, json(output.headers))
    },
  }
}
