import json
import os
import asyncio
from typing import Optional, Dict, Any
from pydantic import BaseModel

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from e2b import AsyncSandbox
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = FastAPI()

# Configure CORS to allow requests from React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # React dev server
        "http://127.0.0.1:3000",
        "http://localhost:5173",  # Alternative port
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods (GET, POST, OPTIONS, etc.)
    allow_headers=["*"],  # Allow all headers
)

system_prompt = """
WORKING DIRECTORY:
The template repository from https://github.com/AndresNinou/template has been automatically cloned to `/home/user/template` with all dependencies installed via `pnpm install`. This is your default working directory for this session.

GitHub PAT is already set in the environment GITHUB_PAT.

CRITICAL - IFRAME EMBEDDING CONFIGURATION:
Before starting the dev server, you MUST configure vite.config.js to allow iframe embedding.
Ensure the server configuration includes these headers:

server: {
  host: true,
  allowedHosts: true,
  headers: {
    'X-Frame-Options': 'ALLOWALL',
    'Content-Security-Policy': 'frame-ancestors *'
  }
}

This is CRITICAL for the preview to work in the frontend interface.

1. Always Start dev server in the background dont need to block the terminal and if is automatically, before making any code  changes run the server first thats your first TASK IN LIFE RUN THE FUCKING SERVER.
   cd my-app && nohup pnpm dev --host --port 5173 > vite.log 2>&1 &

4. Verify it's running:
   sleep 3 && curl http://localhost:5173

The --host flag automatically binds to 0.0.0.0 and disables host checking, making it work with E2B URLs.
The app will be accessible on port 5173.
"""

sandbox_template = os.getenv("E2B_SANDBOX_TEMPLATE", "claude-code-dev")
sandbox_timeout = 60 * 60 # 1 hour

# claude session id -> sandbox id
session_sandbox_map = {}


def get_mcp_config() -> Dict[str, Any]:
    """
    Build MCP configuration from environment variables.
    Only includes MCPs that have their API keys configured.
    """
    mcp_config = {}
    
    # Context7 MCP
    if os.getenv("GITHUB_PAT"):
        mcp_config["githubOfficial"] = {
            "personalAccessToken": os.getenv("GITHUB_PAT"),
        }
    return mcp_config


class ClaudePrompt(BaseModel):
    prompt: str
    repo: Optional[str] = None


