#!/usr/bin/env python3
"""
One-shot OAuth 2.1 + PKCE flow to obtain a Bearer token from spritesheet-forge-mcp.

Usage:
    python3 scripts/get-token.py
    python3 scripts/get-token.py --base-url https://your-instance.workers.dev
"""

import argparse
import base64
import hashlib
import http.server
import json
import os
import secrets
import threading
import urllib.parse
import urllib.request
import webbrowser
from urllib.error import URLError

CALLBACK_PORT = 8899
CALLBACK_PATH = "/callback"
REDIRECT_URI = f"http://localhost:{CALLBACK_PORT}{CALLBACK_PATH}"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def pkce_pair() -> tuple[str, str]:
    verifier = b64url(secrets.token_bytes(32))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


UA = "spritesheet-forge-mcp/get-token.py"


def register_client(base_url: str) -> str:
    payload = json.dumps({
        "redirect_uris": [REDIRECT_URI],
        "client_name": "get-token.py",
    }).encode()
    req = urllib.request.Request(
        f"{base_url}/oauth/register",
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": UA},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)["client_id"]


def exchange_code(base_url: str, code: str, verifier: str) -> str:
    payload = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
    }).encode()
    req = urllib.request.Request(
        f"{base_url}/oauth/token",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)["access_token"]


def wait_for_code() -> str:
    code_holder: list[str] = []
    server_ready = threading.Event()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == CALLBACK_PATH:
                params = urllib.parse.parse_qs(parsed.query)
                if "code" in params:
                    code_holder.append(params["code"][0])
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    self.wfile.write("<h2>Authorization successful &#8212; you can close this tab.</h2>".encode())
                else:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b"Missing code parameter")
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, *_):
            pass  # suppress access log

    httpd = http.server.HTTPServer(("localhost", CALLBACK_PORT), Handler)

    def serve():
        server_ready.set()
        httpd.handle_request()  # handle exactly one request

    t = threading.Thread(target=serve, daemon=True)
    t.start()
    server_ready.wait()
    return code_holder, httpd, t


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="https://mcp.clawstudiouo.com")
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")

    print(f"\nspritesheet-forge-mcp  OAuth token helper")
    print(f"Server : {base_url}\n")

    print("1/4  Registering OAuth client...")
    try:
        client_id = register_client(base_url)
    except URLError as e:
        print(f"     ERROR: {e}")
        raise SystemExit(1)
    print(f"     client_id = {client_id}")

    verifier, challenge = pkce_pair()
    state = secrets.token_hex(8)

    authorize_url = (
        f"{base_url}/oauth/authorize"
        f"?response_type=code"
        f"&client_id={urllib.parse.quote(client_id)}"
        f"&redirect_uri={urllib.parse.quote(REDIRECT_URI)}"
        f"&code_challenge={challenge}"
        f"&code_challenge_method=S256"
        f"&state={state}"
    )

    print("\n2/4  Starting local callback server on port", CALLBACK_PORT, "...")
    code_holder, httpd, _ = wait_for_code()

    print("3/4  Opening browser for GitHub login...")
    print(f"     If it doesn't open, visit:\n     {authorize_url}\n")
    webbrowser.open(authorize_url)

    print("     Waiting for GitHub callback...", end="", flush=True)
    # Block until the handler fires (code_holder is populated inside serve thread)
    import time
    timeout = 120
    elapsed = 0
    while not code_holder and elapsed < timeout:
        time.sleep(0.2)
        elapsed += 0.2
    print()

    if not code_holder:
        print("ERROR: Timed out waiting for callback.")
        raise SystemExit(1)

    code = code_holder[0]
    print(f"     Received authorization code.")

    print("\n4/4  Exchanging code for access token...")
    try:
        token = exchange_code(base_url, code, verifier)
    except URLError as e:
        print(f"     ERROR: {e}")
        raise SystemExit(1)

    print("\n" + "="*60)
    print("ACCESS TOKEN (Bearer):")
    print(token)
    print("="*60)

    token_file = os.path.expanduser("~/.spritesheet-forge-token")
    with open(token_file, "w") as f:
        f.write(token + "\n")
    print(f"\nToken saved to: {token_file}")
    print("To use in benchmark:")
    print(f'  export SPRITESHEET_TOKEN="{token}"')
    print(f"  bash benchmark/run.sh")
    print(f"\nTo use with curl:")
    print(f'  TOKEN=$(cat {token_file})')
    print(f'  curl -H "Authorization: Bearer $TOKEN" https://mcp.clawstudiouo.com/upload ...\n')


if __name__ == "__main__":
    main()
