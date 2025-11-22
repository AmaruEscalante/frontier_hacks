import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv-flow';
import { Sandbox } from 'e2b';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Store active builds, sandboxes, and Claude sessions
const activeBuilds = new Map();
const activeSandboxes = new Map();
const claudeSessions = new Map(); // Store Claude session info

/**
 * Build an app in an E2B sandbox
 */
async function buildAppInE2B(prompt, onProgress) {
  console.log('='.repeat(80));
  console.log('[E2B] 🏗️  Starting app generation in E2B Sandbox');
  console.log('[E2B] Timestamp:', new Date().toISOString());
  console.log('[E2B] Prompt length:', prompt.length, 'characters');
  console.log('='.repeat(80));

  if (!process.env.E2B_API_KEY || !process.env.REACT_APP_ANTHROPIC_API_KEY) {
    throw new Error('E2B_API_KEY and REACT_APP_ANTHROPIC_API_KEY must be set');
  }

  console.log('[E2B] ✅ API keys found');
  console.log('[E2B] Initializing E2B Sandbox...');

  let sandbox;
  let sandboxId;

  try {
    // Step 1: Create E2B sandbox
    console.log('[E2B] 📦 Step 1: Creating E2B sandbox...');
    onProgress({ type: 'progress', content: 'Creating E2B sandbox...' });

    sandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: 600000, // 10 minutes
    });
    
    sandboxId = sandbox.sandboxId;
    activeSandboxes.set(sandboxId, sandbox);

    console.log('[E2B] ✅ Sandbox created successfully!');
    console.log('[E2B] Sandbox ID:', sandboxId);
    onProgress({ type: 'progress', content: `Sandbox created: ${sandboxId}` });

    const projectDir = '/home/user/app-project';

    // Step 2: Create project directory
    onProgress({ type: 'progress', content: 'Setting up project directory...' });
    await sandbox.commands.run(`mkdir -p ${projectDir}`, { timeoutMs: 30000 });

    // Step 3: Initialize npm project
    onProgress({ type: 'progress', content: 'Initializing npm project...' });
    await sandbox.commands.run(`cd ${projectDir} && npm init -y`, { timeoutMs: 30000 });

    // Step 4: Install Claude Agent SDK
    onProgress({ type: 'progress', content: 'Installing Claude Agent SDK (this may take a minute)...' });
    const installResult = await sandbox.commands.run(
      `cd ${projectDir} && npm install @anthropic-ai/claude-agent-sdk@latest`,
      { timeoutMs: 180000 } // 3 minute timeout
    );

    if (installResult.exitCode !== 0) {
      console.error('[E2B] Install error:', installResult.stderr);
      throw new Error('Failed to install Claude Agent SDK');
    }

    // Step 5: Create generation script
    onProgress({ type: 'progress', content: 'Creating build script...' });

    const generationScript = `import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';

async function generateApp() {
  const prompt = \`${prompt.replace(/`/g, '\\`').replace(/\$/g, '\\$')}