@app.post("/chat/{session}")
@app.post("/chat")
async def chat(prompt: ClaudePrompt, session: Optional[str] = None):
    """
    Main endpoint - streams Claude Code output in real-time with MCP Gateway support
    Uses stream-json format for realtime text streaming
    """
    async def event_generator():
        sandbox = None
        try:
            # Send initial status
            yield f"data: {json.dumps({'type': 'status', 'status': 'initializing'})}\n\n"
            
            if session is None:
                # Get MCP configuration
                mcp_config = get_mcp_config()
                
                # Send status: creating sandbox
                yield f"data: {json.dumps({'type': 'status', 'status': 'creating_sandbox'})}\n\n"
                
                # Create sandbox with MCP Gateway if configured
                if mcp_config:
                    sandbox = await AsyncSandbox.create(
                        template="mcp-gateway",
                        timeout=sandbox_timeout,
                        mcp=mcp_config,
                        envs={
                            "GITHUB_PAT": os.getenv("GITHUB_PAT", ""),
                            "ANTHROPIC_API_KEY": os.getenv("ANTHROPIC_API_KEY", ""),
                        },
                    )
                else:
                    raise HTTPException(status_code=400, detail="No MCP configuration provided")
                
                yield f"data: {json.dumps({'type': 'status', 'status': 'sandbox_ready', 'sandbox_id': sandbox.sandbox_id})}\n\n"
                
                # Setup default template for every new session
                yield f"data: {json.dumps({'type': 'status', 'status': 'setting_up_template'})}\n\n"
                
                # Clone template repo
                await sandbox.commands.run(
                    "git clone https://github.com/AndresNinou/template /home/user/template"
                )
                
                # Remove .git directory to make it a fresh template (not a git clone)
                await sandbox.commands.run("rm -rf /home/user/template/.git")
                
                # Install dependencies
                await sandbox.commands.run("cd /home/user/template && pnpm install")
                
                # Set as working directory
                await sandbox.commands.run("cd /home/user/template")
                
                yield f"data: {json.dumps({'type': 'status', 'status': 'template_ready', 'path': '/home/user/template'})}\n\n"
                
                # Clone additional repository if provided
                if prompt.repo:
                    yield f"data: {json.dumps({'type': 'status', 'status': 'cloning_additional_repo'})}\n\n"
                    await sandbox.commands.run(
                        f"git clone {prompt.repo} && cd {prompt.repo.split('/')[-1]}"
                    )
                
                # Setup MCP Gateway
                if mcp_config:
                    yield f"data: {json.dumps({'type': 'status', 'status': 'configuring_mcp'})}\n\n"
                    mcp_url = sandbox.get_mcp_url()
                    mcp_token = await sandbox.get_mcp_token()
                    
                    await sandbox.commands.run(
                        f'claude mcp add --transport http e2b-mcp-gateway {mcp_url} --header "Authorization: Bearer {mcp_token}"',
                        on_stdout=lambda output: None,  # Suppress internal setup logs
                        on_stderr=lambda output: None,
                    )
                    
                    yield f"data: {json.dumps({'type': 'mcp_configured', 'mcp_enabled': list(mcp_config.keys()), 'mcp_gateway_url': mcp_url})}\n\n"
            else:
                sandbox = await AsyncSandbox.connect(sandbox_id=session_sandbox_map[session])
                yield f"data: {json.dumps({'type': 'status', 'status': 'connected_to_session'})}\n\n"
            
            # Get exposed port URLs
            exposed_ports = {}
            for port in [3000, 5173, 8000, 8080, 4200]:
                try:
                    host = sandbox.get_host(port)
                    exposed_ports[port] = f"https://{host}"
                except:
                    pass
            
            if exposed_ports:
                yield f"data: {json.dumps({'type': 'ports', 'exposed_urls': exposed_ports})}\n\n"
            
            # Execute Claude Code with REALTIME streaming using stream-json
            yield f"data: {json.dumps({'type': 'status', 'status': 'executing'})}\n\n"
            
            cmd = "claude"
            # Use stream-json format for realtime streaming
            claude_args = [
                "-p",
                "--dangerously-skip-permissions",
                "--output-format",
                "stream-json",  # Stream JSON events in realtime
                "--include-partial-messages",  # Include partial updates
                "--verbose",  # Required for stream-json in print mode
                "--append-system-prompt",
                f'"{system_prompt}"',
            ]
            if session:
                claude_args.append(f"--resume")
                claude_args.append(session)
            
            # Parse stream-json events in realtime
            all_events = []
            output_queue = asyncio.Queue()
            
            def on_stdout(line: str):
                """Parse stream-json events and extract text deltas"""
                try:
                    event = json.loads(line)
                    all_events.append(event)
                    
                    # Extract useful information from different event types
                    if event.get('type') == 'stream_event':
                        stream_event = event.get('event', {})
                        event_type = stream_event.get('type')
                        
                        # Extract text being generated
                        if event_type == 'content_block_delta':
                            delta = stream_event.get('delta', {})
                            if delta.get('type') == 'text_delta':
                                text = delta.get('text', '')
                                output_queue.put_nowait({
                                    'type': 'text_delta',
                                    'text': text
                                })
                        
                        # Forward other important events
                        elif event_type in ['message_start', 'message_stop', 'content_block_start']:
                            output_queue.put_nowait({
                                'type': 'claude_event',
                                'event_type': event_type
                            })
                    
                    elif event.get('type') == 'result':
                        # Final result
                        output_queue.put_nowait({
                            'type': 'result',
                            'result': event
                        })
                    
                    elif event.get('type') == 'system':
                        # System events (init, etc)
                        output_queue.put_nowait({
                            'type': 'system',
                            'data': event
                        })
                        
                except json.JSONDecodeError:
                    # Not JSON, might be error output
                    output_queue.put_nowait({
                        'type': 'raw',
                        'data': line
                    })
            
            def on_stderr(line: str):
                # Queue stderr for streaming
                try:
                    output_queue.put_nowait({'type': 'stderr', 'data': line})
                except:
                    pass
            
            # Run command in background task
            command_task = asyncio.create_task(
                sandbox.commands.run(
                    f"echo '{prompt.prompt}' | {cmd} {' '.join(claude_args)}",
                    on_stdout=on_stdout,
                    on_stderr=on_stderr,
                    timeout=600000,  # 10 minutes timeout
                )
            )
            
            # Stream output as it comes
            while not command_task.done():
                try:
                    # Check for output with timeout
                    output = await asyncio.wait_for(output_queue.get(), timeout=0.1)
                    yield f"data: {json.dumps(output)}\n\n"
                except asyncio.TimeoutError:
                    # No output yet, continue waiting
                    continue
            
            # Drain any remaining output
            while not output_queue.empty():
                output = await output_queue.get()
                yield f"data: {json.dumps(output)}\n\n"
            
            # Get command result
            response = await command_task
            
            # Extract session_id from collected events
            result_session_id = None
            for event in all_events:
                if event.get('type') == 'result':
                    result_session_id = event.get('session_id')
                    break
                elif event.get('session_id'):
                    result_session_id = event.get('session_id')
            
            # Store session if found
            if result_session_id and session is None:
                session_sandbox_map[result_session_id] = sandbox.sandbox_id
            
            # Send final completion with metadata
            completion_data = {
                'type': 'complete',
                'exit_code': response.exit_code,
                'session_id': result_session_id,
                'sandbox_id': sandbox.sandbox_id if sandbox else None,
                'exposed_urls': exposed_ports
            }
            
            if session is None and get_mcp_config():
                completion_data['mcp_enabled'] = list(get_mcp_config().keys())
                completion_data['mcp_gateway_url'] = sandbox.get_mcp_url()
            
            yield f"data: {json.dumps(completion_data)}\n\n"
        
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")
