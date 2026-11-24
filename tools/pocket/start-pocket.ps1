param(
    [string]$PocketDir = "D:\Tools\streaming-tts\pocket"
)

# Pocket TTS launcher. Generates a fresh per-launch Bearer token, writes it to
# pocket-token.txt (read by the Studio backend via pocket.token_file), then
# starts the Pocket server with TTS_TOKEN set in its environment.
#
# Step 0 world (a): Pocket server accepts its token from the TTS_TOKEN env var
# (server.py line 34: os.environ.get("TTS_TOKEN") or secrets.token_urlsafe(24)).
# Entry point: python server.py from <PocketDir>/server.

$serverDir = Join-Path $PocketDir "server"
$tokenPath = Join-Path $PocketDir "pocket-token.txt"
$token = [guid]::NewGuid().ToString("N")

# Write token to file (ASCII, single line, no trailing newline).
Set-Content -Path $tokenPath -Value $token -Encoding ASCII -NoNewline

# Hand the token to the Pocket server via TTS_TOKEN env var.
$env:TTS_TOKEN = $token

# Console output: only that Pocket started and the token FILE PATH.
# Never the token value.
Write-Host "Pocket TTS server started."
Write-Host "Token file: $tokenPath"

Push-Location $serverDir
try {
    & python server.py
} finally {
    Pop-Location
}
