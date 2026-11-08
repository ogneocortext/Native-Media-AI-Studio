import { describe, it, expect } from "vitest";
import { PluginInfo, Chain, ChainPlugin } from "./types";

/* ------------------------------------------------------------------ */
/* Chain Operation Utilities                                          */
/* ------------------------------------------------------------------ */

export function addPluginToChain(
  chainPlugins: ChainPlugin[],
  plugin: PluginInfo
): ChainPlugin[] {
  return [...chainPlugins, { name: plugin.name, parameters: {} }];
}

export function removePluginFromChain(
  chainPlugins: ChainPlugin[],
  index: number
): ChainPlugin[] {
  return chainPlugins.filter((_, i) => i !== index);
}

export function reorderChainPlugins(
  chainPlugins: ChainPlugin[],
  fromIndex: number,
  toIndex: number
): ChainPlugin[] {
  if (fromIndex === toIndex) return chainPlugins;
  if (fromIndex < 0 || fromIndex >= chainPlugins.length) return chainPlugins;
  if (toIndex < 0 || toIndex >= chainPlugins.length) return chainPlugins;

  const newPlugins = [...chainPlugins];
  const [removed] = newPlugins.splice(fromIndex, 1);
  newPlugins.splice(toIndex, 0, removed);
  return newPlugins;
}

export function updatePluginParameters(
  chainPlugins: ChainPlugin[],
  pluginIndex: number,
  parameters: Record<string, number>
): ChainPlugin[] {
  return chainPlugins.map((p, i) =>
    i === pluginIndex ? { ...p, parameters } : p
  );
}

export function createChain(
  name: string,
  plugins: ChainPlugin[],
  sampleRate = 48000,
  blockSize = 512
): Chain {
  return {
    name: name.trim(),
    plugins,
    sample_rate: sampleRate,
    block_size: blockSize,
  };
}

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

describe("Chain Operations", () => {
  const mockPlugin: PluginInfo = {
    name: "TestPlugin",
    path: "/test/path",
    vendor: "TestVendor",
    version: "1.0.0",
    category: "effect",
    num_inputs: 2,
    num_outputs: 2,
    parameters: [],
    is_valid: true,
    error_message: "",
  };

  const mockChainPlugin: ChainPlugin = {
    name: "ExistingPlugin",
    parameters: { gain: 0.5 },
  };

  describe("addPluginToChain", () => {
    it("adds plugin to empty chain", () => {
      const result = addPluginToChain([], mockPlugin);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("TestPlugin");
      expect(result[0].parameters).toEqual({});
    });

    it("adds plugin to existing chain", () => {
      const result = addPluginToChain([mockChainPlugin], mockPlugin);
      expect(result).toHaveLength(2);
      expect(result[1].name).toBe("TestPlugin");
    });

    it("does not mutate original array", () => {
      const original = [mockChainPlugin];
      addPluginToChain(original, mockPlugin);
      expect(original).toHaveLength(1);
    });
  });

  describe("removePluginFromChain", () => {
    it("removes plugin at valid index", () => {
      const chain = [mockChainPlugin, { name: "Plugin2", parameters: {} }];
      const result = removePluginFromChain(chain, 0);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Plugin2");
    });

    it("returns original array for invalid index", () => {
      const chain = [mockChainPlugin];
      const result = removePluginFromChain(chain, 5);
      expect(result).toHaveLength(1);
    });

    it("does not mutate original array", () => {
      const original = [mockChainPlugin, { name: "Plugin2", parameters: {} }];
      removePluginFromChain(original, 0);
      expect(original).toHaveLength(2);
    });
  });

  describe("reorderChainPlugins", () => {
    it("moves plugin from lower to higher index", () => {
      const chain = [
        { name: "A", parameters: {} },
        { name: "B", parameters: {} },
        { name: "C", parameters: {} },
      ];
      const result = reorderChainPlugins(chain, 0, 2);
      expect(result.map(p => p.name)).toEqual(["B", "C", "A"]);
    });

    it("moves plugin from higher to lower index", () => {
      const chain = [
        { name: "A", parameters: {} },
        { name: "B", parameters: {} },
        { name: "C", parameters: {} },
      ];
      const result = reorderChainPlugins(chain, 2, 0);
      expect(result.map(p => p.name)).toEqual(["C", "A", "B"]);
    });

    it("returns original array for same index", () => {
      const chain = [
        { name: "A", parameters: {} },
        { name: "B", parameters: {} },
      ];
      const result = reorderChainPlugins(chain, 0, 0);
      expect(result).toBe(chain);
    });

    it("returns original array for out of bounds indices", () => {
      const chain = [{ name: "A", parameters: {} }];
      expect(reorderChainPlugins(chain, -1, 0)).toBe(chain);
      expect(reorderChainPlugins(chain, 0, 5)).toBe(chain);
    });

    it("does not mutate original array", () => {
      const original = [
        { name: "A", parameters: {} },
        { name: "B", parameters: {} },
      ];
      reorderChainPlugins(original, 0, 1);
      expect(original[0].name).toBe("A");
    });
  });

  describe("updatePluginParameters", () => {
    it("updates parameters for plugin at index", () => {
      const chain: ChainPlugin[] = [
        { name: "A", parameters: { gain: 0.5 } },
        { name: "B", parameters: { freq: 440 } },
      ];
      const result = updatePluginParameters(chain, 0, { gain: 0.8, pan: 0.3 });
      expect(result[0].parameters).toEqual({ gain: 0.8, pan: 0.3 });
      expect(result[1].parameters).toEqual({ freq: 440 });
    });

    it("returns new array for invalid index (function always creates new array)", () => {
      const chain = [{ name: "A", parameters: { gain: 0.5 } }];
      const result = updatePluginParameters(chain, 5, { gain: 0.8 });
      expect(result).toHaveLength(1);
      expect(result[0].parameters.gain).toBe(0.5);
    });

    it("does not mutate original array", () => {
      const original = [{ name: "A", parameters: { gain: 0.5 } }];
      updatePluginParameters(original, 0, { gain: 0.8 });
      expect(original[0].parameters.gain).toBe(0.5);
    });
  });

  describe("createChain", () => {
    it("creates chain with all properties", () => {
      const plugins: ChainPlugin[] = [{ name: "Test", parameters: {} }];
      const chain = createChain("My Chain", plugins, 44100, 256);
      expect(chain.name).toBe("My Chain");
      expect(chain.plugins).toBe(plugins);
      expect(chain.sample_rate).toBe(44100);
      expect(chain.block_size).toBe(256);
    });

    it("trims chain name", () => {
      const chain = createChain("  Trimmed  ", []);
      expect(chain.name).toBe("Trimmed");
    });

    it("uses defaults for sample rate and block size", () => {
      const chain = createChain("Default", []);
      expect(chain.sample_rate).toBe(48000);
      expect(chain.block_size).toBe(512);
    });
  });
});