
## Project
`opencode-lean` (package `opencode-lean`) is an opencode plugin that help you reduce the context size, making it lean and more efficient. To do this it mirror some opencode tools to prune descriptions and

## Stack
- TypeScript, run with Bun

## Conventions
- Each tool mirrors its opencode builtin: same params, output format, truncation caps, permission prompts (`ctx.ask`).
- Descriptions in `<tool>.txt` stay minimal; implementation defines behavior.

## Verify
- Typecheck: `bunx tsc`
- No test suite yet; validate by loading the plugin in opencode and opencode debug.