Important requirements:
- Create a simple HTML file (index.html) for demo purposes
- Use inline CSS or a single style tag, keep it simple
- No complicated frameworks or build tools needed
- Just a single HTML file that demonstrates the UI
- Make it visually appealing but keep the code simple
- Focus on UI demo only, no backend or complex functionality.
- use as little code as possible. keep it simple.
\`;

  console.log('Starting app generation with Claude Agent SDK...');
  console.log('Working directory:', process.cwd());

  const messages = [];
  const abortController = new AbortController();

  try {
    for await (const message of query({
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
    })) {
      messages.push(message);

      // Log progress with special markers for parsing
      if (message.type === 'text') {
        console.log('[Claude]:', (message.text || '').substring(0, 80) + '...');
        console.log('__CLAUDE_MESSAGE__', JSON.stringify({ type: 'assistant', content: message.text }));
      } else if (message.type === 'tool_use') {
        console.log('[Tool]:', message.name, message.input?.file_path || '');
        console.log('__TOOL_USE__', JSON.stringify({
          type: 'tool_use',
          name: message.name,
          input: message.input
        }));
      } else if (message.type === 'result') {
        console.log('__TOOL_RESULT__', JSON.stringify({
          type: 'tool_result',
          result: message.result
        }));
      }
    }

    console.log('\\nGeneration complete!');

    // Save generation log
    fs.writeFileSync('generation-log.json', JSON.stringify(messages, null, 2));

  } catch (error) {
    console.error('Generation error:', error);
    process.exit(1);
  }
}

generateApp().catch(console.error);`;

    // Write the script using a command
    const scriptPath = `${projectDir}/generate.mjs`;
    const writeCommand = `cat > ${scriptPath} << 'SCRIPT_EOF'\n${generationScript}\nSCRIPT_EOF`;
    await sandbox.commands.run(writeCommand, { timeoutMs: 30000 });
    console.log('[E2B] ✅ Generation script created');

    // Step 6: Run generation
    onProgress({ type: 'progress', content: 'Running Claude Code generation (this will take several minutes)...' });

    const genResult = await sandbox.commands.run(
      `cd ${projectDir} && ANTHROPIC_API_KEY="${process.env.REACT_APP_ANTHROPIC_API_KEY}" NODE_PATH="${projectDir}/node_modules" node generate.mjs`,
      { timeoutMs: 240000 } // 4 minute timeout
    );

    // Parse generation output for progress messages
    const output = genResult.stdout + '\n' + genResult.stderr;
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.includes('__CLAUDE_MESSAGE__')) {
        try {
          const jsonStart = line.indexOf('{');
          const message = JSON.parse(line.substring(jsonStart));
          if (message.content) {
            onProgress({ type: 'claude_message', content: message.content });
          }
        } catch (e) {
          console.error('[Parse Error] Failed to parse Claude message:', e.message);
        }
      } else if (line.includes('__TOOL_USE__')) {
        try {
          const jsonStart = line.indexOf('{');
          const message = JSON.parse(line.substring(jsonStart));
          if (message.name) {
            onProgress({ type: 'tool_use', content: message });
          }
        } catch (e) {
          console.error('[Parse Error] Failed to parse tool use:', e.message);
        }
      }
    }

    if (genResult.exitCode !== 0) {
      console.error('[E2B] Generation failed with exit code:', genResult.exitCode);
      console.error('[E2B] stderr:', genResult.stderr);
      throw new Error('Generation failed');
    }

    // Step 7: Start simple HTTP server
    onProgress({ type: 'progress', content: 'Starting HTTP server...' });
    
    // Start the server in the background using E2B's background option
    const serverProcess = await sandbox.commands.run(
      `cd ${projectDir} && python3 -m http.server 3000`,
      { 
        background: true,
        onStdout: (data) => console.log('[E2B] Server stdout:', data),
        onStderr: (data) => console.log('[E2B] Server stderr:', data),
      }
    );
    
    console.log('[E2B] HTTP server started in background');

    // Wait for server to start
    onProgress({ type: 'progress', content: 'Waiting for HTTP server to be ready...' });
    console.log('[E2B] Waiting for HTTP server to start...');

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Poll server for up to 60 seconds
    let serverReady = false;
    const maxAttempts = 12;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const checkServer = await sandbox.commands.run(
          "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 || echo 'failed'",
          { timeoutMs: 5000 }
        );

        const statusCode = checkServer.stdout?.trim();
        console.log(`[E2B] Server check attempt ${attempt}/${maxAttempts}: ${statusCode}`);

        if (statusCode === '200') {
          console.log('[E2B] ✓ Server is running!');
          serverReady = true;
          break;
        }

        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (e) {
        console.log(`[E2B] Server check attempt ${attempt} failed:`, e.message);
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }

    if (!serverReady) {
      console.log('[E2B] ⚠️  Server might still be starting...');
      onProgress({ type: 'progress', content: 'Warning: Server may still be initializing' });
    } else {
      onProgress({ type: 'progress', content: 'Server is ready!' });
    }

    // Step 8: Setup persistent Claude session for iterative changes
    onProgress({ type: 'progress', content: 'Setting up persistent Claude session...' });
    console.log('[E2B] Setting up persistent Claude Code session...');

    // Read the persistent script from local file
    const persistentScriptPath = path.join(__dirname, 'claude-persistent.mjs');
    const persistentScript = fs.readFileSync(persistentScriptPath, 'utf-8');

    // Upload persistent script to sandbox
    const persistentScriptRemote = `${projectDir}/claude-persistent.mjs`;
    const uploadCmd = `cat > ${persistentScriptRemote} << 'PERSISTENT_EOF'\n${persistentScript}\nPERSISTENT_EOF`;
    await sandbox.commands.run(uploadCmd, { timeoutMs: 30000 });
    console.log('[E2B] ✅ Persistent Claude script uploaded');

    // Start persistent Claude process in background
    const persistentProcess = await sandbox.commands.run(
      `cd ${projectDir} && ANTHROPIC_API_KEY="${process.env.REACT_APP_ANTHROPIC_API_KEY}" NODE_PATH="${projectDir}/node_modules" node claude-persistent.mjs`,
      {
        background: true,
        onStdout: (data) => console.log('[Claude Persistent]:', data),
        onStderr: (data) => console.error('[Claude Persistent Error]:', data),
      }
    );

    console.log('[E2B] ✅ Persistent Claude session started');

    // Store session info
    claudeSessions.set(sandboxId, {
      processHandle: persistentProcess,
      projectDir: projectDir,
      startTime: Date.now()
    });

    onProgress({ type: 'progress', content: 'Persistent session ready for follow-up changes!' });

    // Step 9: Get preview URL from E2B using getHost()
    onProgress({ type: 'progress', content: 'Getting preview URL...' });
    
    // Use E2B's getHost() method to get the public URL for port 3000
    const host = sandbox.getHost(3000);
    const previewUrl = `https://${host}`;
    
    console.log('[E2B] Preview URL generated:', previewUrl);
    console.log('[E2B] ✅ Preview URL is ready!');

    console.log('='.repeat(80));
    console.log('[E2B] 🎉 Build complete!');
    console.log('[E2B] Preview URL:', previewUrl);
    console.log('[E2B] Sandbox ID:', sandboxId);
    console.log('[E2B] Project directory:', projectDir);
    console.log('[E2B] Persistent session: ACTIVE');
    console.log('='.repeat(80));

    return {
      success: true,
      sandboxId: sandboxId,
      projectDir: projectDir,
      previewUrl: previewUrl,
      persistentSession: true
    };
  } catch (error) {
    console.log('='.repeat(80));
    console.error('[E2B] ❌ Build failed!');
    console.error('[E2B] Error message:', error.message);
    console.error('[E2B] Stack trace:', error.stack);
    console.log('='.repeat(80));
    
    // Clean up sandbox on error
    if (sandbox) {
      try {
        await sandbox.close();
        if (sandboxId) {
          activeSandboxes.delete(sandboxId);
        }
      } catch (cleanupError) {
        console.error('[E2B] Failed to cleanup sandbox:', cleanupError.message);
      }
    }
    
    throw error;
  }
}

