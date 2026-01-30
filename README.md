# Live Captions

A Chrome extension that provides real-time audio transcription and translation for browser tabs using OpenAI's gpt-4o-transcribe and whisper-1 models.

## Features

- Real-time transcription of browser tab audio
- Translation to English for non-English audio
- Draggable caption overlay
- Persistent settings (API key saved locally)
- Auto-reconnection on connection loss

## Architecture

```
┌─────────────────────┐    ┌──────────────────┐    ┌─────────────────────────┐
│  Chrome Extension   │───▶│  Local Server    │───▶│  OpenAI API             │
│  - Tab Audio Capture│    │  (Node.js)       │    │  - gpt-4o-transcribe    │
│  - Caption Overlay  │◀───│  - WebSocket     │◀───│  - whisper-1 (translate)│
└─────────────────────┘    └──────────────────┘    └─────────────────────────┘
```

## Prerequisites

- Node.js 18+
- Google Chrome browser
- OpenAI API key with access to:
  - gpt-4o-transcribe (Realtime API)
  - whisper-1 (for translation)

## Setup

### 1. Install Server Dependencies

```bash
cd server
npm install
```

### 2. Start the Server

```bash
npm start
```

The server will start on `ws://localhost:3000`.

### 3. Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension` folder from this project
5. The Live Captions icon should appear in your toolbar

### 4. Configure the Extension

1. Click the Live Captions icon in Chrome toolbar
2. Enter your OpenAI API key
3. Click "Save Key"
4. Select source language (or leave as Auto-detect)
5. Check "Translate to English" if needed

## Usage

1. Navigate to a page with audio/video content
2. Click the Live Captions icon
3. Click "Start Captions"
4. Captions will appear at the bottom of the page
5. Drag the caption box to reposition it
6. Click "Stop" to end captioning

## Modes

### Transcription Mode (Default)
- Uses OpenAI's gpt-4o-transcribe via Realtime API
- Real-time streaming transcription
- Low latency

### Translation Mode
- Enable "Translate to English" checkbox
- Uses whisper-1 /translations endpoint
- 3-second batch processing (higher latency)
- Translates any language to English

## Troubleshooting

### "Connection failed"
- Make sure the server is running (`npm start` in server folder)
- Check that port 3000 is not in use
- Verify the Server URL in extension settings

### No captions appearing
- Check the server console for errors
- Verify your API key is valid
- Make sure audio is playing in the tab

### Poor transcription quality
- Try manually selecting the source language
- Ensure clear audio quality in the source

## API Costs

This extension uses OpenAI's paid APIs:
- **gpt-4o-transcribe**: Charged per audio minute
- **whisper-1**: Charged per audio minute

Check [OpenAI's pricing page](https://openai.com/pricing) for current rates.

## Privacy

- Your API key is stored locally in Chrome's storage
- Audio is sent to OpenAI's servers for processing
- No data is stored on our servers (the local server is just a relay)

## Development

### Extension Structure
```
extension/
├── manifest.json       # Extension config
├── popup/              # Extension popup UI
├── content/            # Caption overlay
├── background/         # Service worker
├── offscreen/          # Audio processing
└── icons/              # Extension icons
```

### Server Structure
```
server/
├── package.json
├── server.js           # WebSocket server
└── .env.example        # Environment template
```

## License

MIT
