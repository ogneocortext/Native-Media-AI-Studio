using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace NativeMediaStudio
{
    /// <summary>
    /// Batch-mode entry point for the Unity Pipeline runtime.
    /// The com.unity.pipeline package owns the HTTP server and port descriptor;
    /// this method keeps the project alive after Unity has initialized it.
    /// </summary>
    public static class HeadlessPipelineBootstrap
    {
        public static void Start()
        {
            Debug.Log("[NativeMediaStudio] Headless Unity Pipeline bootstrap starting.");
            Debug.Log($"[NativeMediaStudio] Batch mode: {Application.isBatchMode}");
            // Keep the project in Edit mode: Unity Pipeline authoring commands
            // (material/component changes) are blocked during Play mode.
            Debug.Log("[NativeMediaStudio] Headless Unity Pipeline bootstrap ready in Edit mode.");
        }

    }
}
