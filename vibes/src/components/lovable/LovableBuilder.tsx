import React, { useEffect, useState, useRef, useCallback } from 'react';
import MessageDisplay from './MessageDisplay';
import './LovableBuilder.scss';

interface BuildMessage {
  type: 'claude_message' | 'tool_use' | 'progress' | 'error' | 'complete';
  content: any;
  timestamp: number;
}

interface LovableBuilderProps {
  buildRequest: {
    description: string;
    callId: string;
  } | null;
  buildStatus: 'idle' | 'pending_confirmation' | 'building' | 'complete';
  onBuildComplete: (sandboxId?: string) => void;
  onBuildError: () => void;
  onManualConfirm?: () => void;
}

const LovableBuilder: React.FC<LovableBuilderProps> = ({
  buildRequest,
  buildStatus,
  onBuildComplete,
  onBuildError,
  onManualConfirm,
}) => {
  const [messages, setMessages] = useState<BuildMessage[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [accumulatedText, setAccumulatedText] = useState<string>('');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll messages to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

  const startBuild = useCallback(async (prompt: string) => {
    console.log('='.repeat(80));
    console.log('[LovableBuilder] 🚀 Starting build process');
    console.log('[LovableBuilder] Prompt:', prompt);
    console.log('[LovableBuilder] Timestamp:', new Date().toISOString());
    console.log('='.repeat(80));

    // Don't clear messages and preview for continuation
    if (!sessionId) {
      setMessages([]);
      setPreviewUrl('');
    }

    // Create abort controller for this build
    abortControllerRef.current = new AbortController();

    // Get backend URL from environment or use default
    const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

    try {
      // Use session ID if available for continuation
      const endpoint = sessionId 
        ? `${backendUrl}/chat/${sessionId}`
        : `${backendUrl}/chat`;
      
      console.log(`[LovableBuilder] 📡 Sending POST request to ${endpoint}`);
      console.log('[LovableBuilder] Request body:', { prompt });
      console.log('[LovableBuilder] Session ID:', sessionId || 'new session');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
        credentials: 'omit',
        signal: abortControllerRef.current.signal,
      });

      console.log('[LovableBuilder] ✅ Response received - Status:', response.status);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      console.log('[LovableBuilder] 📖 Starting to read SSE stream...');
      let buffer = '';
      let messageCount = 0;
      let lastMessageTime = Date.now();
      let completeSandboxId: string | undefined;
      let currentAccumulatedText = '';
      const TIMEOUT_MS = 600000;

      const timeoutChecker = setInterval(() => {
        const timeSinceLastMessage = Date.now() - lastMessageTime;
        if (timeSinceLastMessage > TIMEOUT_MS) {
          console.error('[LovableBuilder] ⏱️  Stream timeout');
          clearInterval(timeoutChecker);
          abortControllerRef.current?.abort();
          throw new Error('Stream timeout - connection may have been lost');
        }
      }, 10000);

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            console.log('[LovableBuilder] ✅ Stream complete - Total messages:', messageCount);
            clearInterval(timeoutChecker);
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');

          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);

              if (data === '[DONE]') {
                console.log('[LovableBuilder] 🎉 Legacy [DONE] marker received');
                clearInterval(timeoutChecker);
                continue;
              }

              try {
                const message = JSON.parse(data);
                lastMessageTime = Date.now();

                if (message.type === 'status') {
                  messageCount++;
                  console.log(`[LovableBuilder] 📨 Status #${messageCount}:`, message.status);
                  
                  // Only show key status messages
                  const importantStatuses = ['sandbox_ready', 'template_ready', 'executing'];
                  if (importantStatuses.includes(message.status)) {
                    const buildMessage: BuildMessage = {
                      type: 'progress',
                      content: `⏳ ${message.status.replace(/_/g, ' ')}`,
                      timestamp: Date.now(),
                    };
                    setMessages(prev => [...prev, buildMessage]);
                  }
                  continue;
                } else if (message.type === 'mcp_configured') {
                  messageCount++;
                  console.log(`[LovableBuilder] 📨 MCP configured:`, message.mcp_enabled);
                  
                  const buildMessage: BuildMessage = {
                    type: 'progress',
                    content: `✅ MCP Tools enabled: ${message.mcp_enabled.join(', ')}`,
                    timestamp: Date.now(),
                  };
                  setMessages(prev => [...prev, buildMessage]);
                  continue;
                } else if (message.type === 'ports') {
                  messageCount++;
                  console.log(`[LovableBuilder] 📨 Ports exposed:`, message.exposed_urls);
                  
                  // Immediately set preview URL to port 5173 (Vite default)
                  if (message.exposed_urls['5173']) {
                    setPreviewUrl(message.exposed_urls['5173']);
                    setIsPreviewLoading(true);
                    console.log('[LovableBuilder] 📦 Preview URL set immediately:', message.exposed_urls['5173']);
                    
                    // Start auto-refresh interval to check if app is ready
                    if (refreshIntervalRef.current) {
                      clearInterval(refreshIntervalRef.current);
                    }
                    refreshIntervalRef.current = setInterval(() => {
                      console.log('[LovableBuilder] 🔄 Auto-refreshing preview...');
                      setIframeKey(prev => prev + 1);
                    }, 3000); // Refresh every 3 seconds
                  } else if (message.exposed_urls['3000']) {
                    setPreviewUrl(message.exposed_urls['3000']);
                    setIsPreviewLoading(true);
                    console.log('[LovableBuilder] 📦 Preview URL set immediately:', message.exposed_urls['3000']);
                  }
                  
                  const buildMessage: BuildMessage = {
                    type: 'progress',
                    content: `🌐 Ports exposed: ${Object.keys(message.exposed_urls).join(', ')}`,
                    timestamp: Date.now(),
                  };
                  setMessages(prev => [...prev, buildMessage]);
                  continue;
                } else if (message.type === 'text_delta') {
                  // Accumulate text deltas into one message
                  currentAccumulatedText += message.text;
                  setAccumulatedText(currentAccumulatedText);
                  continue;
                } else if (message.type === 'system') {
                  // System init message - log but don't display
                  console.log('[LovableBuilder] 📨 System init:', message.data?.session_id);
                  continue;
                } else if (message.type === 'claude_event') {
                  // Claude internal events - ignore for cleaner UI
                  continue;
                } else if (message.type === 'raw') {
                  // Check if this contains tool usage information
                  try {
                    const rawData = JSON.parse(message.data);
                    if (rawData.type === 'assistant' && rawData.message?.content) {
                      // Flush accumulated text before showing tool
                      if (currentAccumulatedText) {
                        const textMessage: BuildMessage = {
                          type: 'claude_message',
                          content: currentAccumulatedText,
                          timestamp: Date.now(),
                        };
                        setMessages(prev => [...prev, textMessage]);
                        currentAccumulatedText = '';
                        setAccumulatedText('');
                      }
                      
                      // Show tool usage
                      const content = rawData.message.content;
                      for (const item of content) {
                        if (item.type === 'tool_use') {
                          const toolMessage: BuildMessage = {
                            type: 'tool_use',
                            content: {
                              name: item.name,
                              id: item.id,
                            },
                            timestamp: Date.now(),
                          };
                          setMessages(prev => [...prev, toolMessage]);
                        }
                      }
                    }
                  } catch (e) {
                    // Not JSON or doesn't contain tool info, ignore
                  }
                  continue;
                } else if (message.type === 'result') {
                  // Flush any remaining accumulated text
                  if (currentAccumulatedText) {
                    const textMessage: BuildMessage = {
                      type: 'claude_message',
                      content: currentAccumulatedText,
                      timestamp: Date.now(),
                    };
                    setMessages(prev => [...prev, textMessage]);
                    currentAccumulatedText = '';
                    setAccumulatedText('');
                  }
                  
                  // Final result with formatted response
                  messageCount++;
                  console.log('[LovableBuilder] 📨 Final result received');
                  
                  const resultData = message.result;
                  if (resultData?.result) {
                    const buildMessage: BuildMessage = {
                      type: 'complete',
                      content: resultData.result,
                      timestamp: Date.now(),
                    };
                    setMessages(prev => [...prev, buildMessage]);
                  }
                  continue;
                } else if (message.type === 'done') {
                  console.log('[LovableBuilder] ✅ Done event received - Build complete!');
                  console.log('[LovableBuilder] 📦 Passing sandboxId to onBuildComplete:', completeSandboxId);
                  
                  // Stop auto-refresh when build completes
                  if (refreshIntervalRef.current) {
                    clearInterval(refreshIntervalRef.current);
                    refreshIntervalRef.current = null;
                  }
                  
                  // Force one final iframe refresh to load the completed app
                  console.log('[LovableBuilder] 🔄 Forcing final iframe refresh after build complete');
                  setIframeKey(prev => prev + 1);
                  setIsPreviewLoading(false);
                  
                  onBuildComplete(completeSandboxId);
                  continue;
                } else if (message.type === 'complete') {
                  // Store session_id for continuing the conversation
                  if (message.session_id) {
                    console.log('[LovableBuilder] 📦 Received session_id:', message.session_id);
                    setSessionId(message.session_id);
                    completeSandboxId = message.session_id;
                  }
                  
                  // Extract preview URL from exposed_urls
                  if (message.exposed_urls) {
                    const vitePort = '5173';
                    const reactPort = '3000';
                    
                    if (message.exposed_urls[vitePort]) {
                      setPreviewUrl(message.exposed_urls[vitePort]);
                      console.log('[LovableBuilder] 📦 Preview URL (Vite):', message.exposed_urls[vitePort]);
                    } else if (message.exposed_urls[reactPort]) {
                      setPreviewUrl(message.exposed_urls[reactPort]);
                      console.log('[LovableBuilder] 📦 Preview URL (React):', message.exposed_urls[reactPort]);
                    }
                  }
                  
                  const buildMessage: BuildMessage = {
                    type: 'complete',
                    content: 'Build completed successfully!',
                    timestamp: Date.now(),
                  };
                  setMessages(prev => [...prev, buildMessage]);
                  continue;
                } else if (message.type === 'error') {
                  messageCount++;
                  const buildMessage: BuildMessage = {
                    type: 'error',
                    content: message.error || 'An error occurred',
                    timestamp: Date.now(),
                  };
                  setMessages(prev => [...prev, buildMessage]);
                  continue;
                }
              } catch (e) {
                console.error('[LovableBuilder] Error parsing message:', e);
              }
            }
          }
        }
      } finally {
        clearInterval(timeoutChecker);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[LovableBuilder] Build aborted');
      } else {
        console.error('[LovableBuilder] Build error:', error);
        setMessages(prev => [
          ...prev,
          {
            type: 'error',
            content: error.message || 'Build failed',
            timestamp: Date.now(),
          },
        ]);
        onBuildError();
      }
    }
  }, [sessionId, onBuildComplete, onBuildError]);
  
  // Start build when status changes to 'building'
  useEffect(() => {
    if (buildStatus === 'building' && buildRequest) {
      console.log('[LovableBuilder] ✅ Build status changed to "building"');
      console.log('[LovableBuilder] Triggering startBuild with description:', buildRequest.description);
      startBuild(buildRequest.description);
    }
  }, [buildStatus, buildRequest, startBuild]);

  const cancelBuild = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  // Show nothing when idle
  if (buildStatus === 'idle') {
    return null;
  }

  // Show pending confirmation state
  if (buildStatus === 'pending_confirmation') {
    return (
      <div className="lovable-builder">
        <div className="confirmation-overlay">
          <div className="confirmation-card">
            <div className="confirmation-icon">🚀</div>
            <h2>Ready to Build</h2>
            <p className="build-description">{buildRequest?.description}</p>
            <p className="confirmation-instruction">
              Say <strong>"yes"</strong> or <strong>"confirm"</strong> to start building
            </p>
            <div className="confirmation-divider">
              <span>or</span>
            </div>
            <button
              type="button"
              className="manual-confirm-button"
              onClick={onManualConfirm}
            >
              Start Build Now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show building or complete state
  return (
    <div className="lovable-builder">
      <div className="builder-container">
        {/* Left side: Messages */}
        <div className="messages-panel">
          <div className="panel-header">
            <h3>Build Progress</h3>
            {buildStatus === 'building' && (
              <button type="button" className="cancel-button" onClick={cancelBuild}>
                Cancel
              </button>
            )}
          </div>
          <div className="messages-content">
            {messages.length === 0 && buildStatus === 'building' && (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Initializing build...</p>
              </div>
            )}
            {messages.map((message, index) => (
              <MessageDisplay key={`${message.timestamp}-${index}`} message={message} />
            ))}
            {accumulatedText && (
              <MessageDisplay 
                key="accumulated" 
                message={{
                  type: 'claude_message',
                  content: accumulatedText,
                  timestamp: Date.now()
                }} 
              />
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Right side: Preview */}
        <div className="preview-panel">
          <div className="panel-header">
            <h3>Live Preview</h3>
            {previewUrl && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="open-button"
                  onClick={() => {
                    console.log('[LovableBuilder] 🔄 Manual refresh triggered');
                    setIframeKey(prev => prev + 1);
                  }}
                  title="Refresh preview"
                >
                  🔄 Refresh
                </button>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="open-button"
                >
                  Open in New Tab
                </a>
              </div>
            )}
          </div>
          <div className="preview-content">
            {previewUrl ? (
              <>
                {isPreviewLoading && (
                  <div className="preview-loading-overlay">
                    <div className="spinner-large"></div>
                  </div>
                )}
                <iframe
                  key={iframeKey}
                  src={previewUrl}
                  className="preview-iframe"
                  title="App Preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  style={{ opacity: isPreviewLoading ? 0.3 : 1 }}
                  onLoad={() => {
                    console.log('[LovableBuilder] 📦 Preview loaded successfully');
                    // Keep loading state for a bit longer to ensure app is ready
                    setTimeout(() => {
                      if (refreshIntervalRef.current) {
                        clearInterval(refreshIntervalRef.current);
                        refreshIntervalRef.current = null;
                      }
                      setIsPreviewLoading(false);
                    }, 2000);
                  }}
                />
              </>
            ) : (
              <div className="preview-placeholder">
                <div className="placeholder-icon">⏳</div>
                <p>Preview will appear here once the app is ready...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LovableBuilder;
