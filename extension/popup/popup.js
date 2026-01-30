// DOM Elements
const apiKeyInput = document.getElementById('apiKey');
const toggleKeyBtn = document.getElementById('toggleKey');
const eyeIcon = document.getElementById('eyeIcon');
const saveKeyBtn = document.getElementById('saveKey');
const sourceLanguageSelect = document.getElementById('sourceLanguage');
const translateCheckbox = document.getElementById('translateToEnglish');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const serverUrlInput = document.getElementById('serverUrl');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

// Load saved settings
async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'apiKey',
    'sourceLanguage',
    'translateToEnglish',
    'serverUrl',
    'isCapturing'
  ]);

  if (settings.apiKey) {
    apiKeyInput.value = settings.apiKey;
  }
  if (settings.sourceLanguage) {
    sourceLanguageSelect.value = settings.sourceLanguage;
  }
  if (settings.translateToEnglish !== undefined) {
    translateCheckbox.checked = settings.translateToEnglish;
  }
  if (settings.serverUrl) {
    serverUrlInput.value = settings.serverUrl;
  }

  updateCaptureState(settings.isCapturing || false);
}

// Save API key
saveKeyBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showStatus('please enter an api key', 'error');
    return;
  }
  if (!apiKey.startsWith('sk-')) {
    showStatus('invalid api key format', 'error');
    return;
  }

  await chrome.storage.local.set({ apiKey });
  showStatus('api key saved', 'success');
});

// Toggle password visibility
toggleKeyBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  eyeIcon.textContent = isPassword ? 'hide' : 'show';
});

// Save settings on change
sourceLanguageSelect.addEventListener('change', async () => {
  await chrome.storage.local.set({ sourceLanguage: sourceLanguageSelect.value });
});

translateCheckbox.addEventListener('change', async () => {
  await chrome.storage.local.set({ translateToEnglish: translateCheckbox.checked });
});

serverUrlInput.addEventListener('change', async () => {
  await chrome.storage.local.set({ serverUrl: serverUrlInput.value });
});

// Start captions
startBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showStatus('please enter your openai api key', 'error');
    return;
  }

  const serverUrl = serverUrlInput.value.trim();
  if (!serverUrl) {
    showStatus('please enter the server url', 'error');
    return;
  }

  // Save settings
  await chrome.storage.local.set({
    apiKey,
    serverUrl,
    sourceLanguage: sourceLanguageSelect.value,
    translateToEnglish: translateCheckbox.checked
  });

  // Send message to service worker to start capture
  chrome.runtime.sendMessage({
    action: 'startCapture',
    settings: {
      apiKey,
      serverUrl,
      sourceLanguage: sourceLanguageSelect.value,
      translateToEnglish: translateCheckbox.checked
    }
  }, (response) => {
    if (response?.success) {
      updateCaptureState(true);
    } else {
      showStatus(response?.error || 'failed to start capture', 'error');
    }
  });
});

// Stop captions
stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stopCapture' }, (response) => {
    if (response?.success) {
      updateCaptureState(false);
    }
  });
});

// Update UI based on capture state
function updateCaptureState(isCapturing) {
  startBtn.disabled = isCapturing;
  stopBtn.disabled = !isCapturing;

  if (isCapturing) {
    statusDot.classList.add('connected');
    statusDot.classList.remove('connecting');
    statusText.textContent = 'capturing';
  } else {
    statusDot.classList.remove('connected', 'connecting');
    statusText.textContent = 'disconnected';
  }

  chrome.storage.local.set({ isCapturing });
}

// Show status message
function showStatus(message, type) {
  statusText.textContent = message;
  if (type === 'error') {
    statusDot.classList.remove('connected', 'connecting');
  } else if (type === 'success') {
    statusDot.classList.add('connecting');
    setTimeout(() => {
      statusDot.classList.remove('connecting');
    }, 2000);
  }
}

// Listen for status updates from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'statusUpdate') {
    statusText.textContent = message.status;
    if (message.connected) {
      statusDot.classList.add('connected');
      statusDot.classList.remove('connecting');
    } else if (message.connecting) {
      statusDot.classList.add('connecting');
      statusDot.classList.remove('connected');
    } else {
      statusDot.classList.remove('connected', 'connecting');
    }
  }

  if (message.action === 'captureStateChanged') {
    updateCaptureState(message.isCapturing);
  }
});

// Initialize
loadSettings();
