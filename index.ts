import { readTool } from "./src/read"
import { grepTool } from "./src/grep"
import { globTool } from "./src/glob"
import { writeTool } from "./src/write"
import { editTool } from "./src/edit"
import { webfetchTool } from "./src/webfetch"
import { trimShellDescription } from "./src/descriptions"
import TODOWRITE_DESCRIPTION from "./src/todowrite.txt"

const server = async () => ({
  tool: {
    read: readTool,
    grep: grepTool,
    glob: globTool,
    write: writeTool,
    edit: editTool,
    webfetch: webfetchTool,
  },
  "tool.definition": async (input: { toolID: string }, output: { description: string; parameters: unknown }) => {
    if (input.toolID === "bash") {
      output.description = trimShellDescription(output.description)
    }
    if (input.toolID === "todowrite") {
      output.description = TODOWRITE_DESCRIPTION
    }
  },
})

export default {
  id: "opencode-lean",
  server,
}
