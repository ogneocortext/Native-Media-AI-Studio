
import argparse
import base64
import json
import logging
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from typing import Any

import httpx
from PIL import Image

# mss is only present in some venvs (installed in the 3.14 studio-tools env,
# absent from nma-studio-cuda/comfyui-cuda), so it imports lazily inside
# ScreenshotCapture.capture() — image-file analysis must not require it.

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Encode/send settings aligned with tools/tests/vision_analyze.py (the other
# python vision entry point): screenshots ship no larger than 1200 px, JPEG
# recompression only when the source does not already fit.
MAX_DIMENSION = 1200
JPEG_QUALITY = 70
PASSTHROUGH_BYTES = 200_000
# Cold vision-model loads on this machine measured 60-183 s, so the request
# budget must exceed the load, not the analysis.
KEEP_ALIVE = os.environ.get('VISION_KEEP_ALIVE', '10m')
REQUEST_TIMEOUT = float(os.environ.get('DESIGN_FEEDBACK_TIMEOUT', '300'))
# Local-only fallback chain, tried in order after the primary 404s.
FALLBACK_MODELS = [
    m.strip()
    for m in os.environ.get('VISION_FALLBACK_MODELS', 'qwen3.5:4b').split(',')
    if m.strip()
]


def encode_for_analysis(img: Image.Image) -> str:
    """Return base64 image bytes sized for a vision-model request.

    Small sources ship byte-identical (PNG glyph edges stay sharp); anything
    bigger is thumbnailed and JPEG-encoded. Alpha is composited on black,
    all other non-RGB modes converted, like vision_analyze.py.
    """
    buffer = BytesIO()
    img.save(buffer, format='PNG')
    raw = buffer.getvalue()
    if max(img.size) <= MAX_DIMENSION and len(raw) <= PASSTHROUGH_BYTES:
        return base64.b64encode(raw).decode()
    resized = img.copy()
    resized.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)
    if 'A' in resized.getbands():
        background = Image.new('RGB', resized.size, (0, 0, 0))
        background.paste(resized.convert('RGB'), mask=resized.getchannel('A'))
        resized = background
    elif resized.mode != 'RGB':
        resized = resized.convert('RGB')
    out = BytesIO()
    resized.save(out, format='JPEG', quality=JPEG_QUALITY)
    return base64.b64encode(out.getvalue()).decode()

