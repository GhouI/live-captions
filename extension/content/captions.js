// Content Script for Caption Overlay

let captionContainer = null;
let captionText = null;
let isVisible = false;
let hideTimeout = null;

// Create caption overlay
function createCaptionOverlay() {
  if (captionContainer) {
    return;
  }

  // Create container
  captionContainer = document.createElement('div');
  captionContainer.id = 'live-captions-container';
  captionContainer.className = 'live-captions-container';

  // Create text element
  captionText = document.createElement('div');
  captionText.id = 'live-captions-text';
  captionText.className = 'live-captions-text';

  // Create drag handle
  const dragHandle = document.createElement('div');
  dragHandle.className = 'live-captions-drag-handle';
  dragHandle.innerHTML = '::';

  captionContainer.appendChild(dragHandle);
  captionContainer.appendChild(captionText);
  document.body.appendChild(captionContainer);

  // Make draggable
  makeDraggable(captionContainer, dragHandle);

  // Load saved position
  loadPosition();
}

// Remove caption overlay
function removeCaptionOverlay() {
  if (captionContainer) {
    captionContainer.remove();
    captionContainer = null;
    captionText = null;
  }
}

// Show captions
function showCaptions() {
  createCaptionOverlay();
  captionContainer.classList.add('visible');
  isVisible = true;
}

// Hide captions
function hideCaptions() {
  if (captionContainer) {
    captionContainer.classList.remove('visible');
  }
  isVisible = false;
}

// Update caption text
function updateCaptions(text, isFinal = false) {
  if (!captionText) {
    createCaptionOverlay();
  }

  if (!captionContainer.classList.contains('visible')) {
    captionContainer.classList.add('visible');
  }

  // Update text with typing indicator for non-final
  captionText.textContent = text;
  captionText.classList.toggle('interim', !isFinal);

  // Clear any existing hide timeout
  if (hideTimeout) {
    clearTimeout(hideTimeout);
  }

  // Auto-hide after 5 seconds of no updates
  if (isFinal && text) {
    hideTimeout = setTimeout(() => {
      captionText.textContent = '';
    }, 5000);
  }
}

// Make element draggable
function makeDraggable(element, handle) {
  let isDragging = false;
  let startX, startY, startLeft, startTop;

  handle.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = element.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;

    element.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    let newLeft = startLeft + deltaX;
    let newTop = startTop + deltaY;

    // Keep within viewport
    const rect = element.getBoundingClientRect();
    newLeft = Math.max(0, Math.min(window.innerWidth - rect.width, newLeft));
    newTop = Math.max(0, Math.min(window.innerHeight - rect.height, newTop));

    element.style.left = `${newLeft}px`;
    element.style.top = `${newTop}px`;
    element.style.bottom = 'auto';
    element.style.transform = 'none';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      element.classList.remove('dragging');
      savePosition();
    }
  });
}

// Save position to storage
function savePosition() {
  if (!captionContainer) return;

  const rect = captionContainer.getBoundingClientRect();
  chrome.storage.local.set({
    captionPosition: {
      left: rect.left,
      top: rect.top
    }
  });
}

// Load position from storage
function loadPosition() {
  chrome.storage.local.get('captionPosition', (result) => {
    if (result.captionPosition && captionContainer) {
      captionContainer.style.left = `${result.captionPosition.left}px`;
      captionContainer.style.top = `${result.captionPosition.top}px`;
      captionContainer.style.bottom = 'auto';
      captionContainer.style.transform = 'none';
    }
  });
}

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'showCaptions') {
    showCaptions();
    sendResponse({ success: true });
  }

  if (message.action === 'hideCaptions') {
    hideCaptions();
    sendResponse({ success: true });
  }

  if (message.action === 'updateCaptions') {
    updateCaptions(message.text, message.isFinal);
    sendResponse({ success: true });
  }

  return true;
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  removeCaptionOverlay();
});
