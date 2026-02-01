# AGENTS.md — ColabTex

> **Purpose:** Guía operativa para humanos y agentes (LLMs) que trabajen en ColabTex. Mantener este archivo **actualizado** cuando cambien decisiones técnicas o estructura del repo.

---

## Contexto del proyecto

- **Nombre del repo:** ColabTex
- **Qué hace el sistema (1 párrafo):**  
  ColabTex es una extensión de **VS Code** que (1) actúa como **extension pack** instalando automáticamente **LaTeX Workshop** para compilar y previsualizar documentos LaTeX, y (2) provee un **panel propio tipo Codex** (chat) conectado a la **OpenAI API (BYOK)** para asistir en la escritura y mantenimiento de proyectos LaTeX. El agente puede leer contexto del workspace, crear archivos, proponer cambios mediante **diffs/patches aplicables con preview**, y (en etapas posteriores) ejecutar un ciclo **build → parse logs → fix** para corregir errores de compilación. Incluye un **Setup Wizard** para detectar si existe una distribución TeX instalada y guiar al usuario si falta.

- **Stack (lenguaje/runtime/frameworks):**
  - **TypeScript** (código de extensión)
  - **Node.js** (Extension Host runtime)
  - **VS Code Extension API** (commands, workspace, SecretStorage, OutputChannel)
  - **Webview** (UI del panel de chat)
  - **OpenAI API** (modelo y streaming; BYOK)
  - **LaTeX Workshop** (build/preview LaTeX; instalado vía `extensionPack`)

---

## Nota sobre estructura “cambiante”
Sí: es correcto documentar estructura y decisiones aunque cambien, **pero** con dos reglas:
1) Este AGENTS.md debe reflejar el **estado actual** del repo (no “lo ideal” si ya no aplica).  
2) Si algo aún no existe, se marca como **TODO** o “planned”, sin inventar rutas ni comandos.

---

## Objetivo y alcance
**Objetivo:** construir una extensión “todo en uno” para trabajar con LaTeX en VS Code con ayuda de un agente IA:
- Instalación simplificada (pack de extensiones)
- Setup guiado de TeX
- Chat con agente (panel propio)
- Operaciones seguras en archivos (diff preview → apply)
- Integración con build/preview y, luego, “fix errors” a partir de logs

**Fuera de alcance (por ahora):**
- Instalar automáticamente TeX Live/MiKTeX/MacTeX (software del sistema). Solo se detecta y se guía.
- Integración con Overleaf (no requerida).
- Telemetría/analytics (por defecto: no).

---

## Invariantes / cosas que NO se deben romper
1) **Seguridad de la API key:**  
   - Nunca guardar en `settings.json`, `.env` commiteable o logs.  
   - Usar **VS Code SecretStorage**.
2) **Edición segura:**  
   - Nunca aplicar cambios silenciosamente.  
   - Siempre mostrar **diff preview** y requerir confirmación (Apply/Discard).
3) **Validación de output del LLM:**  
   - No confiar en texto libre.  
   - Cambios deben venir en un formato validable (JSON edits o unified diff parseable).  
   - Rechazar/rehacer si el formato no cumple.
4) **No ejecutar comandos arbitrarios sugeridos por el LLM.**  
   - Solo permitir comandos predefinidos del sistema (build LaTeX, abrir archivo, etc.).
5) **No escribir fuera del workspace** (path traversal).
6) **Setup Wizard no bloqueante:**  
   - Si falta TeX, guiar; permitir usar funciones no dependientes de compilación.
7) **No depender de features premium externas** para el core.
8) **Logs sin datos sensibles:**  
   - Nunca loggear secretos.  
   - Evitar loggear contenido completo de archivos salvo modo debug explícito (TODO si se implementa).

---

## Mapa del repo (Repo Map)

> **TODO:** Reemplazar esta sección con el árbol real cuando exista el scaffold.  
> Mientras tanto, esta es la **estructura objetivo** (planned) para mantener responsabilidades claras:

.
├─ src/
│ ├─ extension.ts # activation + wiring de comandos/views
│ ├─ setup/
│ │ ├─ texDetector.ts # detección TeX/latexmk (child_process)
│ │ └─ setupWizard.ts # wizard UI + guidance por OS
│ ├─ secrets/
│ │ └─ secretStore.ts # set/get/clear OpenAI key (SecretStorage)
│ ├─ ai/
│ │ └─ client.ts # cliente OpenAI (streaming, retries, timeouts)
│ ├─ agent/
│ │ └─ tools/ # herramientas: read/list/search/create/apply/build
│ ├─ latex/
│ │ ├─ build.ts # integración con comandos LaTeX Workshop
│ │ └─ logParser.ts # parseo de logs (.log / output) para errores/warnings
│ └─ webview/
│ ├─ index.html # shell webview (CSP estricta)
│ ├─ app.ts # UI chat + estado + render
│ └─ bridge.ts # protocolo mensajes ui <-> extension host
├─ package.json # manifest + contributes + extensionPack
├─ tsconfig.json
└─ README.md


---

## Integraciones externas / APIs
- **OpenAI API (BYOK)**
  - **TODO:** definir endpoint y modelo por defecto.
  - Políticas mínimas recomendadas:
    - Retries: 2–3 para 429/5xx con backoff exponencial
    - Cancelación: soportar abort (user cancels) si hay streaming
    - Límite de contexto: no enviar todo el repo; usar selección/archivos acotados
- **LaTeX Workshop**
  - Se invoca mediante `vscode.commands.executeCommand(...)`.
  - **TODO:** confirmar los command IDs exactos que se usarán para build/view (no inventar).

