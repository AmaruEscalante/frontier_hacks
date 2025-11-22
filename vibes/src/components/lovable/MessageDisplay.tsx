import React from 'react';

interface BuildMessage {
  type: 'claude_message' | 'tool_use' | 'progress' | 'error' | 'complete';
  content: any;
  timestamp: number;
}

interface MessageDisplayProps {
  message: BuildMessage;
}

const MessageDisplay: React.FC<MessageDisplayProps> = ({ message }) => {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const renderContent = () => {
    switch (message.type) {
      case 'claude_message':
        return (
          <div className="message claude-message">
            <div className="message-header">
              <span className="message-icon">🤖</span>
              <span className="message-label">Claude</span>
              <span className="message-time">{formatTime(message.timestamp)}</span>
            </div>
            <div className="message-body">
              {typeof message.content === 'string'
                ? message.content
                : JSON.stringify(message.content, null, 2)}
            </div>
          </div>
        );

      case 'tool_use':
        const toolName = message.content.tool || message.content.name || 'Tool';
        const toolInput = message.content.input || message.content;

        return (
          <div className="message tool-message">
            <div className="message-header">
              <span className="message-icon">🔧</span>
              <span className="message-label">{toolName}</span>
              <span className="message-time">{formatTime(message.timestamp)}</span>
            </div>
            <div className="message-body tool-body">
              <pre>{JSON.stringify(toolInput, null, 2)}</pre>
            </div>
          </div>
        );

      case 'progress':
        return (
          <div className="message progress-message">
            <div className="message-header">
              <span className="message-icon">⚡</span>
              <span className="message-label">Progress</span>
              <span className="message-time">{formatTime(message.timestamp)}</span>
            </div>
            <div className="message-body">
              {typeof message.content === 'string'
                ? message.content
                : message.content.message || JSON.stringify(message.content)}
            </div>
          </div>
        );

      case 'error':
        return (
          <div className="message error-message">
            <div className="message-header">
              <span className="message-icon">❌</span>
              <span className="message-label">Error</span>
              <span className="message-time">{formatTime(message.timestamp)}</span>
            </div>
            <div className="message-body">
              {typeof message.content === 'string'
                ? message.content
                : message.content.error || JSON.stringify(message.content)}
            </div>
          </div>
        );

      case 'complete':
        return (
          <div className="message complete-message">
            <div className="message-header">
              <span className="message-icon">✅</span>
              <span className="message-label">Complete</span>
              <span className="message-time">{formatTime(message.timestamp)}</span>
            </div>
            <div className="message-body">
              Build completed successfully!
              {message.content.previewUrl && (
                <div className="preview-url">
                  Preview URL: <code>{message.content.previewUrl}</code>
                </div>
              )}
            </div>
          </div>
        );

      default:
        return (
          <div className="message">
            <div className="message-body">
              <pre>{JSON.stringify(message, null, 2)}</pre>
            </div>
          </div>
        );
    }
  };

  return renderContent();
};

export default MessageDisplay;
