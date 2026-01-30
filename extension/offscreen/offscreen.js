// Offscreen Document for Audio Processing

let mediaStream = null;
let mediaRecorder = null;
let audioContext = null;
let websocket = null;
let settings = {};
let isRecording = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000;

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') {
    return;
  }

  if (message.action === 'startRecording') {
    startRecording(message.streamId, message.settings)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'stopRecording') {
    stopRecording();
    sendResponse({ success: true });
    return true;
  }
});

// Start recording audio
async function startRecording(streamId, captureSettings) {
  settings = captureSettings;

  // Get media stream from tab capture
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  // Connect to local server
  await connectWebSocket();

  // Setup audio context for processing
  audioContext = new AudioContext({ sampleRate: 24000 });
  const source = audioContext.createMediaStreamSource(mediaStream);

  // Create script processor for raw audio access
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (event) => {
    if (!isRecording || !websocket || websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const inputData = event.inputBuffer.getChannelData(0);

    // Convert float32 to int16 PCM
    const pcm16 = float32ToPCM16(inputData);

    // Convert to base64
    const base64Audio = arrayBufferToBase64(pcm16.buffer);

    // Send to server
    websocket.send(JSON.stringify({
      type: 'audio',
      data: base64Audio
    }));
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  isRecording = true;
  console.log('Recording started');
}

// Stop recording
function stopRecording() {
  isRecording = false;

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  if (websocket) {
    websocket.close();
    websocket = null;
  }

  console.log('Recording stopped');
}

// Connect to WebSocket server
async function connectWebSocket() {
  return new Promise((resolve, reject) => {
    const serverUrl = settings.serverUrl || 'ws://localhost:3000';

    // Update status
    chrome.runtime.sendMessage({
      action: 'statusUpdate',
      status: 'connecting to server...',
      connecting: true
    }).catch(() => {});

    websocket = new WebSocket(serverUrl);

    websocket.onopen = () => {
      console.log('WebSocket connected');
      reconnectAttempts = 0; // Reset on successful connection

      // Update status
      chrome.runtime.sendMessage({
        action: 'statusUpdate',
        status: 'connected',
        connected: true
      }).catch(() => {});

      // Send configuration
      websocket.send(JSON.stringify({
        type: 'config',
        apiKey: settings.apiKey,
        sourceLanguage: settings.sourceLanguage,
        translateToEnglish: settings.translateToEnglish
      }));

      resolve();
    };

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'transcription') {
          // Forward transcription to service worker
          chrome.runtime.sendMessage({
            action: 'transcription',
            data: {
              text: message.text,
              isFinal: message.isFinal
            }
          }).catch(() => {});
        }

        if (message.type === 'error') {
          console.error('Server error:', message.error);
          chrome.runtime.sendMessage({
            action: 'statusUpdate',
            status: `error: ${message.error}`,
            connected: false
          }).catch(() => {});
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      chrome.runtime.sendMessage({
        action: 'statusUpdate',
        status: 'connection failed',
        connected: false
      }).catch(() => {});
      reject(new Error('WebSocket connection failed. Is the server running?'));
    };

    websocket.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);

      if (isRecording && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1);

        chrome.runtime.sendMessage({
          action: 'statusUpdate',
          status: `reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`,
          connecting: true
        }).catch(() => {});

        console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

        setTimeout(() => {
          if (isRecording) {
            connectWebSocket().catch((err) => {
              console.error('Reconnection failed:', err);
              if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                chrome.runtime.sendMessage({
                  action: 'statusUpdate',
                  status: 'connection lost. please restart.',
                  connected: false
                }).catch(() => {});
                stopRecording();
              }
            });
          }
        }, delay);
      } else if (isRecording) {
        chrome.runtime.sendMessage({
          action: 'statusUpdate',
          status: 'disconnected',
          connected: false
        }).catch(() => {});
      }
    };
  });
}

// Convert Float32Array to Int16Array (PCM16)
function float32ToPCM16(float32Array) {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    // Clamp to [-1, 1] and convert to int16
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm16;
}

// Convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
