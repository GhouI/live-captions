import { WebSocketServer, WebSocket } from 'ws';
import { config } from 'dotenv';
import OpenAI from 'openai';
import { Readable } from 'stream';

config();

const PORT = process.env.PORT || 3000;

// Create WebSocket server for extension connections
const wss = new WebSocketServer({ port: PORT });

console.log(`Live Captions server running on ws://localhost:${PORT}`);

wss.on('connection', (clientWs) => {
  console.log('Extension connected');

  let openaiWs = null;
  let openaiClient = null;
  let clientConfig = null;
  let audioChunks = [];
  let translationTimer = null;
  const TRANSLATION_INTERVAL = 3000; // 3 seconds for batch translation

  // Handle messages from extension
  clientWs.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'config') {
        clientConfig = {
          apiKey: message.apiKey,
          sourceLanguage: message.sourceLanguage || 'auto',
          translateToEnglish: message.translateToEnglish || false
        };

        console.log('Received config:', {
          sourceLanguage: clientConfig.sourceLanguage,
          translateToEnglish: clientConfig.translateToEnglish
        });

        // Create OpenAI client for translations
        openaiClient = new OpenAI({ apiKey: clientConfig.apiKey });

        if (clientConfig.translateToEnglish) {
          // Use batch translation mode with whisper-1
          console.log('Translation mode: Using whisper-1 for translation to English');
          startTranslationMode(clientWs, clientConfig, openaiClient, audioChunks);
        } else {
          // Use real-time transcription mode with gpt-4o-transcribe
          console.log('Transcription mode: Using gpt-4o-transcribe for real-time transcription');
          openaiWs = await connectToOpenAI(clientConfig, clientWs);
        }
      }

      if (message.type === 'audio') {
        if (clientConfig?.translateToEnglish) {
          // Buffer audio for batch translation
          const audioData = Buffer.from(message.data, 'base64');
          audioChunks.push(audioData);
        } else if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
          // Forward audio to OpenAI Realtime API
          openaiWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: message.data
          }));
        }
      }
    } catch (error) {
      console.error('Error processing message:', error);
      clientWs.send(JSON.stringify({
        type: 'error',
        error: error.message
      }));
    }
  });

  clientWs.on('close', () => {
    console.log('Extension disconnected');
    if (openaiWs) {
      openaiWs.close();
    }
    if (translationTimer) {
      clearInterval(translationTimer);
    }
    audioChunks = [];
  });

  clientWs.on('error', (error) => {
    console.error('Client WebSocket error:', error);
  });

  // Start translation mode with periodic batch processing
  function startTranslationMode(clientWs, config, openai, chunks) {
    translationTimer = setInterval(async () => {
      if (chunks.length === 0) return;

      // Get and clear buffer
      const audioData = Buffer.concat(chunks);
      chunks.length = 0;

      // Skip if too small (less than 0.5 seconds of audio at 24kHz 16-bit)
      if (audioData.length < 24000) return;

      try {
        // Convert PCM16 to WAV format
        const wavBuffer = pcm16ToWav(audioData, 24000);

        // Create a File-like object for the API
        const audioFile = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' });

        // Call whisper-1 translations endpoint
        const response = await openai.audio.translations.create({
          file: audioFile,
          model: 'whisper-1',
          response_format: 'text'
        });

        if (response && response.trim()) {
          clientWs.send(JSON.stringify({
            type: 'transcription',
            text: response.trim(),
            isFinal: true
          }));
        }
      } catch (error) {
        console.error('Translation error:', error.message);
        // Don't send error to client for every translation failure
        // Just log it
      }
    }, TRANSLATION_INTERVAL);
  }
});

// Connect to OpenAI Realtime API for transcription
async function connectToOpenAI(config, clientWs) {
  return new Promise((resolve, reject) => {
    const url = 'wss://api.openai.com/v1/realtime?intent=transcription';

    const ws = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    ws.on('open', () => {
      console.log('Connected to OpenAI Realtime API');

      // Configure transcription session
      const sessionConfig = {
        type: 'transcription_session.update',
        session: {
          input_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'gpt-4o-transcribe'
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500
          }
        }
      };

      // Set language if not auto
      if (config.sourceLanguage && config.sourceLanguage !== 'auto') {
        sessionConfig.session.input_audio_transcription.language = config.sourceLanguage;
      }

      ws.send(JSON.stringify(sessionConfig));
      resolve(ws);
    });

    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());

        // Handle different event types
        switch (event.type) {
          case 'transcription_session.created':
            console.log('Transcription session created');
            break;

          case 'transcription_session.updated':
            console.log('Transcription session configured');
            break;

          case 'conversation.item.input_audio_transcription.delta':
            // Incremental transcription
            if (event.delta) {
              clientWs.send(JSON.stringify({
                type: 'transcription',
                text: event.delta,
                isFinal: false
              }));
            }
            break;

          case 'conversation.item.input_audio_transcription.completed':
            // Final transcription
            if (event.transcript) {
              clientWs.send(JSON.stringify({
                type: 'transcription',
                text: event.transcript,
                isFinal: true
              }));
            }
            break;

          case 'input_audio_buffer.speech_started':
            console.log('Speech detected');
            break;

          case 'input_audio_buffer.speech_stopped':
            console.log('Speech ended');
            break;

          case 'error':
            console.error('OpenAI error:', event.error);
            clientWs.send(JSON.stringify({
              type: 'error',
              error: event.error?.message || 'OpenAI API error'
            }));
            break;

          default:
            // Log unknown events for debugging
            if (event.type && !event.type.startsWith('session.')) {
              console.log('Event:', event.type);
            }
        }
      } catch (error) {
        console.error('Error parsing OpenAI message:', error);
      }
    });

    ws.on('error', (error) => {
      console.error('OpenAI WebSocket error:', error.message);
      clientWs.send(JSON.stringify({
        type: 'error',
        error: 'Failed to connect to OpenAI: ' + error.message
      }));
      reject(error);
    });

    ws.on('close', (code, reason) => {
      console.log('OpenAI connection closed:', code, reason.toString());
    });
  });
}

// Convert PCM16 to WAV format
function pcm16ToWav(pcmData, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const buffer = Buffer.alloc(fileSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Copy PCM data
  pcmData.copy(buffer, 44);

  return buffer;
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  wss.close(() => {
    process.exit(0);
  });
});
