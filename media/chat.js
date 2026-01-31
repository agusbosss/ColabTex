const vscode = acquireVsCodeApi();

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendEl = document.getElementById('send');

let messages = [];
let pendingAssistantId = null;

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMessages() {
  messagesEl.innerHTML = '';
  for (const message of messages) {
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

function setLoading(isLoading) {
  inputEl.disabled = isLoading;
  sendEl.disabled = isLoading;
}

function appendMessage(text, role, id) {
  const message = { text, role };
  if (id) {
    message.id = id;
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

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) {
    return;
  }
  inputEl.value = '';
  appendMessage(text, 'user');

  const loadingId = `loading-${Date.now()}`;
  pendingAssistantId = loadingId;
  appendMessage('...', 'assistant', loadingId);
  setLoading(true);

  vscode.postMessage({ type: 'userMessage', text });
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
  if (message.type === 'assistantMessage') {
    if (pendingAssistantId) {
      updateMessage(pendingAssistantId, message.text);
      pendingAssistantId = null;
    } else {
      appendMessage(message.text, 'assistant');
    }
    setLoading(false);
  }
});

const storedState = vscode.getState();
if (storedState && Array.isArray(storedState.messages)) {
  messages = storedState.messages;
  renderMessages();
}