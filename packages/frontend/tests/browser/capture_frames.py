import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

OUT_DIR = Path(r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\packages\frontend\tests\browser\out")
OUT_DIR.mkdir(parents=True, exist_ok=True)

async def capture_frames():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await context.new_page()
        await page.goto("http://localhost:5173/visualizer", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)

        # Wait for player to initialize
        await page.wait_for_timeout(2000)

        frames = []
        for i in range(30):
            file_path = OUT_DIR / f"frame_{i:03d}.png"
            await page.screenshot(path=str(file_path), full_page=False)
            frames.append(str(file_path))
            await page.wait_for_timeout(150)

        await browser.close()
        print(f"Captured {len(frames)} frames to {OUT_DIR}")
        return frames

if __name__ == "__main__":
    asyncio.run(capture_frames())