---

## TeX/LaTeX: qué es y cómo se valida el entorno
**LaTeX** es el lenguaje de marcado para documentos; para generar PDF se necesita un compilador (p. ej. `pdflatex`, `xelatex`, `lualatex`) y herramientas auxiliares.  
Una **distribución TeX** (TeX Live / MiKTeX / MacTeX) instala esos binarios y los paquetes LaTeX necesarios.

**Chequeo (Setup Wizard):** ColabTex detecta si están disponibles en PATH:
- `latexmk --version` (frecuente en flujos con LaTeX Workshop)
- `pdflatex --version` o `xelatex --version` o `lualatex --version`

Estados típicos:
- OK (todo detectado)
- Falta TeX (no hay compiladores)
- Falta `latexmk`
- PATH no actualizado (requiere restart)
- Windows + MiKTeX sin Perl (posible problema para latexmk) **TODO:** definir estrategia de messaging

**Guía:** ColabTex solo guía; no instala software del sistema.

---

## Configuración (env/config)

### API key (OpenAI)
- Se configura por comando:
  - `ColabTex: Set OpenAI API Key` (**TODO:** nombre final del comando)
  - `ColabTex: Clear OpenAI API Key` (**TODO:** nombre final del comando)
- Se almacena en **SecretStorage** (no settings).

### Settings no-secret (planificados)
**TODO:** definir claves exactas, por ejemplo:
- `colabtex.model`
- `colabtex.maxFiles`
- `colabtex.maxFileChars`
- `colabtex.enableStreaming`

---

## Workflow recomendado (ChatGPT + GitHub Desktop + VS Code + Codex)

### Desarrollo “desde VS Code” (cómo se prueba una extensión en VS Code)
- Abrir el repo en VS Code (instancia de desarrollo).
- Ejecutar **F5** (Run → Start Debugging).
- Se abre un **Extension Development Host** (otra ventana de VS Code) con la extensión cargada desde el filesystem local.
- Probar comandos, panel, wizard, etc.
- Para recargar cambios: `Developer: Reload Window` en el host.

### Branching & commits (GitHub Desktop)
- Crear un branch por feature:
  - `feature/setup-wizard`
  - `feature/webview-chat`
  - `feature/openai-client`
  - `feature/diff-apply`
- Commits atómicos:
  - `feat: add TeX detection wizard`
  - `feat: add chat webview panel`
  - `feat: store OpenAI key in SecretStorage`
  - `fix: validate patch schema before applying`

### Uso de Codex/ChatGPT
- **ChatGPT:** arquitectura, decisiones, prompts, revisión de diseño, troubleshooting.
- **Codex:** implementar tareas acotadas por archivo/módulo. Buen patrón:
  - darle scope: “solo editar `src/setup/texDetector.ts`”
  - darle invariantes: “no loggear secretos; no aplicar cambios sin preview”

---

## Convenciones de implementación

### Entrega de cambios (respuesta)
- Preferencia del repo: entregar solo diffs (no archivos completos), salvo que el usuario pida lo contrario.

### Edición de archivos (forma correcta)
- El LLM propone cambios en un **formato estructurado**.
- La extensión valida y muestra **preview**.
- Aplicación con `WorkspaceEdit`.

**TODO:** elegir una representación final:
- Opción A: JSON edits `[{ uri, edits: [{ startLine, startChar, endLine, endChar, text }] }]`
- Opción B: unified diff (requiere parser y validación estricta)

### Webview (seguridad)
- CSP estricta.
- No cargar JS remoto.
- Assets locales via `asWebviewUri`.
- Protocolo de mensajes versionado:
  - `ui -> ext`: `chat.send`, `files.read`, `patch.apply`, `build.run`, etc.
  - `ext -> ui`: `chat.stream`, `diff.show`, `build.status`, `wizard.show`, etc.

---

## Testing actual y DoD

### Cómo se prueba hoy
- **Manual (principal):**
  1) F5 → abrir Extension Development Host
  2) Abrir un `.tex`
  3) Verificar Setup Wizard
  4) Abrir panel chat y enviar prompt
  5) Probar creación/edición con diff preview
  6) Ejecutar build (si TeX está instalado)
- Tests automatizados:
  - **TODO:** no hay tests todavía.

### Definition of Done por feature
- Funciona en Extension Development Host.
- No hay logs de secretos.
- Cambios siempre pasan por diff preview.
- Errores presentan mensajes accionables.
- No rompe compilación del proyecto de la extensión (`tsc`/build) **TODO:** comando exacto.

---

## Logging / Observabilidad
- OutputChannel: `ColabTex` (planned)
- Loggear:
  - resultados de detección TeX (sin datos sensibles)
  - estado de build (success/fail)
  - errores OpenAI (sin headers/keys)
- No loggear:
  - API key
  - prompts completos/archivos completos salvo modo debug explícito (**TODO**)

---

## Assumptions / TODOs (para no inventar nada)
1) **Comandos exactos de build/lint/test**: TODO (definir cuando exista el scaffold).  
2) **Command IDs de LaTeX Workshop**: TODO (confirmar y documentar).  
3) **API OpenAI**: TODO (endpoint, modelo default, esquema de streaming y retries).  
4) **Formato de patches**: TODO (JSON edits vs unified diff).  
5) **Node version**: TODO.  
6) **Estructura del repo**: TODO (reemplazar “planned” por el árbol real luego del bootstrap).  
7) **Política de telemetría**: TODO (por defecto: no telemetría).

---
