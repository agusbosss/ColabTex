const vscode = acquireVsCodeApi();

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendEl = document.getElementById('send');

let messages = [];
const pendingByRequestId = new Map();
const lastSeqByRequestId = new Map();

function makeRequestId() {
  return `req_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMessages() {
  messagesEl.innerHTML = '';
  for (const message of messages) {
    if (message.kind === 'patchPending') {
      const wrapper = document.createElement('div');
      wrapper.className = 'message assistant patch-pending';

      const summary = document.createElement('div');
      summary.className = 'patch-summary';
      summary.textContent = message.summary || 'Patch plan ready.';
      wrapper.appendChild(summary);

      if (message.targetFile) {
        const target = document.createElement('div');
        target.className = 'patch-target';
        target.textContent = `Target: ${message.targetFile}`;
        wrapper.appendChild(target);
      }

      const actions = document.createElement('div');
      actions.className = 'patch-actions';
      for (const action of message.actions || []) {
        const button = document.createElement('button');
        button.textContent = action[0].toUpperCase() + action.slice(1);
        button.disabled = !!message.actionsDisabled;
        button.addEventListener('click', () => {
          handlePatchAction(message, action);
        });
        actions.appendChild(button);
      }
      wrapper.appendChild(actions);

      messagesEl.appendChild(wrapper);
      continue;
    }

    const div = document.createElement('div');
    div.className = `message ${message.role}`;
    div.textContent = message.text;
    messagesEl.appendChild(div);
  }
  scrollToBottom();
}

function persistMessages() {
  vscode.setState({ messages });
}

function appendMessage(text, role, id, requestId, extra) {
  const message = { text, role };
  if (id) {
    message.id = id;
  }
  if (requestId) {
    message.requestId = requestId;
  }
  if (extra) {
    Object.assign(message, extra);
  }
  messages.push(message);
  renderMessages();
  persistMessages();
}

function updateMessage(id, newText) {
  const message = messages.find((item) => item.id === id);
  if (message) {
    message.text = newText;
  } else {
    messages.push({ text: newText, role: 'assistant' });
  }
  renderMessages();
  persistMessages();
}

function upsertPatchPending(payload) {
  if (!payload || !payload.planId) {
    return;
  }
  const existing = messages.find((item) => item.kind === 'patchPending' && item.planId === payload.planId);
  const patchMessage = {
    kind: 'patchPending',
    role: 'assistant',
    planId: payload.planId,
    summary: payload.summary || 'Patch plan ready.',
    targetFile: payload.targetFile,
    actions: Array.isArray(payload.actions) ? payload.actions : ['preview', 'apply', 'discard'],
    actionsDisabled: false
  };
  if (existing) {
    Object.assign(existing, patchMessage);
  } else {
    messages.push(patchMessage);
  }
  renderMessages();
  persistMessages();
}

function handlePatchAction(message, action) {
  if (!message || !message.planId) {
    return;
  }
  const requestId = makeRequestId();
  const loadingId = `pending-${requestId}`;
  pendingByRequestId.set(requestId, loadingId);
  appendMessage('...', 'assistant', loadingId, requestId);

  message.actionsDisabled = true;
  renderMessages();
  persistMessages();

  vscode.postMessage({
    protocolVersion: 1,
    requestId,
    type: `patch/${action}`,
    payload: { planId: message.planId }
  });
}

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) {
    return;
  }
  inputEl.value = '';
  const requestId = makeRequestId();
  appendMessage(text, 'user', undefined, requestId);

  const loadingId = `pending-${requestId}`;
  pendingByRequestId.set(requestId, loadingId);
  appendMessage('...', 'assistant', loadingId, requestId);

  vscode.postMessage({
    protocolVersion: 1,
    requestId,
    type: 'chat/send',
    payload: { text }
  });
}

sendEl.addEventListener('click', () => {
  sendMessage();
});

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') {
    return;
  }

  if (message.protocolVersion === 1 && typeof message.requestId === 'string') {
    const requestId = message.requestId;
    const seq = typeof message.seq === 'number' ? message.seq : undefined;
    if (seq !== undefined) {
      const lastSeq = lastSeqByRequestId.get(requestId) ?? 0;
      if (seq <= lastSeq) {
        return;
      }
      lastSeqByRequestId.set(requestId, seq);
    }

    const pendingId = pendingByRequestId.get(requestId);

    if (message.type === 'agent/status') {
      if (pendingId) {
        updateMessage(pendingId, message.payload?.text ?? '...');
      }
      return;
    }

    if (message.type === 'agent/final') {
      if (pendingId) {
        updateMessage(pendingId, message.payload?.text ?? '');
        pendingByRequestId.delete(requestId);
      } else {
        appendMessage(message.payload?.text ?? '', 'assistant', undefined, requestId);
      }
      return;
    }

    if (message.type === 'agent/error') {
      const errorText = message.payload?.message
        ? `Error (${message.payload.code ?? 'ERROR'}): ${message.payload.message}`
        : 'Error: Unknown error.';
      if (pendingId) {
        updateMessage(pendingId, errorText);
        pendingByRequestId.delete(requestId);
      } else {
        appendMessage(errorText, 'assistant', undefined, requestId);
      }
      return;
    }

    if (message.type === 'patch/pending') {
      upsertPatchPending(message.payload);
      return;
    }
  }

  if (message.type === 'assistantMessage') {
    appendMessage(message.text, 'assistant');
  }
});

const storedState = vscode.getState();
if (storedState && Array.isArray(storedState.messages)) {
  messages = storedState.messages;
  renderMessages();
}
