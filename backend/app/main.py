import json
import os
import asyncio
from typing import Optional, Dict, Any
from datetime import datetime
from contextlib import asynccontextmanager
from pydantic import BaseModel

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from e2b import AsyncSandbox
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Logging helper function
def log(prefix: str, message: str, data: Any = None):
    """Enhanced logging with timestamps and emojis"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] [{prefix}] {message}")
    if data is not None:
        # Truncate long data
        data_str = str(data)
        if len(data_str) > 500:
            data_str = data_str[:500] + "..."
        print(f"[{timestamp}] [{prefix}] Data: {data_str}")

def log_separator():
    """Print a separator line"""
    print("=" * 80)

# Lifespan context manager for startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events"""
    # Startup
    log_separator()
    log("Server", "🚀 Backend starting...")
    log("Server", f"FastAPI version: {app.version}")

    # Check environment variables
    api_keys = {
        "GROQ_API_KEY": bool(os.getenv("GROQ_API_KEY")),
        "ANTHROPIC_API_KEY": bool(os.getenv("ANTHROPIC_API_KEY")),
        "E2B_API_KEY": bool(os.getenv("E2B_API_KEY")),
        "GITHUB_PAT": bool(os.getenv("GITHUB_PAT")),
    }

    log("Server", "🔑 API Keys configured:")
    for key, present in api_keys.items():
        status = "✓" if present else "✗"
        log("Server", f"  {key}: {status}")

    # Note: sandbox_template and sandbox_timeout are defined later in the file
    log("Server", f"🌐 CORS enabled for ports: 3000, 5173")
    log("Server", "✅ Server ready to accept requests")
    log_separator()

    yield  # Server is running

    # Shutdown (if needed in future)
    log("Server", "👋 Server shutting down...")

app = FastAPI(lifespan=lifespan)

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
The template repository from https://github.com/AmaruEscalante/template has been automatically cloned to `/home/user/template` with all dependencies installed via `pnpm install`. This is your default working directory for this session.

GitHub PAT is already set in the environment GITHUB_PAT.

IMPORTANT INSTRUCTIONS:
1. Your FIRST task is to start the dev server in the background. Do this BEFORE making any code changes:
   cd /home/user/template && nohup pnpm dev --host --port 5173 > vite.log 2>&1 &

2. Wait a few seconds, then verify it's running:
   sleep 3 && curl http://localhost:5173

3. The --host flag automatically binds to 0.0.0.0 and disables host checking, making it work with E2B URLs.

4. The app will be accessible on port 5173 via the preview URL.

5. After the server is running, you can make code changes as requested by the user.

CRITICAL TOOL RESTRICTIONS:
- NEVER use a tool called 'LS' - this tool does not exist and will cause errors
- For file listing, use the Bash tool with 'ls' command or the Glob tool instead
- Only use tools that are explicitly available in your toolset

whenever you're requested to upload code, so you always use the MCP GitHub tool you have available.
So you have very permissive access. You can create the lead modify repos. When requested to push code, ideally try to push it to a new repo.
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


