# 🎤 Vibes - Voice AI App Builder

Turn your ideas into apps with voice AI. Powered by Gemini Live and Claude Code running in isolated Daytona sandboxes.

## Features

- **Voice-First Interface**: Talk naturally to describe your app idea
- **Real-Time Building**: Watch your app being built in real-time with live progress updates
- **Isolated Sandboxes**: Each app is built in its own Daytona sandbox environment
- **Live Preview**: See your app running immediately in a split-screen view
- **Confirmation Flow**: AI asks for confirmation before starting expensive build operations

## Architecture

- **Frontend**: React 18 with TypeScript + SCSS
- **Voice AI**: Google Gemini Live API with native audio streaming
- **Code Generation**: Anthropic Claude Code SDK (Haiku 4.5 model)
- **Sandbox Environment**: Daytona SDK for isolated Next.js app generation
- **Backend**: Express.js with Server-Sent Events for real-time progress streaming

## How It Works

1. **Connect**: Click the connect button to start voice conversation with Gemini
2. **Describe**: Talk about the app you want to build
3. **Confirm**: Gemini asks for confirmation, say "yes" or "confirm"
4. **Watch**: See real-time progress as Claude builds your app in a Daytona sandbox
5. **Preview**: The live app appears in an iframe once the dev server starts

## Prerequisites

Before running Vibes, you need:

