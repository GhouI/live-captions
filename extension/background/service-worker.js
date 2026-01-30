// Service Worker for Live Captions Extension

let isCapturing = false;
let currentTabId = null;
let settings = {};

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startCapture') {
    startCapture(message.settings)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }

  if (message.action === 'stopCapture') {
    stopCapture()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'getStatus') {
    sendResponse({ isCapturing, currentTabId });
    return true;
  }

  // Forward transcription to content script
  if (message.action === 'transcription') {
    forwardToContentScript(message.data);
  }

  // Audio data from offscreen document
  if (message.action === 'audioData') {
    forwardToServer(message.data);
  }
});

// Start audio capture
async function startCapture(captureSettings) {
  if (isCapturing) {
    throw new Error('Already capturing');
  }

  settings = captureSettings;

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error('No active tab found');
  }

  currentTabId = tab.id;

  // Create offscreen document for audio processing
  await setupOffscreenDocument();

  // Start tab capture
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: currentTabId
  });

  // Send stream ID to offscreen document to start recording
  await chrome.runtime.sendMessage({
    action: 'startRecording',
    target: 'offscreen',
    streamId,
    settings
  });

  isCapturing = true;

  // Notify content script to show captions overlay
  try {
    await chrome.tabs.sendMessage(currentTabId, {
      action: 'showCaptions'
    });
  } catch (e) {
    console.log('Content script not ready, injecting...');
  }

  // Broadcast status update
  broadcastStatus('Capturing audio...', true);
}

// Stop audio capture
async function stopCapture() {
  if (!isCapturing) {
    return;
  }

  // Tell offscreen document to stop recording
  try {
    await chrome.runtime.sendMessage({
      action: 'stopRecording',
      target: 'offscreen'
    });
  } catch (e) {
    console.log('Offscreen document may already be closed');
  }

  // Hide captions in content script
  if (currentTabId) {
    try {
      await chrome.tabs.sendMessage(currentTabId, {
        action: 'hideCaptions'
      });
    } catch (e) {
      console.log('Could not hide captions');
    }
  }

  isCapturing = false;
  currentTabId = null;

  // Broadcast status update
  broadcastStatus('Disconnected', false);
  chrome.runtime.sendMessage({ action: 'captureStateChanged', isCapturing: false });
}

// Setup offscreen document
async function setupOffscreenDocument() {
  const offscreenUrl = 'offscreen/offscreen.html';

  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(offscreenUrl)]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // Create offscreen document
  await chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: ['USER_MEDIA'],
    justification: 'Recording tab audio for transcription'
  });
}

// Forward transcription to content script
function forwardToContentScript(data) {
  if (currentTabId) {
    chrome.tabs.sendMessage(currentTabId, {
      action: 'updateCaptions',
      text: data.text,
      isFinal: data.isFinal
    }).catch(() => {});
  }
}

// Forward audio data to server (via offscreen document's WebSocket)
function forwardToServer(data) {
  // Audio is sent directly from offscreen document to server
  // This function is a placeholder for any additional processing
}

// Broadcast status to popup
function broadcastStatus(status, connected = false, connecting = false) {
  chrome.runtime.sendMessage({
    action: 'statusUpdate',
    status,
    connected,
    connecting
  }).catch(() => {});
}

// Handle tab updates (stop capture if tab is closed or navigated)
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTabId) {
    stopCapture();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === currentTabId && changeInfo.status === 'loading') {
    // Tab navigated, stop capture
    stopCapture();
  }
});

// Clean up on extension unload
self.addEventListener('unload', () => {
  stopCapture();
});
