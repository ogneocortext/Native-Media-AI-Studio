/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideBundlerConfig(enableTailwind);
// GPU + parallel tuning for 6C/12T + GTX 1070 Ti
Config.setConcurrency(6);
Config.setChromiumOpenGlRenderer("angle");
Config.setChromiumHeadlessMode(true);
Config.setCodec("h264");
Config.setVideoBitrate("8000k");
Config.setEnforceAudioTrack(true);
