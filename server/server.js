import { WebSocketServer, WebSocket } from 'ws';
import { config } from 'dotenv';

config();

const PORT = process.env.PORT || 3000;

// Create WebSocket server for extension connections
const wss = new WebSocketServer({ port: PORT });

console.log(`Live Captions server running on ws://localhost:${PORT}`);

wss.on('connection', (clientWs) => {
  console.log('Extension connected');

  let openaiWs = null;
  let clientConfig = null;
  let audioBuffer = [];

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

        // Connect to OpenAI Realtime API
        openaiWs = await connectToOpenAI(clientConfig, clientWs);
      }

      if (message.type === 'audio' && openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        // Forward audio to OpenAI
        openaiWs.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: message.data
        }));
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
  });

  clientWs.on('error', (error) => {
    console.error('Client WebSocket error:', error);
  });
});

// Connect to OpenAI Realtime API
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

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  wss.close(() => {
    process.exit(0);
  });
});
