import asyncio
import os
from pathlib import Path

from playwright.async_api import async_playwright

OUT_DIR = Path(__file__).resolve().parent / "out"
OUT_DIR.mkdir(parents=True, exist_ok=True)

BASE_URL = os.environ.get("VITE_URL") or os.environ.get("BASE_URL") or "http://127.0.0.1:5173"


async def capture_frames():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context(viewport={"width": 1280, "height": 800})
            page = await context.new_page()
            await page.goto(f"{BASE_URL}/visualizer", wait_until="domcontentloaded")
            await page.wait_for_timeout(3000)

            await page.wait_for_timeout(2000)

            frames = []
            for i in range(30):
                file_path = OUT_DIR / f"frame_{i:03d}.png"
                await page.screenshot(path=str(file_path), full_page=False)
                frames.append(str(file_path))
                await page.wait_for_timeout(150)

            print(f"Captured {len(frames)} frames to {OUT_DIR}")
            return frames
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(capture_frames())
