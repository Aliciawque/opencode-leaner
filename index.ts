import { readFileSync } from "node:fs"
import { trimShellDescription } from "./src/tools/descriptions"
import READ_DESCRIPTION from "./src/tools/read.txt"
import GREP_DESCRIPTION from "./src/tools/grep.txt"
import GLOB_DESCRIPTION from "./src/tools/glob.txt"
import WRITE_DESCRIPTION from "./src/tools/write.txt"
import EDIT_DESCRIPTION from "./src/tools/edit.txt"
import WEBFETCH_DESCRIPTION from "./src/tools/webfetch.txt"
import TODOWRITE_DESCRIPTION from "./src/tools/todowrite.txt"
import { parseAgent } from "./src/agents/parse"
import { DebugContextPlugin } from "./src/debug/debug-context"

const DESCRIPTIONS: Record<string, string> = {
  read: READ_DESCRIPTION,
  grep: GREP_DESCRIPTION,
  glob: GLOB_DESCRIPTION,
  write: WRITE_DESCRIPTION,
  edit: EDIT_DESCRIPTION,
  webfetch: WEBFETCH_DESCRIPTION,
  todowrite: TODOWRITE_DESCRIPTION,
}

const AGENT_FILES: Array<[string, string]> = [
  ["bash", "./src/agents/bash.md"],
  ["blank", "./src/agents/blank.md"],
  ["minimal", "./src/agents/minimal.md"],
  ["coding", "./src/agents/coding.md"],
  ["pi-like", "./src/agents/pi-like.md"],
]

const PLUGIN_AGENTS: Record<string, Record<string, unknown>> = Object.fromEntries(
  AGENT_FILES.map(([name, file]) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8")
    const { name: agentName, def } = parseAgent(source, name)
    return [agentName, def]
  }),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return override ?? base
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    merged[key] = deepMerge(base[key], value)
  }
  return merged
}

type MergedConfig = {
  agent?: Record<string, unknown>
}

const server = async (_input: unknown) => {
  const debugContext = await DebugContextPlugin(_input)
  return {
    config: (cfg: MergedConfig) => {
      const agents = { ...cfg.agent }
      for (const [name, def] of Object.entries(PLUGIN_AGENTS)) {
        agents[name] = deepMerge(def, agents[name])
      }
      cfg.agent = agents
    },
    "tool.definition": async (input: { toolID: string }, output: { description: string; parameters: unknown }) => {
      if (input.toolID === "bash") {
        output.description = trimShellDescription(output.description)
        return
      }
      const description = DESCRIPTIONS[input.toolID]
      if (description !== undefined) {
        output.description = description
      }
    },
    ...debugContext,
  }
}

export default {
  id: "opencode-lean",
  server,
}