1. **Node.js** (v18 or higher)
2. **API Keys**:
   - **Gemini API Key**: Get from [Google AI Studio](https://makersuite.google.com/app/apikey)
   - **Anthropic API Key**: Get from [Anthropic Console](https://console.anthropic.com/)
   - **Daytona API Key**: Get from [Daytona Dashboard](https://app.daytona.io/)

## Installation

1. **Clone and navigate to the project**:
   ```bash
   cd /path/to/vibes
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.example .env
   ```

4. **Edit `.env` and add your API keys**:
   ```env
   # Gemini API Key
   REACT_APP_GEMINI_API_KEY=your_gemini_api_key_here

   # Anthropic API Key (for Claude Code SDK)
   REACT_APP_ANTHROPIC_API_KEY=your_anthropic_api_key_here

   # Daytona API Key (for sandbox management)
   DAYTONA_API_KEY=your_daytona_api_key_here
   ```

## Running the Application

### Development Mode (Recommended)

Run both the server and React app concurrently:

```bash
npm run dev
```

This will start:
- **Express Server** on `http://localhost:3001` (API + Daytona integration)
- **React App** on `http://localhost:3000` (UI)

### Run Separately

**Terminal 1 - Start the server**:
```bash
npm run server
```

**Terminal 2 - Start the React app**:
```bash
npm start
```

## Usage Guide

### Basic Workflow

1. Open `http://localhost:3000` in your browser
2. Click the **Connect** button in the bottom control tray
3. Allow microphone access when prompted
4. Start talking! Example prompts:
   - "Build me a todo app with dark mode"
   - "Create a portfolio website with a projects page"
   - "Make a blog with markdown support"
5. When Gemini asks for confirmation, say **"yes"** or **"confirm"**
6. Watch the split-screen UI:
   - **Left (30%)**: Real-time build progress messages
   - **Right (70%)**: Live preview of your app

### Voice Commands

- **"Build [description]"**: Request to build an app
- **"Yes" / "Confirm"**: Confirm and start the build
- **"Stop" / "Cancel"**: Cancel the current build (via UI button)

### Understanding the Build Process

The build process follows these steps:

1. **Sandbox Creation**: Creates a new Daytona sandbox with Node.js 20
2. **Setup**: Initializes npm project and installs Claude Agent SDK
3. **Code Generation**: Claude Code writes all files (pages, components, styles, etc.)
4. **Dependency Installation**: Installs npm packages
5. **Dev Server Start**: Starts Next.js dev server on port 3000
6. **Preview Ready**: App is accessible via the preview URL

### Build Messages

You'll see different types of messages during the build:

- 🤖 **Claude**: AI assistant messages
- 🔧 **Tool**: File operations (Write, Edit, Read, etc.)
- ⚡ **Progress**: Status updates
- ✅ **Complete**: Build finished successfully
- ❌ **Error**: Something went wrong

## Project Structure

```
vibes/
├── public/                  # Static assets
│   └── index.html
├── src/
│   ├── components/
│   │   ├── control-tray/   # Voice control UI (mic, connect button)
│   │   ├── side-panel/     # Logging panel
│   │   ├── lovable/        # Build UI components
│   │   │   ├── LovableBuilder.tsx       # Main build UI
│   │   │   ├── LovableBuilder.scss      # Styles
│   │   │   └── MessageDisplay.tsx       # Message renderer
│   │   ├── VibesApp.tsx    # Main app component
│   │   └── VibesApp.scss
│   ├── contexts/
│   │   └── LiveAPIContext.tsx           # Gemini Live context
│   ├── hooks/
│   │   └── use-live-api.ts              # Gemini Live hook
│   ├── lib/
│   │   ├── genai-live-client.ts         # Gemini client
│   │   ├── audio-recorder.ts            # Mic capture
│   │   ├── audio-streamer.ts            # Audio playback
│   │   └── worklets/                     # Audio processors
│   ├── App.tsx
│   ├── App.css
│   ├── index.tsx
│   └── index.css
├── server.js               # Express server with Daytona integration
├── package.json
├── tsconfig.json
└── .env                    # Your API keys (not committed)
```

## API Endpoints

### POST `/api/build-app`

Builds an app in a Daytona sandbox.

**Request**:
```json
{
  "prompt": "Create a todo app with dark mode"
}
```

**Response**: Server-Sent Events stream

**Event Types**:
- `progress`: Status updates
- `claude_message`: Messages from Claude
- `tool_use`: Tool invocations
- `complete`: Build finished (includes `previewUrl`)
- `error`: Build failed

### GET `/api/builds`

Returns list of active builds.

### GET `/health`

Health check endpoint.

## Troubleshooting

### Microphone Not Working

1. Check browser permissions (allow microphone access)
2. Make sure you're on `localhost` or `https` (required for Web Audio API)
3. Check if another app is using the microphone

### Build Fails

1. **Check API Keys**: Verify all API keys are correct in `.env`
2. **Check Daytona Quota**: Ensure you have available Daytona sandbox quota
3. **Check Server Logs**: Look at the terminal running `npm run server`
4. **Check Browser Console**: Look for errors in DevTools console

### Preview Not Loading

1. **Wait Longer**: Dev servers can take 10-15 seconds to start
2. **Check Sandbox**: The sandbox might still be building
3. **Check Preview URL**: Try opening the preview URL in a new tab
4. **Check Dev Server Logs**: The sandbox might have errors starting the server

### Voice Not Being Heard

1. **Check Connection**: Make sure you're connected (green indicator)
2. **Check Volume**: Gemini's audio will play through your speakers
3. **Try Text Input**: Use the side panel to type messages as a fallback

## Technical Details

### Gemini Live Configuration

- **Model**: `gemini-2.0-flash-exp`
- **Voice**: Aoede
- **Audio**: PCM16, 16kHz input / 24kHz output
- **Function Calling**: `buildApp(description: string)`

### Claude Code Configuration

- **Model**: `claude-haiku-4-5-20251001`
- **System Prompt**: `claude_code` preset
- **Max Turns**: 20
- **Tools**: Read, Write, Edit, MultiEdit, Bash, LS, Glob, Grep

### Daytona Sandboxes

- **Image**: Node.js 20
- **Public**: Yes (required for preview URLs)
- **Persistence**: Sandboxes remain active after build for debugging
- **Preview Port**: 3000 (Next.js default)

## Cost Considerations

- **Gemini Live**: Charged per minute of audio + API calls
- **Claude Code**: Charged per token (input + output)
- **Daytona**: Charged per sandbox usage time

A typical app build:
- **Duration**: 3-5 minutes
- **Tokens**: ~50,000-100,000 tokens
- **Sandbox Time**: Ongoing until manually stopped

## Cleanup

To remove a Daytona sandbox:

```bash
# Get sandbox ID from build logs
# Then use Daytona CLI or SDK to delete it
```

Consider setting up automatic sandbox cleanup for cost control.

## Development

### Adding New Features

The modular architecture makes it easy to extend:

1. **New Voice Commands**: Add function declarations in `VibesApp.tsx`
2. **Custom Build Messages**: Modify `MessageDisplay.tsx`
3. **Build Options**: Update the generation script in `server.js`
4. **UI Customization**: Edit SCSS files

### Contributing

This is a hackathon project demonstrating the integration of:
- Voice AI (Gemini Live)
- Code Generation (Claude Code)
- Sandbox Environments (Daytona)

Feel free to fork and customize for your needs!

## Credits

Built with:
- [Google Gemini Live API](https://ai.google.dev/)
- [Anthropic Claude Code SDK](https://github.com/anthropics/claude-code)
- [Daytona SDK](https://www.daytona.io/)
- React, TypeScript, Express.js, and love ❤️

## License

MIT

---

**Happy Building!** 🚀
