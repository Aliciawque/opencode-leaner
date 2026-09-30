---
description: A coding assistant without tools and without prompt
mode: primary
permission:
  bash: deny
  webfetch: deny
  edit: deny
  glob: deny
  grep: deny
  read: deny
  todowrite: deny
  write: deny
  lsp: deny
  task:
    "*": deny
  skill:
    "*": deny
---

You are an expert coding assistant operating inside opencode, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.