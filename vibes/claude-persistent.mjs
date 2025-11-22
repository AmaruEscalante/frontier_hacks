/**
 * Persistent Claude Code session script
 * This runs inside the E2B sandbox and maintains a Claude session for iterative changes
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';
import { createInterface } from 'readline';

const COMMAND_FILE = '/tmp/claude-commands.txt';
const RESPONSE_FILE = '/tmp/claude-responses.jsonl';
const SESSION_FILE = '/tmp/claude-session.json';

let sessionId = null;
let conversationHistory = [];

// Ensure command file exists
if (!fs.existsSync(COMMAND_FILE)) {
  fs.writeFileSync(COMMAND_FILE, '');
}

console.log('[Claude Persistent] Starting persistent Claude Code session...');
console.log('[Claude Persistent] Command file:', COMMAND_FILE);
console.log('[Claude Persistent] Response file:', RESPONSE_FILE);

// Function to process a prompt
async function processPrompt(prompt) {
  console.log('[Claude Persistent] Processing prompt:', prompt.substring(0, 100));
  
  const abortController = new AbortController();
  const messages = [];

  try {
    const queryOptions = {
      prompt: prompt,
      abortController: abortController,
      options: {
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        maxTurns: 20,
        allowedTools: [
          'Read',
          'Write',
          'Edit',
          'MultiEdit',
          'Bash',
          'LS',
          'Glob',
          'Grep'
        ]
      }
    };

    // Resume session if we have a sessionId
    if (sessionId) {
      queryOptions.options.resume = sessionId;
      console.log('[Claude Persistent] Resuming session:', sessionId);
    }

    for await (const message of query(queryOptions)) {
      messages.push(message);

      // Capture session ID from init message
      if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
        sessionId = message.session_id;
        console.log('[Claude Persistent] Session ID:', sessionId);
        
        // Save session info
        fs.writeFileSync(SESSION_FILE, JSON.stringify({
          sessionId: sessionId,
          timestamp: new Date().toISOString()
        }));
      }

      // Write responses to file for monitoring
      const response = {
        type: message.type,
        timestamp: new Date().toISOString(),
        data: message
      };

      fs.appendFileSync(RESPONSE_FILE, JSON.stringify(response) + '\n');

      // Log progress
      if (message.type === 'text') {
        console.log('[Claude]:', (message.text || '').substring(0, 80) + '...');
      } else if (message.type === 'tool_use') {
        console.log('[Tool]:', message.name, message.input?.file_path || '');
      }
    }

    conversationHistory.push({ prompt, messages });
    console.log('[Claude Persistent] Prompt processed successfully');
    
    return { success: true, sessionId };
  } catch (error) {
    console.error('[Claude Persistent] Error:', error.message);
    return { success: false, error: error.message };
  }
}

// Watch command file for new prompts
console.log('[Claude Persistent] Watching for commands...');

let lastProcessedLine = 0;
let isProcessing = false;

setInterval(async () => {
  if (isProcessing) {
    console.log('[Claude Persistent] Still processing previous command, skipping...');
    return;
  }

  try {
    const content = fs.readFileSync(COMMAND_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    
    if (lines.length > lastProcessedLine) {
      const newLine = lines[lastProcessedLine];
      
      try {
        const command = JSON.parse(newLine);
        
        if (command.prompt) {
          console.log('[Claude Persistent] New command received');
          isProcessing = true;
          await processPrompt(command.prompt);
          lastProcessedLine++;
          isProcessing = false;
        }
      } catch (parseError) {
        console.error('[Claude Persistent] Failed to parse command:', parseError.message);
        lastProcessedLine++; // Skip bad line
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[Claude Persistent] Watch error:', error.message);
    }
  }
}, 2000); // Check every 2 seconds

// Keep process alive
process.on('SIGTERM', () => {
  console.log('[Claude Persistent] Shutting down...');
  process.exit(0);
});

console.log('[Claude Persistent] Ready for commands (Ctrl+C to exit)');
