# Claude Code FastAPI - API Documentation

Complete guide for integrating the Claude Code streaming API with your frontend.

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Endpoint Reference](#endpoint-reference)
- [Request Format](#request-format)
- [Response Format](#response-format)
- [Session Management](#session-management)
- [Event Types](#event-types)
- [Frontend Integration Examples](#frontend-integration-examples)
- [Error Handling](#error-handling)

---

## 🚀 Quick Start

**Base URL:** `http://localhost:8000`

**Endpoint:** `POST /chat`

**Content-Type:** `application/json`

**Response Type:** Server-Sent Events (SSE) / `text/event-stream`

---

## 📡 Endpoint Reference

### POST /chat

Start a new conversation with Claude Code.

**URL:** `/chat`

**Method:** `POST`

**Request Body:**
```json
{
  "prompt": "your prompt here",
  "repo": "https://github.com/user/repo"  // optional
}
```

**Response:** SSE stream of events

---

### POST /chat/{session_id}

Continue an existing conversation.

**URL:** `/chat/{session_id}`

**Method:** `POST`

**Path Parameter:**
- `session_id` - The session ID from a previous request

**Request Body:**
```json
{
  "prompt": "follow-up question or instruction"
}
```

**Response:** SSE stream of events

---

## 📝 Request Format

### Basic Request

```json
{
  "prompt": "create a hello world html file"
}
```

### With Repository Clone

```json
{
  "prompt": "add tests to this project",
  "repo": "https://github.com/username/repository"
}
```

---

## 📥 Response Format

The API streams events in **Server-Sent Events (SSE)** format. Each event is a JSON object prefixed with `data: `.

### Event Structure

```
data: {"type": "event_type", ...other fields}

```

Events arrive in real-time as Claude works!

---

## 🎯 Event Types

### 1. Status Events

Track the progress of your request.

```json
// Initializing
data: {"type": "status", "status": "initializing"}

// Creating sandbox
data: {"type": "status", "status": "creating_sandbox"}

// Sandbox ready
data: {
  "type": "status",
  "status": "sandbox_ready",
  "sandbox_id": "abc123xyz"
}

// Configuring MCP
data: {"type": "status", "status": "configuring_mcp"}

// Executing
data: {"type": "status", "status": "executing"}
```

### 2. MCP Configuration

Shows which MCP tools are enabled.

```json
data: {
  "type": "mcp_configured",
  "mcp_enabled": ["context7", "exa"],
  "mcp_gateway_url": "https://50005-sandbox.e2b.app/mcp"
}
```

### 3. Port Exposure

URLs for accessing web apps created in the sandbox.

```json
data: {
  "type": "ports",
  "exposed_urls": {
    "3000": "https://3000-sandbox.e2b.app",
    "5173": "https://5173-sandbox.e2b.app",
    "8000": "https://8000-sandbox.e2b.app",
    "8080": "https://8080-sandbox.e2b.app",
    "4200": "https://4200-sandbox.e2b.app"
  }
}
```

### 4. System Events

Sandbox and tool initialization info.

```json
data: {
  "type": "system",
  "data": {
    "type": "system",
    "subtype": "init",
    "cwd": "/home/user",
    "session_id": "session-uuid",
    "tools": ["Task", "Bash", "Read", "Write", ...],
    "mcp_servers": [{"name": "e2b-mcp-gateway", "status": "connected"}],
    "model": "claude-sonnet-4-5-20250929"
  }
}
```

### 5. Text Deltas (Realtime Streaming!) ⭐

**Most important for UI updates** - Claude's response streaming word-by-word.

```json
// Each chunk of text arrives separately in real-time
data: {"type": "text_delta", "text": "I'll create a"}
data: {"type": "text_delta", "text": " simple HTML"}
data: {"type": "text_delta", "text": " file for you."}
```

**Frontend Action:** Append each `text` value to your display in real-time for a ChatGPT-like streaming effect!

### 6. Claude Events

Internal Claude Code events.

```json
data: {"type": "claude_event", "event_type": "message_start"}
data: {"type": "claude_event", "event_type": "message_stop"}
data: {"type": "claude_event", "event_type": "content_block_start"}
```

### 7. Result Event

Final result with complete information.

```json
data: {
  "type": "result",
  "result": {
    "type": "result",
    "subtype": "success",
    "is_error": false,
    "duration_ms": 7962,
    "num_turns": 4,
    "result": "I've created a simple HTML file...",
    "session_id": "72d712bc-102f-418a-898d-bbed8983f4ac",
    "total_cost_usd": 0.02368965,
    "usage": {
      "input_tokens": 5,
      "output_tokens": 219,
      "cache_read_input_tokens": 27238
    }
  }
}
```

### 8. Complete Event ⭐

**Save this for session continuity!**

```json
data: {
  "type": "complete",
  "exit_code": 0,
  "session_id": "72d712bc-102f-418a-898d-bbed8983f4ac",  // ⭐ SAVE THIS
  "sandbox_id": "abc123",
  "exposed_urls": {...},
  "mcp_enabled": ["context7"],
  "mcp_gateway_url": "https://..."
}
```

### 9. Done Event

Stream completed.

```json
data: {"type": "done"}
```

---

## 🔄 Session Management

### How Sessions Work

1. **First Request** → Creates new session, returns `session_id`
2. **Follow-up Requests** → Use `session_id` to continue conversation
3. **Context Preserved** → Claude remembers everything from the session

### Step-by-Step Guide

#### Step 1: Start New Session

```bash
curl -N -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Please remember this number: 42"}'
```

#### Step 2: Extract session_id

From the response stream, look for the `"complete"` event:

```json
data: {
  "type": "complete",
  "session_id": "72d712bc-102f-418a-898d-bbed8983f4ac"  // ⭐ SAVE THIS
}
```

#### Step 3: Continue Session

```bash
curl -N -X POST http://localhost:8000/chat/72d712bc-102f-418a-898d-bbed8983f4ac \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What number did I ask you to remember?"}'
```

**Result:** Claude responds with "42" ✅

---

## 💻 Frontend Integration Examples

### React + EventSource

```typescript
import { useState, useEffect } from 'react';

function ChatComponent() {
  const [messages, setMessages] = useState<string>('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const sendMessage = async (prompt: string) => {
    setIsStreaming(true);
    setMessages(''); // Clear for new response
    
    // Build URL with session if available
    const url = sessionId 
      ? `http://localhost:8000/chat/${sessionId}`
      : 'http://localhost:8000/chat';
    
    // Use fetch for SSE
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          
          // Handle text deltas - streaming text!
          if (data.type === 'text_delta') {
            setMessages(prev => prev + data.text);
          }
          
          // Save session ID for continuity
          if (data.type === 'complete' && data.session_id) {
            setSessionId(data.session_id);
          }
          
          // Stream complete
          if (data.type === 'done') {
            setIsStreaming(false);
          }
        }
      }
    }
  };
  
  return (
    <div>
      <div className="messages">
        {messages}
        {isStreaming && <span className="cursor">▊</span>}
      </div>
      <input 
        onKeyPress={(e) => {
          if (e.key === 'Enter') {
            sendMessage(e.currentTarget.value);
          }
        }}
      />
      {sessionId && <p>Session: {sessionId}</p>}
    </div>
  );
}
```

### JavaScript + EventSource API

```javascript
function streamChat(prompt, sessionId = null) {
  const url = sessionId 
    ? `http://localhost:8000/chat/${sessionId}`
    : 'http://localhost:8000/chat';
  
  // EventSource doesn't support POST, so use fetch
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  }).then(response => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    return reader.read().then(function processText({ done, value }) {
      if (done) return;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      lines.forEach(line => {
        if (line.startsWith('data: ')) {
          const event = JSON.parse(line.slice(6));
          
          switch(event.type) {
            case 'text_delta':
              // Append to UI in real-time!
              appendToChat(event.text);
              break;
              
            case 'complete':
              // Save session for next request
              saveSessionId(event.session_id);
              break;
              
            case 'ports':
              // Show exposed URLs
              displayPortUrls(event.exposed_urls);
              break;
          }
        }
      });
      
      return reader.read().then(processText);
    });
  });
}
```

### Vue.js Example

```vue
<template>
  <div class="chat">
    <div class="messages">
      <div class="message" v-html="currentMessage"></div>
    </div>
    <input 
      v-model="userInput" 
      @keyup.enter="sendMessage"
      :disabled="isStreaming"
    />
    <div v-if="sessionId">Session: {{ sessionId }}</div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const currentMessage = ref('');
