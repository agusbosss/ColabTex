# ColabTex

ColabTex is a VS Code extension pack for LaTeX workflows, bundling essential tooling so users can start writing and compiling LaTeX projects quickly.

## What it includes

- LaTeX Workshop (`James-Yu.latex-workshop`) via `extensionPack` and `extensionDependencies`.

## Commands

- `colabtex.helloWorld`
- `colabtex.runSetupCheck`
- `colabtex.setOpenAIApiKey`
- `colabtex.clearOpenAIApiKey`
- `colabtex.previewProposedChanges`
- `colabtex.applyProposedChanges`
- `colabtex.discardProposedChanges`
- `colabtex.buildLatexOptional`

## Development

- `npm install`
- `npm run compile`
- `F5` (Run Extension)

Note: In the Extension Development Host, VS Code may not auto-install extension packs. Validate pack behavior with a VSIX or via Marketplace install.

## Smoke tests (manual)

1) Ask the chat to create `intro.tex` and link it from `main.tex`.
2) Run `ColabTex: Preview Proposed Changes` and verify the diff.
3) Run `ColabTex: Apply Proposed Changes` or `ColabTex: Discard Proposed Changes`.
4) Select a paragraph and ask the chat to improve it; verify the diff only touches the selection.
5) (Optional) Run `ColabTex: Build LaTeX (optional)` and inspect the Output channel/log.

## Routing (chat vs edit)

The chat routes messages to either:
- Chat mode: conceptual questions, no file changes.
- Edit mode: deterministic triggers (file mention, edit verbs, LaTeX patterns, or selection + improve verbs).

Examples:
- "Escribí Agustín en \\author{Your Name Here} en CV.tex" -> edit mode.
- "en ese archivo escribí una plantilla básica para CV académico" -> edit mode.
- "mejorá este párrafo" (with selection) -> edit mode.
- "qué es un .aux" -> chat mode.

## Sticky target behavior

When an edit request is followed by another edit-like instruction without a file path, ColabTex keeps a sticky target (last edited file) for a short time. This ensures follow-up commands apply to the same document.

## License

MIT