/**
 * POST /api/build-app
 * Builds an app in an E2B sandbox and streams progress via SSE
 */
app.post('/api/build-app', async (req, res) => {
  const headerSize = JSON.stringify(req.headers).length;
  console.log('[API] 📊 Request header size:', headerSize, 'bytes');

  req.headers.cookie = '';

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const enhancedPrompt = `make it simple html for demo purposes, not complicated only ui demo\n\n${prompt}`;

  console.log('='.repeat(80));
  console.log('[API] 🎯 Build request received');
  console.log('[API] Timestamp:', new Date().toISOString());
  console.log('[API] Original prompt length:', prompt.length, 'characters');
  console.log('[API] Enhanced prompt length:', enhancedPrompt.length, 'characters');
  console.log('[API] Prompt preview:', enhancedPrompt.substring(0, 150));
  console.log('='.repeat(80));

  req.setTimeout(900000); // 15 minutes

  // Set up Server-Sent Events
  console.log('[API] 📡 Setting up SSE headers');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const buildId = Date.now().toString();
  let sandboxId = null;
  activeBuilds.set(buildId, { prompt: enhancedPrompt, startTime: Date.now() });
  console.log('[API] Build ID:', buildId);

  res.write(`data: ${JSON.stringify({ type: 'connected', buildId: buildId })}\n\n`);

  // Heartbeat
  let lastHeartbeat = Date.now();
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    if (now - lastHeartbeat >= 14000) {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: now })}\n\n`);
      console.log('[Heartbeat] Sent at', new Date(now).toISOString());
      lastHeartbeat = now;
    }
  }, 15000);

  // Progress callback
  const onProgress = (message) => {
    lastHeartbeat = Date.now();

    const contentPreview = typeof message.content === 'string'
      ? message.content.substring(0, 80)
      : JSON.stringify(message.content).substring(0, 80);

    console.log(`[Progress] 📝 ${message.type}:`, contentPreview);
    res.write(`data: ${JSON.stringify(message)}\n\n`);
  };

  // Clean up on client disconnect
  req.on('close', () => {
    console.log('[API] Client disconnected, cleaning up...');
    clearInterval(heartbeatInterval);
    activeBuilds.delete(buildId);
  });

  try {
    console.log('[API] 🚀 Calling buildAppInE2B...');
    const result = await buildAppInE2B(enhancedPrompt, onProgress);

    sandboxId = result.sandboxId;

    res.write(`data: ${JSON.stringify({
      type: 'complete',
      content: 'Build completed successfully!',
      previewUrl: result.previewUrl,
      sandboxId: result.sandboxId
    })}\n\n`);

    res.write('data: [DONE]\n\n');
    res.end();

    clearInterval(heartbeatInterval);
    activeBuilds.delete(buildId);

    console.log(`[API] ✅ Build ${buildId} completed successfully. Sandbox ${sandboxId} is running.`);
    console.log('[API] 💡 TIP: To clean up sandbox later, use: DELETE /api/sandbox/' + sandboxId);
  } catch (error) {
    console.error('[API] Build error:', error);

    res.write(`data: ${JSON.stringify({
      type: 'error',
      content: error.message || 'Build failed'
    })}\n\n`);

    res.write('data: [DONE]\n\n');
    res.end();

    clearInterval(heartbeatInterval);
    activeBuilds.delete(buildId);

    if (sandboxId) {
      console.log(`[API] ⚠️  Build ${buildId} failed. Sandbox ${sandboxId} cleaned up.`);
    }
  }
});

/**
 * GET /api/builds
 * Returns list of active builds
 */
app.get('/api/builds', (req, res) => {
  const builds = Array.from(activeBuilds.entries()).map(([id, data]) => ({
    id,
    prompt: data.prompt.substring(0, 100),
    startTime: data.startTime,
  }));

  res.json({ builds });
});

/**
 * DELETE /api/sandbox/:sandboxId
 * Cleanup an E2B sandbox
 */
app.delete('/api/sandbox/:sandboxId', async (req, res) => {
  const { sandboxId } = req.params;

  if (!sandboxId) {
    return res.status(400).json({ error: 'Sandbox ID is required' });
  }

  console.log(`[API] 🗑️  Cleanup request for sandbox: ${sandboxId}`);

  try {
    const sandbox = activeSandboxes.get(sandboxId);
    
    if (sandbox) {
      await sandbox.close();
      activeSandboxes.delete(sandboxId);
      console.log(`[API] ✅ Sandbox ${sandboxId} removed successfully`);
      res.json({ success: true, message: `Sandbox ${sandboxId} removed` });
    } else {
      res.status(404).json({ error: 'Sandbox not found in active sandboxes' });
    }
  } catch (error) {
    console.error(`[API] ❌ Failed to remove sandbox ${sandboxId}:`, error.message);
    res.status(500).json({
      error: 'Failed to remove sandbox',
      message: error.message
    });
  }
});

/**
 * POST /api/send-message/:sandboxId
 * Send a follow-up message to persistent Claude session
 */
app.post('/api/send-message/:sandboxId', async (req, res) => {
  const { sandboxId } = req.params;
  const { message } = req.body;

  if (!sandboxId || !message) {
    return res.status(400).json({ error: 'sandboxId and message are required' });
  }

  console.log(`[API] 💬 Send message request for sandbox: ${sandboxId}`);
  console.log(`[API] Message: ${message.substring(0, 100)}...`);

  try {
    const sandbox = activeSandboxes.get(sandboxId);
    
    if (!sandbox) {
      return res.status(404).json({ error: 'Sandbox not found' });
    }

    // Append message to command file (the persistent script watches this)
    const command = JSON.stringify({ prompt: message, timestamp: Date.now() });
    const result = await sandbox.commands.run(
      `echo '${command}' >> /tmp/claude-commands.txt`,
      { timeoutMs: 5000 }
    );

    if (result.exitCode !== 0) {
      throw new Error('Failed to write command to sandbox');
    }

    console.log(`[API] ✅ Message queued for sandbox ${sandboxId}`);
    res.json({ success: true, message: 'Message queued for processing' });
  } catch (error) {
    console.error(`[API] ❌ Failed to send message to sandbox ${sandboxId}:`, error.message);
    res.status(500).json({
      error: 'Failed to send message',
      message: error.message
    });
  }
});

/**
 * GET /api/watch/:sandboxId
 * Watch for file changes and stream updates via SSE
 */
app.get('/api/watch/:sandboxId', async (req, res) => {
  const { sandboxId } = req.params;

  console.log(`[API] 👀 Watch request for sandbox: ${sandboxId}`);

  const sandbox = activeSandboxes.get(sandboxId);
  
  if (!sandbox) {
    return res.status(404).json({ error: 'Sandbox not found' });
  }

  // Set up Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write(`data: ${JSON.stringify({ type: 'connected', sandboxId })}\n\n`);

  let lastResponseSize = 0;
  let lastHtmlContent = '';
  let watchActive = true;

  // Watch for changes
  const watchInterval = setInterval(async () => {
    if (!watchActive) {
      clearInterval(watchInterval);
      return;
    }

    try {
      // Check for new Claude responses
      const responseCheck = await sandbox.commands.run(
        'wc -l /tmp/claude-responses.jsonl 2>/dev/null || echo "0"',
        { timeoutMs: 3000 }
      );

      const currentResponseSize = parseInt(responseCheck.stdout?.trim() || '0');

      if (currentResponseSize > lastResponseSize) {
        // Read new responses
        const tailCmd = `tail -n ${currentResponseSize - lastResponseSize} /tmp/claude-responses.jsonl`;
        const newResponses = await sandbox.commands.run(tailCmd, { timeoutMs: 3000 });

        if (newResponses.stdout) {
          const lines = newResponses.stdout.trim().split('\n');
          for (const line of lines) {
            try {
              const response = JSON.parse(line);
              res.write(`data: ${JSON.stringify({ type: 'claude_response', data: response })}\n\n`);
            } catch (e) {
              console.error('[Watch] Failed to parse response:', e.message);
            }
          }
        }

        lastResponseSize = currentResponseSize;
      }

      // Check for HTML file changes
      const htmlCheck = await sandbox.commands.run(
        'cat /home/user/app-project/index.html 2>/dev/null || echo ""',
        { timeoutMs: 3000 }
      );

      const currentHtml = htmlCheck.stdout || '';

      if (currentHtml && currentHtml !== lastHtmlContent) {
        console.log('[Watch] HTML file changed, notifying client');
        res.write(`data: ${JSON.stringify({ 
          type: 'file_change', 
          file: 'index.html',
          timestamp: Date.now()
        })}\n\n`);
        lastHtmlContent = currentHtml;
      }

    } catch (error) {
      if (error.message.includes('abort')) {
        console.log('[Watch] Watch aborted');
        watchActive = false;
      } else {
        console.error('[Watch] Error:', error.message);
      }
    }
  }, 2000); // Check every 2 seconds

  // Clean up on client disconnect
  req.on('close', () => {
    console.log('[API] Watch client disconnected');
    watchActive = false;
    clearInterval(watchInterval);
  });
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    activeBuilds: activeBuilds.size,
    activeSandboxes: activeSandboxes.size,
    claudeSessions: claudeSessions.size,
    provider: 'E2B'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🎤 Vibes Server running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log(`🔨 Build endpoint: POST http://localhost:${PORT}/api/build-app`);
  console.log(`🚀 Using E2B for sandbox environments\n`);
});
