export default async function run(page, ui) {
  // Wait for the pattern to load
  await page.waitForFunction(() => {
    const textarea = document.querySelector('textarea');
    return textarea && textarea.value.length > 0;
  }, { timeout: 10000 }).catch(() => console.log("Timeout waiting for pattern to load"));
  
  // Test SameBoy core
  console.log("Testing with sameboy core...");
  const coreSelect = await page.locator('select').nth(1);
  await coreSelect.selectOption('sameboy');
  await page.waitForTimeout(1000);
  
  // Test Render Audio
  console.log("Testing Render Audio with sameboy...");
  await page.click('button:has-text("RENDER AUDIO")');
  await page.waitForTimeout(30000);
  
  const takes = await page.evaluate(() => {
    const audios = document.querySelectorAll('audio');
    return Array.from(audios).map(audio => ({src: audio.src.substring(0, 100), controls: audio.controls}));
  });
  console.log("Takes after sameboy render:", takes);
  
  const error = await page.evaluate(() => {
    const errorDiv = document.querySelector('[style*="#3A1626"]');
    return errorDiv ? errorDiv.textContent : null;
  });
  console.log("Error after sameboy render:", error);
  
  return { success: true };
}