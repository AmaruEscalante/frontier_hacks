import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveAPIContext } from '../contexts/LiveAPIContext';
import LovableBuilder from './lovable/LovableBuilder';
import './VibesApp.scss';

const SYSTEM_INSTRUCTION = `You are an AI assistant that helps users build web applications through voice and video conversation.

Your capabilities:
- You can see the user through their camera/webcam - you have access to live video feed
- You can see paper mockups, sketches, whiteboards, or screen shares that users show you
- You can build complete web applications using a two-step process
- You can make iterative changes to existing apps using sendMessage

When you can see the user's video:
- Acknowledge what you see in the video feed
- Describe mockups, sketches, or designs they show you
- Use the visual information to better understand their requirements

IMPORTANT: Build process requires 2 steps:

Step 1 - When user asks to build something NEW:
- IMMEDIATELY call buildApp(description) with a detailed description
- This will show a confirmation screen to the user
- Then say: "I've prepared the build request. Please say 'yes' or 'confirm' to start building."
- DO NOT wait for confirmation before calling buildApp - call it right away!

Step 2 - When user confirms:
- When you hear "yes", "confirm", "start", "go ahead", "sure", "okay", or "ok"
- IMMEDIATELY call confirmBuild() to start the actual build
- Then say: "Starting the build now!"

ITERATIVE CHANGES - After an app is built:
- When user requests changes like "make it blue", "add a button", "change the layout"
- IMMEDIATELY call sendMessage(message) with the change request
- This will update the existing app WITHOUT rebuilding from scratch
- The preview will automatically refresh with the changes
- Example: User says "change the background to blue" → Call sendMessage("Change the background color to blue")

Function usage:
- buildApp(description): Call this IMMEDIATELY when user wants to build something NEW
  - Include detailed description with features and design preferences
  - This function just prepares the build - it doesn't start it yet
  - If they showed you a mockup or design, reference what you saw in the description

- confirmBuild(): Call this when you hear confirmation words from the user
  - This actually starts the build process

- sendMessage(message): Call this for CHANGES to an existing app
  - Use when user wants to modify, update, or tweak the current app
  - The message should be a clear instruction for what to change
  - NO confirmation needed - changes happen immediately

Response style:
- Be direct and concise
- Get to the point quickly
- Avoid unnecessary pleasantries or filler words
- When you see something in the video, mention it briefly`;

