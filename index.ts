import { trimShellDescription } from "./src/tools/descriptions"
import READ_DESCRIPTION from "./src/tools/read.txt"
import GREP_DESCRIPTION from "./src/tools/grep.txt"
import GLOB_DESCRIPTION from "./src/tools/glob.txt"
import WRITE_DESCRIPTION from "./src/tools/write.txt"
import EDIT_DESCRIPTION from "./src/tools/edit.txt"
import WEBFETCH_DESCRIPTION from "./src/tools/webfetch.txt"
import TODOWRITE_DESCRIPTION from "./src/tools/todowrite.txt"

const DESCRIPTIONS: Record<string, string> = {
  read: READ_DESCRIPTION,
  grep: GREP_DESCRIPTION,
  glob: GLOB_DESCRIPTION,
  write: WRITE_DESCRIPTION,
  edit: EDIT_DESCRIPTION,
  webfetch: WEBFETCH_DESCRIPTION,
  todowrite: TODOWRITE_DESCRIPTION,
}

const server = async () => ({
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
})

export default {
  id: "opencode-lean",
  server,
}
