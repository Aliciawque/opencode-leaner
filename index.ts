import { readTool } from "./src/tools/read"
import { grepTool } from "./src/tools/grep"
import { globTool } from "./src/tools/glob"
import { writeTool } from "./src/tools/write"
import { editTool } from "./src/tools/edit"
import { webfetchTool } from "./src/tools/webfetch"
import { trimShellDescription } from "./src/tools/descriptions"
import TODOWRITE_DESCRIPTION from "./src/tools/todowrite.txt"

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