const VibesApp: React.FC = () => {
  const { client, setConfig, setModel, connected } = useLiveAPIContext();

  const [buildRequest, setBuildRequest] = useState<{
    description: string;
    callId: string;
  } | null>(null);

  const [buildStatus, setBuildStatus] = useState<'idle' | 'pending_confirmation' | 'building' | 'complete'>('idle');
  const [confirmationStartTime, setConfirmationStartTime] = useState<number | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const buildRequestRef = useRef(buildRequest);
  const buildStatusRef = useRef(buildStatus);
  const confirmationStartTimeRef = useRef(confirmationStartTime);

  useEffect(() => {
    buildRequestRef.current = buildRequest;
  }, [buildRequest]);

  useEffect(() => {
    buildStatusRef.current = buildStatus;
  }, [buildStatus]);

  useEffect(() => {
    confirmationStartTimeRef.current = confirmationStartTime;
  }, [confirmationStartTime]);

  // Handle buildApp function calls from Gemini
  useEffect(() => {
    if (!client) return;

    const handleToolCall = (toolCall: any) => {
      console.log('[VibesApp] Received tool call:', toolCall);

      const functionCalls = toolCall.functionCalls || [];

      for (const fc of functionCalls) {
        if (fc.name === 'buildApp') {
          const description = fc.args?.description || '';
          console.log('[VibesApp] buildApp requested:', description);

          // Set pending confirmation state
          setBuildStatus('pending_confirmation');
          setBuildRequest({
            description,
            callId: fc.id,
          });
          // Set timestamp to filter out old transcriptions
          setConfirmationStartTime(Date.now());

          // Send response back to Gemini asking for user confirmation
          client.sendToolResponse({
            functionResponses: [{
              id: fc.id,
              name: 'buildApp',
              response: {
                status: 'pending_confirmation',
                message: 'Build request received. Awaiting user confirmation to proceed.',
              },
            }],
          });
        } else if (fc.name === 'confirmBuild') {
          console.log('='.repeat(80));
          console.log('[VibesApp] 🎤 confirmBuild called - User confirmed via voice!');
          console.log('[VibesApp] Build request:', buildRequestRef.current);
          console.log('[VibesApp] Changing status from pending_confirmation -> building');
          console.log('='.repeat(80));

          // Trigger the build
          setBuildStatus('building');

          // Send success response back to Gemini
          client.sendToolResponse({
            functionResponses: [{
              id: fc.id,
              name: 'confirmBuild',
              response: {
                status: 'confirmed',
                message: 'Build started successfully!',
              },
            }],
          });
        } else if (fc.name === 'sendMessage') {
          const message = fc.args?.message || '';
          console.log('='.repeat(80));
          console.log('[VibesApp] 💬 sendMessage called - Iterative change requested!');
          console.log('[VibesApp] Message:', message);
          console.log('[VibesApp] Current session ID:', currentSessionId);
          console.log('='.repeat(80));

          if (!currentSessionId) {
            console.error('[VibesApp] ❌ No active session found');
            client.sendToolResponse({
              functionResponses: [{
                id: fc.id,
                name: 'sendMessage',
                response: {
                  status: 'error',
                  message: 'No active build found. Please build an app first.',
                },
              }],
            });
            return;
          }

          // Trigger build status to show the LovableBuilder UI
          setBuildStatus('building');
          
          // The LovableBuilder will handle the actual request using its stored session ID
          // We need to pass the message as a build request
          setBuildRequest({
            description: message,
            callId: fc.id,
          });

          // Send immediate success response to Gemini
          client.sendToolResponse({
            functionResponses: [{
              id: fc.id,
              name: 'sendMessage',
              response: {
                status: 'success',
                message: 'Sending change request to Claude Code. The preview will update automatically when ready.',
              },
            }],
          });
        }
      }
    };

    client.on('toolcall', handleToolCall);

    return () => {
      client.off('toolcall', handleToolCall);
    };
  }, [client, currentSessionId]);

  // Listen for user voice confirmation via inputTranscription
  useEffect(() => {
    if (!client) return;

    const handleContent = (content: any) => {
      // Check for user's transcribed voice input (this is where the user's speech appears!)
      const userTranscript = content.inputTranscription?.text?.toLowerCase() || '';
      const isFinished = content.inputTranscription?.finished;

      // Only process complete transcriptions to avoid partial matches
      if (isFinished && userTranscript && buildRequestRef.current && buildStatusRef.current === 'pending_confirmation') {
        // CRITICAL: Only process transcriptions that came AFTER confirmation window appeared
        // This prevents the original build request (e.g., "Yes, build me a todo app") from triggering confirmation
        if (!confirmationStartTimeRef.current) {
          return; // No timestamp set, ignore this transcription
        }

        const timeSinceConfirmation = Date.now() - confirmationStartTimeRef.current;
        if (timeSinceConfirmation < 500) {
          // Wait at least 500ms to ensure UI has rendered and user has time to see it
          console.log('[VibesApp] ⏱️  Ignoring transcription - too soon after confirmation request:', timeSinceConfirmation, 'ms');
          return;
        }

        // Check if user said confirmation words
        if (userTranscript.includes('yes') ||
            userTranscript.includes('confirm') ||
            userTranscript.includes('start') ||
            userTranscript.includes('go ahead') ||
            userTranscript.includes('sure') ||
            userTranscript.includes('okay') ||
            userTranscript.includes('ok')) {
          console.log('='.repeat(80));
          console.log('[VibesApp] 🎤 Voice confirmation detected in inputTranscription!');
          console.log('[VibesApp] User said:', userTranscript);
          console.log('[VibesApp] Time since confirmation:', timeSinceConfirmation, 'ms');
          console.log('[VibesApp] Build request:', buildRequestRef.current);
          console.log('[VibesApp] Changing status from pending_confirmation -> building');
          console.log('='.repeat(80));
          setBuildStatus('building');
        }
      }
    };

    client.on('content', handleContent);

    return () => {
      client.off('content', handleContent);
    };
  }, [client]);

  // Configure Gemini with system instruction and function declarations
  useEffect(() => {
    if (!client || !connected) return;

    // Set the model separately
    setModel('gemini-2.5-flash-native-audio-preview-09-2025');

    const config: any = {
      responseModalities: 'audio',
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
      },
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }],
      },
      tools: [
        {
          functionDeclarations: [
            {
              name: 'buildApp',
              description: 'Call this IMMEDIATELY when user wants to build an app. This prepares the build and shows a confirmation screen - it does NOT start the build yet.',
              parameters: {
                type: 'object',
                properties: {
                  description: {
                    type: 'string',
                    description: 'Detailed description of the application to build, including features, design preferences, and any specific requirements',
                  },
                },
                required: ['description'],
              },
            },
            {
              name: 'confirmBuild',
              description: 'Call this function when the user confirms they want to start the build by saying "yes", "confirm", "start", or similar affirmative words.',
              parameters: {
                type: 'object',
                properties: {},
              },
            },
            {
              name: 'sendMessage',
              description: 'Send a message to make iterative changes to the existing app. Use this when user requests modifications like changing colors, adding features, or updating the layout. NO confirmation needed.',
              parameters: {
                type: 'object',
                properties: {
                  message: {
                    type: 'string',
                    description: 'The change request or instruction for modifying the existing app',
                  },
                },
                required: ['message'],
              },
            },
          ],
        },
      ],
    };

    console.log('[VibesApp] Sending config to Gemini:', config);
    setConfig(config as any);
  }, [client, connected, setConfig, setModel]);

  const handleBuildComplete = useCallback((sessionId?: string) => {
    setBuildStatus('complete');
    setConfirmationStartTime(null); // Reset timestamp
    
    if (sessionId) {
      console.log('[VibesApp] 📦 Storing session ID for iterative changes:', sessionId);
      setCurrentSessionId(sessionId);
    }
  }, []);

  const handleBuildError = useCallback(() => {
    setBuildStatus('idle');
    setBuildRequest(null);
    setConfirmationStartTime(null); // Reset timestamp
    // Could send error message back to Gemini
  }, []);

  const handleManualConfirm = useCallback(() => {
    console.log('='.repeat(80));
    console.log('[VibesApp] 🎯 Manual confirmation triggered');
    console.log('[VibesApp] Build request:', buildRequest);
    console.log('[VibesApp] Changing status from pending_confirmation -> building');
    console.log('='.repeat(80));
    setBuildStatus('building');
  }, [buildRequest]);

  return (
    <div className="vibes-app">
      <LovableBuilder
        buildRequest={buildRequest}
        buildStatus={buildStatus}
        onBuildComplete={handleBuildComplete}
        onBuildError={handleBuildError}
        onManualConfirm={handleManualConfirm}
      />
    </div>
  );
};

export default VibesApp;
