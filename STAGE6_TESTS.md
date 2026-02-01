# ColabTex – Stage 6 Test Checklist

## Setup
- `npm run compile`
- Run extension (`F5`)
- In Extension Development Host: `Developer: Reload Window`
- Set API key: `ColabTex: Set OpenAI API Key`

## Routing & intent detection
- Chat mode: ask “¿qué es un .aux?” ? should answer normally (no patch plan).
- Edit mode (file mention): “Escribí Agustín en \author{Your Name Here} en CV.tex” ? should propose PatchPlan + preview.
- Edit mode (LaTeX pattern): “cambia \title{...} en main.tex” ? patch plan.
- Edit mode (selection): select a paragraph and ask “mejorá este párrafo” ? patch plan.
- Non-edit message: “hola” ? chat reply (no patch).

## PatchPlan enforcement
- Force non-JSON reply test: ask edit intent and verify it still produces a PatchPlan or fails with controlled error.
- Validation errors surface: check Output ? ColabTex for validation errors when failure happens.

## Diff preview & apply flow
- Ask: “crea intro.tex y agregalo en main.tex”
- Confirm: `ColabTex: Preview Proposed Changes` opens diff(s)
- Confirm: `ColabTex: Apply Proposed Changes` applies edits
- Confirm: `ColabTex: Discard Proposed Changes` clears pending patch

## Pending patch behavior
- With a pending patch, send a new edit request ? should prompt to Preview/Apply/Discard instead of overwriting

## File ops safety
- Ask to edit a file outside workspace (e.g., `C:\Windows\...`) ? should fail safely (no apply)
- Ask to use `../` in paths ? should fail validation

## Build loop (optional)
- Run `ColabTex: Build LaTeX (optional)`
- If TeX installed, verify OK and output log
- If TeX missing, verify error message in Output

## Error handling
- Clear key: `ColabTex: Clear OpenAI API Key` then send a message ? CTA to set key
- Invalid key test: set a fake key ? should return “Invalid API key…”
- Rate limit (if triggered) ? should show rate limit message

## UI/UX
- Chat loading: send a message and confirm input disabled until reply
- History persistence: reload webview and confirm messages persist

## Logs
- Output ? ColabTex should show intent routing logs and OpenAI errors (no API key printed)