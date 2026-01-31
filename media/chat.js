const vscode = acquireVsCodeApi();

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendEl = document.getElementById('send');

let messages = [];

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

function appendMessage(text, role) {
  messages.push({ text, role });
  renderMessages();
  persistMessages();
}

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) {
    return;
  }
  inputEl.value = '';
  appendMessage(`You: ${text}`, 'user');
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
    appendMessage(`ColabTex: ${message.text}`, 'assistant');
  }
});

const storedState = vscode.getState();
if (storedState && Array.isArray(storedState.messages)) {
  messages = storedState.messages;
  renderMessages();
}