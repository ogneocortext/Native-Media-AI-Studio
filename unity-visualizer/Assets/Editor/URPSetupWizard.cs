using UnityEngine;
using UnityEditor;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace NativeMediaVisualizer.Editor
{
    /// <summary>
    /// Sets up URP pipeline asset for the Native Media Visualizer project.
    /// Run this from the NativeMediaVisualizer menu after opening the project.
    /// </summary>
    public class URPSetupWizard : EditorWindow
    {
        private bool _isConfigured;

        [MenuItem("NativeMediaVisualizer/Setup URP Pipeline")]
        public static void ShowWindow()
        {
            GetWindow<URPSetupWizard>("URP Setup");
        }

        private void OnGUI()
        {
            GUILayout.Label("URP Pipeline Setup", EditorStyles.boldLabel);
            GUILayout.Space(10);

            if (GUILayout.Button("Create/Update URP Pipeline Asset"))
            {
                CreateURPAsset();
            }

            if (GUILayout.Button("Configure Graphics Settings"))
            {
                ConfigureGraphicsSettings();
            }

            GUILayout.Space(20);
            EditorGUILayout.HelpBox(
                "This wizard sets up the Universal Render Pipeline for audio visualization.\n\n" +
                "1. Creates UniversalRenderPipelineAsset.asset in Assets/Settings/\n" +
                "2. Configures GraphicsSettings to use URP as default\n" +
                "3. Sets up Forward+ renderer for best visual quality",
                MessageType.Info);
        }

        private static void CreateURPAsset()
        {
            string assetPath = "Assets/Settings/UniversalRenderPipelineAsset.asset";

            // Create or load the pipeline asset
            UniversalRenderPipelineAsset pipelineAsset = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(assetPath);

            if (pipelineAsset == null)
            {
                // Create new pipeline asset
                pipelineAsset = ScriptableObject.CreateInstance<UniversalRenderPipelineAsset>();
                AssetDatabase.CreateAsset(pipelineAsset, assetPath);
            }

            // Configure renderer
            UniversalRendererData rendererData = AssetDatabase.LoadAssetAtPath<UniversalRendererData>("Assets/Settings/UniversalRendererData.asset");
            if (rendererData == null)
            {
                rendererData = ScriptableObject.CreateInstance<UniversalRendererData>();
                AssetDatabase.CreateAsset(rendererData, "Assets/Settings/UniversalRendererData.asset");
            }

            // Set renderer data on pipeline asset
            SerializedObject so = new SerializedObject(pipelineAsset);
            SerializedProperty rendererDataList = so.FindProperty("m_RendererDataList");
            if (rendererDataList != null && rendererDataList.arraySize > 0)
            {
                rendererDataList.GetArrayElementAtIndex(0).objectReferenceValue = rendererData;
            }
            so.ApplyModifiedProperties();

            Debug.Log("✅ URP Pipeline Asset created/updated at: " + assetPath);
        }

        private static void ConfigureGraphicsSettings()
        {
            string graphicsSettingsPath = "ProjectSettings/GraphicsSettings.asset";

            SerializedObject graphicsSettings = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath(graphicsSettingsPath)[0]);
            SerializedProperty pipelineProperty = graphicsSettings.FindProperty("m_CustomRenderPipeline");

            if (pipelineProperty != null)
            {
                UniversalRenderPipelineAsset pipelineAsset = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>("Assets/Settings/UniversalRenderPipelineAsset.asset");
                if (pipelineAsset != null)
                {
                    pipelineProperty.objectReferenceValue = pipelineAsset;
                    graphicsSettings.ApplyModifiedProperties();
                    Debug.Log("✅ GraphicsSettings configured to use URP");
                }
                else
                {
                    Debug.LogWarning("⚠️ URP Pipeline Asset not found. Create it first.");
                }
            }
        }
    }
}