class ScreenshotCapture:
    def __init__(self, monitor: int = 1):
        self.monitor = monitor

    def capture(self, output_path: str | None = None) -> dict[str, Any]:
        try:
            try:
                import mss
            except ImportError as exc:
                raise ImportError(
                    'mss is required for screen capture; install it in this venv '
                    'or use --analyze with an existing image file'
                ) from exc
            with mss.mss() as sct:
                if self.monitor < 0 or self.monitor >= len(sct.monitors):
                    raise ValueError(
                        f'monitor {self.monitor} out of range '
                        f'(0 = all-in-one virtual, 1..{len(sct.monitors) - 1} = displays)'
                    )
                monitor_info = sct.monitors[self.monitor]
                logger.info(f'Capturing monitor {self.monitor}: {monitor_info}')
                screenshot = sct.grab(monitor_info)
                img = Image.frombytes('RGB', screenshot.size, screenshot.bgra, 'raw', 'BGRX')
                if output_path:
                    img.save(output_path)
                    logger.info(f'Screenshot saved to: {output_path}')
                image_base64 = encode_for_analysis(img)
                return {'image_path': output_path, 'width': screenshot.width, 'height': screenshot.height, 'size_bytes': len(image_base64) * 3 // 4, 'image_base64': image_base64, 'monitor': monitor_info}
        except Exception as e:
            logger.error(f'Failed to capture screenshot: {e}')
            raise

class GemmaAnalyzer:
    def __init__(self, base_url: str = 'http://localhost:11434', model: str = 'gemma4:e2b-it-qat'):
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.timeout = REQUEST_TIMEOUT

    async def analyze_image(self, image_base64: str, prompt: str | None = None) -> dict[str, Any]:
        default_prompt = 'You are an expert UI/UX designer. Analyze this screenshot of a web application and provide feedback on: 1. Visual design - colors, spacing, typography 2. Layout and hierarchy 3. Accessibility and usability 4. Specific issues and improvement suggestions 5. What works well. Provide analysis in a structured format for developers.'
        analysis_prompt = prompt or default_prompt
        messages = [{'role': 'user', 'content': analysis_prompt, 'images': [image_base64]}]
        candidates = [self.model] + [m for m in FALLBACK_MODELS if m != self.model]
        last_error = ''
        for candidate in candidates:
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.post(
                        f'{self.base_url}/api/chat',
                        json={'model': candidate, 'messages': messages, 'stream': False, 'keep_alive': KEEP_ALIVE},
                    )
                if response.status_code == 404:
                    logger.info(f'{candidate} not pulled, falling back')
                    last_error = f'{candidate}: 404 not pulled'
                    continue
                response.raise_for_status()
                result = response.json()
                msg = result.get('message', {})
                content = msg.get('content', '')
                if not content.strip() and msg.get('thinking', '').strip():
                    logger.info('empty content; using thinking output as analysis')
                    content = msg['thinking']
                return {'success': True, 'analysis': content, 'model': candidate, 'fallback': candidate != self.model, 'timestamp': time.time()}
            except httpx.ConnectError as e:
                logger.error(f'Cannot connect to Ollama at {self.base_url}: {e}')
                return {'success': False, 'error': f'Cannot connect to Ollama: {e}', 'model': candidate}
            except Exception as e:
                logger.error(f'{candidate} failed: {e}')
                last_error = f'{candidate}: {e}'
        return {'success': False, 'error': f'All analysis models failed ({last_error})', 'model': self.model}

class DesignFeedbackService:
    def __init__(self, ollama_url: str = 'http://localhost:11434', model: str = 'gemma4:e2b-it-qat', monitor: int = 1):
        self.screenshot = ScreenshotCapture(monitor=monitor)
        self.analyzer = GemmaAnalyzer(base_url=ollama_url, model=model)

    async def capture_and_analyze(self, output_path: str | None = None, prompt: str | None = None, save_screenshot: bool = True) -> dict[str, Any]:
        if save_screenshot and not output_path:
            timestamp = int(time.time())
            output_path = f'screenshot_{timestamp}.png'
        screenshot_data = self.screenshot.capture(output_path)
        logger.info(f'Analyzing screenshot with {self.analyzer.model}...')
        analysis = await self.analyzer.analyze_image(screenshot_data['image_base64'], prompt)
        return {'screenshot': {'path': screenshot_data['image_path'], 'width': screenshot_data['width'], 'height': screenshot_data['height'], 'size_bytes': screenshot_data['size_bytes']}, 'analysis': analysis, 'success': analysis.get('success', False)}

class DesignFeedbackHandler(BaseHTTPRequestHandler):
    service = None

    def _send_json_response(self, status: int, data: dict):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        if self.path == '/health':
            self._send_json_response(200, {'status': 'ok', 'service': 'design-feedback'})
        elif self.path == '/capture':
            try:
                monitor = self.service.screenshot.monitor if self.service else 1
                svc = ScreenshotCapture(monitor=monitor)
                result = svc.capture()
                self._send_json_response(200, {'success': True, 'screenshot': {'width': result['width'], 'height': result['height']}})
            except Exception as e:
                self._send_json_response(500, {'error': str(e)})
        else:
            self._send_json_response(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path == '/analyze':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                request_data = json.loads(body.decode()) if content_length > 0 else {}
                prompt = request_data.get('prompt')
                save_screenshot = request_data.get('save_screenshot', True)
                output_path = request_data.get('output_path')
                import asyncio
                result = asyncio.run(self.service.capture_and_analyze(output_path=output_path, prompt=prompt, save_screenshot=save_screenshot))
                self._send_json_response(200, result)
            except Exception as e:
                logger.exception('Analysis failed')
                self._send_json_response(500, {'error': str(e)})
        else:
            self._send_json_response(404, {'error': 'Not found'})

    def log_message(self, format, *args):
        pass

def run_server(port: int = 8080):
    DesignFeedbackHandler.service = DesignFeedbackService()
    # ThreadingHTTPServer: one slow analysis must not starve /health probes
    # from the frontend (the old single-threaded server blocked them).
    server = ThreadingHTTPServer(('localhost', port), DesignFeedbackHandler)
    logger.info(f'Design Feedback Server running on http://localhost:{port}')
    logger.info('Endpoints: GET /health, GET /capture, POST /analyze')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info('Server stopped')
        server.shutdown()

def main():
    parser = argparse.ArgumentParser(description='Design Feedback Agent - Screenshot Analysis with Gemma4')
    parser.add_argument('--capture', action='store_true', help='Capture screenshot and analyze')
    parser.add_argument('--analyze', type=str, metavar='IMAGE', help='Analyze an existing image file')
    parser.add_argument('--output', '-o', type=str, help='Output path for screenshot')
    parser.add_argument('--prompt', '-p', type=str, help='Custom prompt for analysis')
    parser.add_argument('--server', '-s', action='store_true', help='Start HTTP server for frontend integration')
    parser.add_argument('--port', type=int, default=8080, help='Server port')
    # Defaults wired to the env vars the README documents (the code never read
    # DESIGN_FEEDBACK_MODEL/OLLAMA_BASE_URL before — doc-only promises).
    parser.add_argument('--ollama_url', type=str, default=os.environ.get('OLLAMA_BASE_URL', 'http://localhost:11434'), help='Ollama server URL (env OLLAMA_BASE_URL)')
    parser.add_argument('--model', type=str, default=os.environ.get('DESIGN_FEEDBACK_MODEL', 'gemma4:e2b-it-qat'), help='Model to use for analysis (env DESIGN_FEEDBACK_MODEL)')
    parser.add_argument('--monitor', type=int, default=int(os.environ.get('DESIGN_FEEDBACK_MONITOR', '1')), help='Monitor to capture (env DESIGN_FEEDBACK_MONITOR)')

    args = parser.parse_args()

    if args.analyze:
        try:
            with Image.open(args.analyze) as img:
                img.load()
                image_base64 = encode_for_analysis(img)
            analyzer = GemmaAnalyzer(args.ollama_url, args.model)
            import asyncio
            result = asyncio.run(analyzer.analyze_image(image_base64, args.prompt))
            print(json.dumps(result, indent=2))
        except Exception as e:
            logger.error(f'Failed to analyze image: {e}')
            sys.exit(1)
    elif args.server:
        run_server(args.port)
    elif args.capture:
        import asyncio
        service = DesignFeedbackService(ollama_url=args.ollama_url, model=args.model, monitor=args.monitor)
        result = asyncio.run(service.capture_and_analyze(output_path=args.output, prompt=args.prompt))
        print(json.dumps(result, indent=2))
    else:
        parser.print_help()

if __name__ == '__main__':
    main()
