/* ------------------------------------------------------------------ */
/* Type Definitions                                                   */
/* ------------------------------------------------------------------ */

export interface PluginParameter {
  name: string;
  min: number;
  max: number;
  default: number;
  value: number;
  unit: string;
}

export interface PluginInfo {
  name: string;
  path: string;
  vendor: string;
  version: string;
  category: string;
  num_inputs: number;
  num_outputs: number;
  parameters: PluginParameter[];
  is_valid: boolean;
  error_message: string;
}

export interface ChainPlugin {
  name: string;
  parameters: Record<string, number>;
}

export interface Chain {
  name: string;
  plugins: ChainPlugin[];
  sample_rate: number;
  block_size: number;
}

export interface Preset {
  plugin_name: string;
  name: string;
  parameters: Record<string, number>;
}

export interface ProcessResult {
  input_path: string;
  output_path: string;
  sample_rate: number;
  duration: number;
  channels: number;
}