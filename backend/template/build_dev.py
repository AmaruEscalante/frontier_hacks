import os
from pathlib import Path
from dotenv import load_dotenv
from template import template
from e2b import Template

# Load .env from parent directory
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

import time

# Use a unique alias with timestamp to avoid conflicts
unique_alias = f"claude-code-dev-{int(time.time())}"
print(f"Building template with alias: {unique_alias}")

Template.build(
    template,
    alias=unique_alias,
    cpu_count=2,
    memory_mb=4096,
    on_build_logs=lambda log_entry: print(log_entry),
)

print(f"\n✅ Template built successfully with alias: {unique_alias}")
print(f"Update your .env file with: E2B_SANDBOX_TEMPLATE=\"{unique_alias}\"")