async def setup_claude_code_router(sandbox, event_queue) -> Dict[str, Any]:
    """
    Install and configure Claude Code Router in the E2B sandbox.
    Returns status information about the router setup.
    """
    log_separator()
    log("Router", "🔧 Starting Claude Code Router setup")
    router_status = {"installed": False, "configured": False, "started": False, "url": "http://localhost:3456"}

    try:
        # Send status update
        log("Router", "📦 Installing router package...")
        await event_queue.put({"type": "status", "status": "installing_router"})

        # Try multiple installation methods
        install_methods = [
            # Method 1: Try with sudo
            "sudo npm install -g @musistudio/claude-code-router",
            # Method 2: Try without sudo (might be running as root)
            "npm install -g @musistudio/claude-code-router",
            # Method 3: Use bunx (E2B uses bun)
            "bun add -g @musistudio/claude-code-router",
        ]

        install_success = False
        errors = []

        for i, method in enumerate(install_methods, 1):
            log("Router", f"📦 Trying installation method {i}/3: {method}")
            await event_queue.put({"type": "status", "status": f"trying_install_method_{i}", "method": method})
            result = await sandbox.commands.run(method, timeout=120000)

            if result.exit_code == 0:
                install_success = True
                router_status["installed"] = True
                router_status["install_method"] = method
                log("Router", f"✅ Installation successful with method: {method}")
                await event_queue.put({"type": "status", "status": "router_installed", "method": method})
                break
            else:
                error_msg = result.stderr or result.stdout
                errors.append(f"Method {i} ({method}): {error_msg[:200]}")
                log("Router", f"❌ Method {i} failed: {error_msg[:200]}")

        if not install_success:
            full_error = " | ".join(errors)
            log("Router", f"❌ All installation methods failed: {full_error}")
            raise Exception(f"Failed to install router with all methods: {full_error}")

        # Create router config directory
        log("Router", "📝 Creating router config directory")
        await sandbox.commands.run("mkdir -p /home/user/.claude-code-router")

        # Read and prepare router config with environment variable injection
        log("Router", "📝 Loading router configuration template")
        router_config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "template", "router-config.json")
        with open(router_config_path, "r") as f:
            router_config = f.read()

        # Replace environment variable placeholder with actual value
        groq_api_key = os.getenv("GROQ_API_KEY", "")
        has_api_key = bool(groq_api_key)
        log("Router", f"🔑 Injecting GROQ_API_KEY: {'✓' if has_api_key else '✗'}")
        router_config = router_config.replace("$GROQ_API_KEY", groq_api_key)

        # Write config to sandbox
        log("Router", "📝 Writing config to /home/user/.claude-code-router/config.json")
        config_preview = router_config[:200] + "..." if len(router_config) > 200 else router_config
        log("Router", f"Config preview: {config_preview}")
        await sandbox.files.write("/home/user/.claude-code-router/config.json", router_config)
        router_status["configured"] = True
        log("Router", "✅ Router configuration complete")
        await event_queue.put({"type": "status", "status": "router_configured"})

        # Start Claude Code Router in background
        log("Router", "🚀 Starting Claude Code Router...")
        await event_queue.put({"type": "status", "status": "starting_router"})

        # Determine the router command based on installation method
        if "bun" in router_status.get("install_method", ""):
            router_cmd = "bunx @musistudio/claude-code-router start"
        else:
            router_cmd = "ccr start"

        log("Router", f"🚀 Router command: {router_cmd}")

        # Start router and wait a bit for it to initialize
        start_result = await sandbox.commands.run(
            f"nohup {router_cmd} > /tmp/router.log 2>&1 &",
            timeout=10000
        )

        # If start command failed, try alternative
        if start_result.exit_code != 0:
            log("Router", f"⚠️  Primary start command failed, trying npx fallback")
            # Try with npx as fallback
            await sandbox.commands.run(
                "nohup npx @musistudio/claude-code-router start > /tmp/router.log 2>&1 &",
                timeout=10000
            )

        # Give router time to start
        log("Router", "⏳ Waiting 3 seconds for router to initialize...")
        await asyncio.sleep(3)

        # Verify router is running by checking if port is listening
        log("Router", "🔍 Verifying router is running on port 3456...")
        await event_queue.put({"type": "status", "status": "verifying_router"})

        port_check = await sandbox.commands.run(
            "netstat -tuln | grep :3456 || ss -tuln | grep :3456",
            timeout=5000
        )

        if port_check.exit_code == 0:
            router_status["started"] = True
            log("Router", "✅ Router is running on port 3456")
            log("Router", f"Port check output: {port_check.stdout[:200]}")
            await event_queue.put({"type": "status", "status": "router_started", "port": 3456})
        else:
            # Check router logs for debugging
            log("Router", "⚠️  Port check failed, examining logs...")
            logs = await sandbox.commands.run("cat /tmp/router.log 2>/dev/null || echo 'No logs available'")
            router_log_content = logs.stdout[:500] if logs.stdout else "No output"
            log("Router", f"Router logs: {router_log_content}")
            await event_queue.put({
                "type": "warning",
                "message": f"Router may not be running on port 3456. Logs: {router_log_content}"
            })
            # Mark as started anyway - it might work
            router_status["started"] = True
            router_status["warning"] = "Port check failed but continuing"
            log("Router", "⚠️  Continuing anyway - router might still work")

        log_separator()
        log("Router", "✅ Router setup complete!", router_status)
        return router_status

    except Exception as e:
        router_status["error"] = str(e)
        log("Router", f"❌ Router setup failed: {str(e)}")
        log_separator()
        await event_queue.put({"type": "error", "message": f"Router setup failed: {str(e)}"})
        raise


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
        router_status = None
        try:
            log_separator()
            log("Chat", "🚀 New chat request received")
            log("Chat", f"📋 Prompt (first 100 chars): {prompt.prompt[:100]}...")
            log("Chat", f"🆔 Session ID: {session or 'NEW SESSION'}")

            # Send initial status
            yield f"data: {json.dumps({'type': 'status', 'status': 'initializing'})}\n\n"

            if session is None:
                log("Chat", "🆕 Creating new session")
                # Get MCP configuration
                mcp_config = get_mcp_config()
                log("Chat", f"🔧 MCP config: {list(mcp_config.keys()) if mcp_config else 'None'}")

                # Send status: creating sandbox
                log("Chat", "📦 Creating E2B sandbox with template: mcp-gateway")
                yield f"data: {json.dumps({'type': 'status', 'status': 'creating_sandbox'})}\n\n"

                # Create sandbox with MCP Gateway if configured
                if mcp_config:
                    sandbox = await AsyncSandbox.create(
                        template="mcp-gateway",
                        timeout=sandbox_timeout,
                        mcp=mcp_config,
                        envs={
                            "GITHUB_PAT": os.getenv("GITHUB_PAT", ""),
                            # Use dummy API key - router will handle actual auth
                            "ANTHROPIC_API_KEY": "sk-ant-router",
                            # Point Claude to use the router
                            "ANTHROPIC_BASE_URL": "http://localhost:3456",
                            # Disable telemetry and warnings
                            "DISABLE_TELEMETRY": "true",
                            "DISABLE_COST_WARNINGS": "true",
                        },
                    )
                else:
                    log("Chat", "❌ No MCP configuration provided")
                    raise HTTPException(status_code=400, detail="No MCP configuration provided")

                log("Chat", f"✅ Sandbox created: {sandbox.sandbox_id}")
                yield f"data: {json.dumps({'type': 'status', 'status': 'sandbox_ready', 'sandbox_id': sandbox.sandbox_id})}\n\n"

                # Setup default template for every new session
                log("Chat", "🔧 Setting up template repository")
                yield f"data: {json.dumps({'type': 'status', 'status': 'setting_up_template'})}\n\n"
                
                # Clone template repo
                log("Chat", "📥 Cloning template repository from GitHub")
                await sandbox.commands.run(
                    "git clone https://github.com/AmaruEscalante/template /home/user/template"
                )

                # Remove .git directory to make it a fresh template (not a git clone)
                log("Chat", "🗑️  Removing .git directory from template")
                await sandbox.commands.run("rm -rf /home/user/template/.git")

                # Install dependencies
                log("Chat", "📦 Installing template dependencies with pnpm")
                await sandbox.commands.run("cd /home/user/template && pnpm install")

                log("Chat", "✅ Template ready at /home/user/template")
                yield f"data: {json.dumps({'type': 'status', 'status': 'template_ready', 'path': '/home/user/template'})}\n\n"

                # Clone additional repository if provided
                if prompt.repo:
                    log("Chat", f"📥 Cloning additional repository: {prompt.repo}")
                    yield f"data: {json.dumps({'type': 'status', 'status': 'cloning_additional_repo'})}\n\n"
                    await sandbox.commands.run(
                        f"git clone {prompt.repo} && cd {prompt.repo.split('/')[-1]}"
                    )
                
                # Setup MCP Gateway
                if mcp_config:
                    log("Chat", "🔧 Configuring MCP Gateway")
                    yield f"data: {json.dumps({'type': 'status', 'status': 'configuring_mcp'})}\n\n"
                    mcp_url = sandbox.get_mcp_url()
                    mcp_token = await sandbox.get_mcp_token()
                    log("Chat", f"🔗 MCP Gateway URL: {mcp_url}")

                    await sandbox.commands.run(
                        f'claude mcp add --transport http e2b-mcp-gateway {mcp_url} --header "Authorization: Bearer {mcp_token}"',
                        on_stdout=lambda output: None,  # Suppress internal setup logs
                        on_stderr=lambda output: None,
                    )

                    log("Chat", f"✅ MCP configured with tools: {list(mcp_config.keys())}")
                    yield f"data: {json.dumps({'type': 'mcp_configured', 'mcp_enabled': list(mcp_config.keys()), 'mcp_gateway_url': mcp_url})}\n\n"

                # Setup Claude Code Router to use Groq
                event_queue = asyncio.Queue()

                # Setup router in background task
                router_task = asyncio.create_task(setup_claude_code_router(sandbox, event_queue))

                # Stream events while router is setting up
                while not router_task.done():
                    try:
                        # Wait for events with short timeout
                        event = await asyncio.wait_for(event_queue.get(), timeout=0.5)
                        yield f"data: {json.dumps(event)}\n\n"
                    except asyncio.TimeoutError:
                        # No event yet, continue waiting
                        continue

                # Drain any remaining events
                while not event_queue.empty():
                    event = await event_queue.get()
                    yield f"data: {json.dumps(event)}\n\n"

                # Wait for router setup to complete and get status
                try:
                    router_status = await router_task
                    yield f"data: {json.dumps({'type': 'router_ready', 'router_status': router_status})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'error': f'Router setup failed: {str(e)}'})}\n\n"
                    # Don't raise - continue without router
                    router_status = None
            else:
                log("Chat", f"🔄 Reconnecting to existing session: {session}")
                sandbox = await AsyncSandbox.connect(sandbox_id=session_sandbox_map[session])
                log("Chat", f"✅ Connected to sandbox: {session_sandbox_map[session]}")
                yield f"data: {json.dumps({'type': 'status', 'status': 'connected_to_session'})}\n\n"

            # Get exposed port URLs
            log("Chat", "🌐 Checking for exposed ports...")
            exposed_ports = {}
            for port in [3000, 5173, 8000, 8080, 4200]:
                try:
                    host = sandbox.get_host(port)
                    exposed_ports[port] = f"https://{host}"
                except:
                    pass

            if exposed_ports:
                log("Chat", f"🌐 Exposed ports: {list(exposed_ports.keys())}")
                for port, url in exposed_ports.items():
                    log("Chat", f"  Port {port}: {url}")
                yield f"data: {json.dumps({'type': 'ports', 'exposed_urls': exposed_ports})}\n\n"

            # Execute Claude Code with REALTIME streaming using stream-json
            log("Chat", "🤖 Preparing to execute Claude Code via Router")
            yield f"data: {json.dumps({'type': 'status', 'status': 'executing'})}\n\n"

            cmd = "ccr code"

            # Combine system prompt and user prompt to avoid shell escaping issues
            # This ensures all context is passed via stdin without command-line complexity
            combined_prompt = f"{system_prompt}\n\n---\n\nUser Request:\n{prompt.prompt}"
            log("Chat", f"📝 Combined prompt length: {len(combined_prompt)} characters")

            # Use stream-json format for realtime streaming
            # Note: When piping from stdin, Claude auto-detects print mode
            # stream-json in print mode requires --verbose
            claude_args = [
                "--dangerously-skip-permissions",
                "--output-format",
                "stream-json",  # Stream JSON events in realtime
                "--include-partial-messages",  # Include partial updates
                "--verbose",  # Required for stream-json when using stdin
            ]
            if session:
                claude_args.append(f"--resume")
                claude_args.append(session)

            # Parse stream-json events in realtime
            all_events = []
            output_queue = asyncio.Queue()
            captured_stderr = []
            captured_stdout = []

            def on_stdout(line: str):
                # Capture for error reporting
                captured_stdout.append(line)
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
                # Capture for error reporting
                captured_stderr.append(line)
                # Queue stderr for streaming
                try:
                    output_queue.put_nowait({'type': 'stderr', 'data': line})
                except:
                    pass

            # Write combined prompt to file to avoid shell escaping issues
            log("Chat", "📝 Writing combined prompt to /home/user/claude_prompt.txt")
            await sandbox.files.write("/home/user/claude_prompt.txt", combined_prompt)

            # Verify the file was written correctly
            verify_result = await sandbox.commands.run("wc -l /home/user/claude_prompt.txt")
            log("Chat", f"📝 Prompt file written: {verify_result.stdout.strip()}")

            # Verify we're in the right directory
            pwd_check = await sandbox.commands.run("ls -la /home/user/template")
            log("Chat", f"📂 Template directory contents: {pwd_check.stdout[:200]}")

            # Check if Claude is installed and accessible
            claude_check = await sandbox.commands.run("which claude && claude --version")
            log("Chat", f"🔍 Claude check: {claude_check.stdout.strip() if claude_check.exit_code == 0 else 'Claude not found!'}")

            # Test if Claude can execute at all
            simple_test = await sandbox.commands.run('echo "test" | claude --help', timeout=10000)
            log("Chat", f"🔍 Claude help test exit code: {simple_test.exit_code}")
            if simple_test.exit_code != 0:
                log("Chat", f"⚠️  Claude help failed: {simple_test.stderr[:200]}")

            # Check environment variables
            env_check = await sandbox.commands.run("env | grep -E '(ANTHROPIC|GROQ)' | head -5")
            log("Chat", f"🔑 Environment variables: {env_check.stdout[:200]}")

            # Verify router is accessible from within sandbox
            router_test = await sandbox.commands.run("curl -s http://localhost:3456/health || echo 'Router not accessible'", timeout=5000)
            log("Chat", f"🔍 Router accessibility test: {router_test.stdout[:200]}")

            # Build full command - simpler without system prompt in args
            full_command = f"cd /home/user/template && cat /home/user/claude_prompt.txt | {cmd} {' '.join(claude_args)}"
            log("Chat", f"🤖 Executing Claude command in /home/user/template")
            log("Chat", f"Command args: {' '.join(claude_args)}")
            log("Chat", f"Full command: {full_command[:200]}...")

            # Run command in background task - ensure we're in the template directory
            command_task = asyncio.create_task(
                sandbox.commands.run(
                    full_command,
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
            log("Chat", f"🤖 Claude command completed - Exit code: {response.exit_code}")

            # Log any errors
            if response.exit_code != 0:
                log("Chat", f"❌ Command failed with exit code {response.exit_code}")
                # Use captured output since callbacks consumed the streams
                stderr_text = '\n'.join(captured_stderr) if captured_stderr else response.stderr or '(empty)'
                stdout_text = '\n'.join(captured_stdout[:10]) if captured_stdout else response.stdout or '(empty)'  # First 10 lines
                log("Chat", f"Captured stderr ({len(captured_stderr)} lines): {stderr_text[:500]}")
                log("Chat", f"Captured stdout ({len(captured_stdout)} lines): {stdout_text[:500]}")

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
                log("Chat", f"💾 Stored session mapping: {result_session_id} -> {sandbox.sandbox_id}")

            # Send final completion with metadata
            log_separator()
            log("Chat", "✅ Build completed successfully!")
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

            # Add router status if available
            if router_status:
                completion_data['router_status'] = router_status
                completion_data['using_groq'] = router_status.get('started', False)

            log("Chat", f"📦 Completion data: {completion_data}")
            log_separator()
            yield f"data: {json.dumps(completion_data)}\n\n"

        except Exception as e:
            log_separator()
            log("Chat", f"❌ Error occurred: {str(e)}")
            log_separator()
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
        finally:
            log("Chat", "🏁 Stream ending")
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")
