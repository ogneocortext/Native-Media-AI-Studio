
import argparse
import base64
import json
import logging
import os
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
import mss
from PIL import Image

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ScreenshotCapture:
    def __init__(self, monitor: int = 1):
        self.monitor = monitor
    
    def capture(self, output_path: str | None = None) -> dict[str, Any]:
        try:
            with mss.mss() as sct:
                monitor_info = sct.monitors[self.monitor]
                logger.info(f'Capturing monitor {self.monitor}: {monitor_info}')
                screenshot = sct.grab(monitor_info)
                img = Image.frombytes('RGB', screenshot.size, screenshot.bgra, 'raw', 'BGRX')
                if output_path:
                    img.save(output_path)
                    logger.info(f'Screenshot saved to: {output_path}')
                buffer = BytesIO()
                img.save(buffer, format='PNG')
                image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
                return {'image_path': output_path, 'width': screenshot.width, 'height': screenshot.height, 'size_bytes': len(buffer.getvalue()), 'image_base64': image_base64, 'monitor': monitor_info}
        except Exception as e:
            logger.error(f'Failed to capture screenshot: {e}')
            raise

class GemmaAnalyzer:
    def __init__(self, base_url: str = 'http://localhost:11434', model: str = 'gemma4:e2b'):
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.timeout = 120.0
        
    async def analyze_image(self, image_base64: str, prompt: str | None = None) -> dict[str, Any]:
        default_prompt = 'You are an expert UI/UX designer. Analyze this screenshot of a web application and provide feedback on: 1. Visual design - colors, spacing, typography 2. Layout and hierarchy 3. Accessibility and usability 4. Specific issues and improvement suggestions 5. What works well. Provide analysis in a structured format for developers.'
        analysis_prompt = prompt or default_prompt
        messages = [{'role': 'user', 'content': f'{analysis_prompt}\n\n[Image: screenshot.png]', 'images': [image_base64]}]
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(f'{self.base_url}/api/chat', json={'model': self.model, 'messages': messages, 'stream': False})
                response.raise_for_status()
                result = response.json()
                return {'success': True, 'analysis': result.get('message', {}).get('content', ''), 'model': self.model, 'timestamp': time.time()}
        except httpx.ConnectError as e:
            logger.error(f'Cannot connect to Ollama at {self.base_url}: {e}')
            return {'success': False, 'error': f'Cannot connect to Ollama: {e}', 'model': self.model}
        except Exception as e:
            logger.error(f'Analysis failed: {e}')
            return {'success': False, 'error': str(e), 'model': self.model}

class DesignFeedbackService:
    def __init__(self, ollama_url: str = 'http://localhost:11434', model: str = 'gemma4:e2b', monitor: int = 1):
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
                svc = ScreenshotCapture()
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
    server = HTTPServer(('localhost', port), DesignFeedbackHandler)
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
    parser.add_argument('--ollama_url', type=str, default='http://localhost:11434', help='Ollama server URL')
    parser.add_argument('--model', type=str, default='gemma4:e2b', help='Model to use for analysis')
    parser.add_argument('--monitor', type=int, default=1, help='Monitor to capture')
    
    args = parser.parse_args()
    
    if args.analyze:
        try:
            with open(args.analyze, 'rb') as f:
                image_base64 = base64.b64encode(f.read()).decode('utf-8')
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