const sessionId = ref(null);
const isStreaming = ref(false);
const userInput = ref('');

async function sendMessage() {
  if (!userInput.value.trim()) return;
  
  isStreaming.value = true;
  currentMessage.value = '';
  
  const url = sessionId.value
    ? `http://localhost:8000/chat/${sessionId.value}`
    : 'http://localhost:8000/chat';
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: userInput.value })
  });
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const event = JSON.parse(line.slice(6));
        
        if (event.type === 'text_delta') {
          currentMessage.value += event.text;
        }
        
        if (event.type === 'complete') {
          sessionId.value = event.session_id;
          isStreaming.value = false;
        }
      }
    }
  }
  
  userInput.value = '';
}
</script>
```

---

## ❌ Error Handling

### Error Event

```json
data: {
  "type": "error",
  "error": "Error message here"
}
```

### Common Errors

1. **Missing API Keys**
   - Error: "ANTHROPIC_API_KEY not set"
   - Solution: Set environment variable

2. **Invalid Session ID**
   - Error: Session not found
   - Solution: Start new session

3. **Timeout**
   - Error: Command timeout
   - Solution: Retry or break into smaller requests

### Frontend Error Handling Example

```typescript
for (const line of lines) {
  if (line.startsWith('data: ')) {
    const event = JSON.parse(line.slice(6));
    
    if (event.type === 'error') {
      console.error('API Error:', event.error);
      showErrorToUser(event.error);
      setIsStreaming(false);
      return;
    }
  }
}
```

---

## 🎨 UI/UX Best Practices

### 1. Show Streaming Status

```typescript
// Show different states
if (status === 'creating_sandbox') {
  showSpinner('Creating sandbox...');
} else if (status === 'executing') {
  showSpinner('Claude is thinking...');
}
```

### 2. Display Text Deltas with Cursor

```css
.streaming-cursor {
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
```

```typescript
if (isStreaming) {
  return <span>{message}<span className="streaming-cursor">▊</span></span>;
}
```

### 3. Show Exposed URLs as Links

```typescript
if (event.type === 'ports' && event.exposed_urls) {
  Object.entries(event.exposed_urls).forEach(([port, url]) => {
    displayLink(`Port ${port}`, url);
  });
}
```

### 4. Track Cost (Optional)

```typescript
if (event.type === 'result') {
  const cost = event.result.total_cost_usd;
  updateCostDisplay(cost);
}
```

---

## 🔧 Configuration

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=your_key_here
E2B_API_KEY=your_key_here

# Optional MCP integrations
CONTEXT7_API_KEY=your_key
EXA_API_KEY=your_key
BROWSERBASE_API_KEY=your_key
GEMINI_API_KEY=your_key
BROWSERBASE_PROJECT_ID=your_id
AIRTABLE_API_KEY=your_key

# Optional
GITHUB_PAT=your_github_token
E2B_SANDBOX_TEMPLATE=claude-code-dev
```

---

## 📊 Complete Example Response Flow

```
1. data: {"type": "status", "status": "initializing"}
2. data: {"type": "status", "status": "creating_sandbox"}
3. data: {"type": "status", "status": "sandbox_ready", "sandbox_id": "..."}
4. data: {"type": "mcp_configured", "mcp_enabled": ["context7"]}
5. data: {"type": "ports", "exposed_urls": {...}}
6. data: {"type": "status", "status": "executing"}
7. data: {"type": "system", "data": {...}}
8. data: {"type": "claude_event", "event_type": "message_start"}
9. data: {"type": "text_delta", "text": "I'll"}
10. data: {"type": "text_delta", "text": " create"}
11. data: {"type": "text_delta", "text": " a todo"}
12. data: {"type": "text_delta", "text": " app"}
... (more text deltas)
N. data: {"type": "result", "result": {...}}
N+1. data: {"type": "complete", "session_id": "...", ...}
N+2. data: {"type": "done"}
```

---

## 🎯 Key Takeaways

1. **Listen for `text_delta`** events to build streaming UI
2. **Save `session_id`** from `complete` event for conversation continuity
3. **Use SSE/fetch** with streaming response handling
4. **Handle errors** gracefully with the `error` event type
5. **Show `exposed_urls`** as clickable links for web apps

---

## 🚀 Ready to Integrate!

Your backend is ready at `http://localhost:8000/chat`

Start building your frontend with real-time Claude Code streaming! 🎉
