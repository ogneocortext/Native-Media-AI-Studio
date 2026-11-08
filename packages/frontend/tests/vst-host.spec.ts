import { test, expect } from '@playwright/test';
import { navigateAndWait, cleanupRoutes, mockApiResponse, mockApiHealth, mockApiQueueEmpty } from './helpers';

test.describe('VST Host - Scan, Build Chain, Process Audio', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
    // Mock common API endpoints that the app expects on load
    await mockApiHealth(page, 200);
    await mockApiQueueEmpty(page);

    // Mock VST-specific API responses for initial load
    await mockApiResponse(page, '/api/vst/plugins', { plugins: [] });
    await mockApiResponse(page, '/api/vst/chains', { chains: [] });
    await mockApiResponse(page, '/api/audio/library', { files: [] });
  });

  test('scan plugins, build chain, process audio', async ({ page }) => {
    // Navigate to VST page
    await navigateAndWait(page, '/create/vst');

    // Wait for VST page to fully load (React.lazy + data fetching)
    await expect(page.locator('button:has-text("Scan VST3")')).toBeVisible({ timeout: 15000 });

    // Verify initial state - no plugins
    await expect(page.locator('text=No plugins found')).toBeVisible();
    await expect(page.locator('text=Click "Scan VST3" to discover plugins')).toBeVisible();

    // Mock scan response with plugins
    const mockPlugins = [
      {
        name: 'TestCompressor',
        path: '/plugins/TestCompressor.vst3',
        vendor: 'TestVendor',
        version: '1.0.0',
        category: 'effect',
        num_inputs: 2,
        num_outputs: 2,
        parameters: [
          { name: 'Threshold', min: -60, max: 0, default: -20, value: -20, unit: 'dB' },
          { name: 'Ratio', min: 1, max: 20, default: 4, value: 4, unit: 'x' },
        ],
        is_valid: true,
        error_message: '',
      },
      {
        name: 'TestEQ',
        path: '/plugins/TestEQ.vst3',
        vendor: 'TestVendor',
        version: '1.0.0',
        category: 'effect',
        num_inputs: 2,
        num_outputs: 2,
        parameters: [
          { name: 'Frequency', min: 20, max: 20000, default: 1000, value: 1000, unit: 'Hz' },
          { name: 'Gain', min: -24, max: 24, default: 0, value: 0, unit: 'dB' },
        ],
        is_valid: true,
        error_message: '',
      },
    ];

    await page.route('/api/vst/scan', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ plugins: mockPlugins }),
      });
    });

    // Click Scan VST3 button
    const scanButton = page.locator('button:has-text("Scan VST3")');
    await expect(scanButton).toBeEnabled();
    await scanButton.click();

    // Wait for plugins to load
    await expect(page.locator('text=TestCompressor')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=TestEQ')).toBeVisible();

    // Switch to Chains tab
    await page.locator('button:has-text("Chains")').click();
    await expect(page.locator('text=No chain selected')).toBeVisible();

    // Click to add plugins to chain (empty drop zone)
    await page.locator('text=Click to add plugins to the chain').click();

    // Verify plugin selector modal opens
    await expect(page.locator('text=Add Plugin to Chain')).toBeVisible();
    await expect(page.locator('text=TestCompressor')).toBeVisible();
    await expect(page.locator('text=TestEQ')).toBeVisible();

    // Add TestCompressor to chain
    await page.locator('button:has-text("TestCompressor")').first().click();

    // Verify plugin added to chain
    await expect(page.locator('text=TestCompressor').first()).toBeVisible();

    // Add TestEQ to chain
    await page.locator('text=Click to add plugins to the chain').click();
    await page.locator('button:has-text("TestEQ")').first().click();

    // Verify both plugins in chain
    await expect(page.locator('text=TestCompressor')).toBeVisible();
    await expect(page.locator('text=TestEQ')).toBeVisible();

    // Enter chain name
    await page.locator('input[placeholder="Chain name"]').fill('Test Chain');

    // Save chain
    await page.route('/api/vst/chains', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            name: 'Test Chain',
            plugins: [
              { name: 'TestCompressor', parameters: {} },
              { name: 'TestEQ', parameters: {} },
            ],
            sample_rate: 48000,
            block_size: 512,
          }),
        });
      } else {
        await route.fallback();
      }
    });

    await page.locator('button:has-text("Save")').click();

    // Verify chain saved (selected)
    await expect(page.locator('text=Test Chain')).toBeVisible();

    // Mock process response
    const mockProcessResult = {
      input_path: '',
      output_path: 'output/processed_audio.wav',
      sample_rate: 48000,
      duration: 120.5,
      channels: 2,
    };

    await page.route('/api/vst/process', async (route) => {
      const request = route.request();
      const postData = request.postDataJSON();
      expect(postData.chain_name).toBe('Test Chain');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockProcessResult),
      });
    });

    // Mock audio library refresh
    await mockApiResponse(page, '/api/audio/library', { files: [] });

    // Click Process Audio button
    const processButton = page.locator('button:has-text("Process Audio")');
    await expect(processButton).toBeEnabled();
    await processButton.click();

    // Wait for processing to complete
    await expect(page.locator('text=Processing Result')).toBeVisible({ timeout: 10000 });

    // Verify processing result
    await expect(page.locator('text=processed_audio.wav')).toBeVisible();
    await expect(page.locator('text=2:00')).toBeVisible(); // 120.5 seconds ≈ 2:00
    await expect(page.locator('text=48000 Hz')).toBeVisible();
    await expect(page.locator('text=2')).toBeVisible(); // channels

    // Verify audio player is present
    await expect(page.locator('audio')).toBeVisible();
  });

  test('drag and drop reorder chain plugins', async ({ page }) => {
    // Mock initial plugins
    const mockPlugins = [
      {
        name: 'PluginA',
        path: '/plugins/PluginA.vst3',
        vendor: 'Vendor',
        version: '1.0.0',
        category: 'effect',
        num_inputs: 2,
        num_outputs: 2,
        parameters: [],
        is_valid: true,
        error_message: '',
      },
      {
        name: 'PluginB',
        path: '/plugins/PluginB.vst3',
        vendor: 'Vendor',
        version: '1.0.0',
        category: 'effect',
        num_inputs: 2,
        num_outputs: 2,
        parameters: [],
        is_valid: true,
        error_message: '',
      },
      {
        name: 'PluginC',
        path: '/plugins/PluginC.vst3',
        vendor: 'Vendor',
        version: '1.0.0',
        category: 'effect',
        num_inputs: 2,
        num_outputs: 2,
        parameters: [],
        is_valid: true,
        error_message: '',
      },
    ];

    await mockApiResponse(page, '/api/vst/plugins', { plugins: mockPlugins });
    await mockApiResponse(page, '/api/vst/chains', { chains: [] });
    await mockApiResponse(page, '/api/audio/library', { files: [] });

    await navigateAndWait(page, '/create/vst');

    // Switch to Chains tab
    await page.locator('button:has-text("Chains")').click();

    // Add three plugins to chain
    await page.locator('text=Click to add plugins to the chain').click();
    await page.locator('button:has-text("PluginA")').first().click();
    await page.locator('text=Click to add plugins to the chain').click();
    await page.locator('button:has-text("PluginB")').first().click();
    await page.locator('text=Click to add plugins to the chain').click();
    await page.locator('button:has-text("PluginC")').first().click();

    // Verify initial order: A, B, C
    const chainItems = page.locator('.chainItem');
    await expect(chainItems.nth(0)).toContainText('PluginA');
    await expect(chainItems.nth(1)).toContainText('PluginB');
    await expect(chainItems.nth(2)).toContainText('PluginC');

    // Drag PluginC to first position (drag from index 2 to index 0)
    const pluginC = chainItems.nth(2);
    const pluginA = chainItems.nth(0);

    await pluginC.dragTo(pluginA);

    // Verify new order: C, A, B
    await expect(chainItems.nth(0)).toContainText('PluginC');
    await expect(chainItems.nth(1)).toContainText('PluginA');
    await expect(chainItems.nth(2)).toContainText('PluginB');
  });

  test('undo/redo chain edits', async ({ page }) => {
    const mockPlugins = [
      {
        name: 'TestPlugin',
        path: '/plugins/TestPlugin.vst3',
        vendor: 'Vendor',
        version: '1.0.0',
        category: 'effect',
        num_inputs: 2,
        num_outputs: 2,
        parameters: [],
        is_valid: true,
        error_message: '',
      },
    ];

    await mockApiResponse(page, '/api/vst/plugins', { plugins: mockPlugins });
    await mockApiResponse(page, '/api/vst/chains', { chains: [] });
    await mockApiResponse(page, '/api/audio/library', { files: [] });

    await navigateAndWait(page, '/create/vst');
    await page.locator('button:has-text("Chains")').click();

    // Add plugin to chain
    await page.locator('text=Click to add plugins to the chain').click();
    await page.locator('button:has-text("TestPlugin")').first().click();

    // Verify plugin in chain
    await expect(page.locator('text=TestPlugin')).toBeVisible();

    // Click undo button (Ctrl+Z)
    await page.keyboard.press('Control+Z');

    // Verify plugin removed (undo)
    await expect(page.locator('text=No chain selected')).toBeVisible();

    // Click redo button (Ctrl+Shift+Z)
    await page.keyboard.press('Control+Shift+Z');

    // Verify plugin restored (redo)
    await expect(page.locator('text=TestPlugin')).toBeVisible();

    // Add another plugin
    await page.locator('text=Click to add plugins to the chain').click();
    await page.locator('button:has-text("TestPlugin")').first().click();

    // Verify two plugins
    const chainItems = page.locator('.chainItem');
    await expect(chainItems).toHaveCount(2);

    // Undo twice
    await page.keyboard.press('Control+Z');
    await expect(chainItems).toHaveCount(1);
    await page.keyboard.press('Control+Z');
    await expect(page.locator('text=No chain selected')).toBeVisible();

    // Redo twice
    await page.keyboard.press('Control+Shift+Z');
    await expect(chainItems).toHaveCount(1);
    await page.keyboard.press('Control+Shift+Z');
    await expect(chainItems).toHaveCount(2);
  });

  test('load plugin parameters', async ({ page }) => {
    const mockPlugins = [
      {
        name: 'TestCompressor',
        path: '/plugins/TestCompressor.vst3',
        vendor: 'TestVendor',
        version: '1.0.0',
        category: 'effect',
        num_inputs: 2,
        num_outputs: 2,
        parameters: [],
        is_valid: true,
        error_message: '',
      },
    ];

    await mockApiResponse(page, '/api/vst/plugins', { plugins: mockPlugins });
    await mockApiResponse(page, '/api/vst/chains', { chains: [] });
    await mockApiResponse(page, '/api/audio/library', { files: [] });

    await navigateAndWait(page, '/create/vst');
    await page.locator('button:has-text("Chains")').click();

    // Add plugin to chain
    await page.locator('text=Click to add plugins to the chain').click();
    await page.locator('button:has-text("TestCompressor")').first().click();

    // Mock parameters response
    const mockParams = {
      parameters: [
        { name: 'Threshold', min: -60, max: 0, default: -20, value: -20, unit: 'dB' },
        { name: 'Ratio', min: 1, max: 20, default: 4, value: 4, unit: 'x' },
        { name: 'Attack', min: 0.1, max: 100, default: 10, value: 10, unit: 'ms' },
        { name: 'Release', min: 10, max: 1000, default: 100, value: 100, unit: 'ms' },
      ],
    };

    await page.route('/api/vst/plugins/TestCompressor/parameters', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockParams),
      });
    });

    // Click settings button on chain item to load parameters
    const settingsButton = page.locator('button[title="Load Parameters"]').first();
    await settingsButton.click();

    // Verify parameter editor opens
    await expect(page.locator('text=Parameters for TestCompressor')).toBeVisible();
    await expect(page.locator('text=Threshold')).toBeVisible();
    await expect(page.locator('text=Ratio')).toBeVisible();
    await expect(page.locator('text=Attack')).toBeVisible();
    await expect(page.locator('text=Release')).toBeVisible();

    // Verify sliders are present
    await expect(page.locator('input[type="range"]').first()).toBeVisible();
  });

  test('remove plugin from chain', async ({ page }) => {
    const mockPlugins = [
      {
        name: 'PluginA',
        path: '/plugins/PluginA.vst3',
        vendor: 'Vendor',
        version: '1.0.0',
        category: 'effect',
        num_inputs: 2,
        num_outputs: 2,
        parameters: [],
        is_valid: true,
        error_message: '',
      },
      {
        name: 'PluginB',
        path: '/plugins/PluginB.vst3',
        vendor: 'Vendor',
        version: '1.0.0',
        category: 'effect',
        num_inputs: 2,
        num_outputs: 2,
        parameters: [],
        is_valid: true,
        error_message: '',
      },
    ];

    await mockApiResponse(page, '/api/vst/plugins', { plugins: mockPlugins });
    await mockApiResponse(page, '/api/vst/chains', { chains: [] });
    await mockApiResponse(page, '/api/audio/library', { files: [] });

    await navigateAndWait(page, '/create/vst');
    await page.locator('button:has-text("Chains")').click();

    // Add two plugins
    await page.locator('text=Click to add plugins to the chain').click();
    await page.locator('button:has-text("PluginA")').first().click();
    await page.locator('text=Click to add plugins to the chain').click();
    await page.locator('button:has-text("PluginB")').first().click();

    // Verify two plugins
    let chainItems = page.locator('.chainItem');
    await expect(chainItems).toHaveCount(2);

    // Click remove button on first plugin
    const removeButton = page.locator('button[title="Remove from Chain"]').first();
    await removeButton.click();

    // Verify one plugin remains
    chainItems = page.locator('.chainItem');
    await expect(chainItems).toHaveCount(1);
    await expect(chainItems.first()).toContainText('PluginB');
  });
});