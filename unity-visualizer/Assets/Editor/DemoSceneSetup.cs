using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using NativeMediaVisualizer.Audio;
using NativeMediaVisualizer.Visuals;

namespace NativeMediaVisualizer.Editor
{
    /// <summary>
    /// Sets up a demo audio visualization scene with basic reactive objects.
    /// Run this from the NativeMediaVisualizer menu.
    /// </summary>
    public class DemoSceneSetup : EditorWindow
    {
        [MenuItem("NativeMediaVisualizer/Setup Demo Scene")]
        public static void ShowWindow()
        {
            GetWindow<DemoSceneSetup>("Demo Scene Setup");
            CreateDemoScene();
        }

        private void OnGUI()
        {
            GUILayout.Label("Demo Scene Setup", EditorStyles.boldLabel);
            GUILayout.Space(10);

            if (GUILayout.Button("Create Demo Scene"))
            {
                CreateDemoScene();
            }

            GUILayout.Space(20);
            EditorGUILayout.HelpBox(
                "Creates a demo scene with:\n" +
                "• AudioAnalyzer component\n" +
                "• Grid of reactive cubes\n" +
                "• Central pulsing sphere\n" +
                "• Audio source for testing\n" +
                "• Demo material",
                MessageType.Info);
        }

        private static void CreateDemoScene()
        {
            // Create new scene in edit mode
            var newScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EditorSceneManager.SetActiveScene(newScene);

            // Create main camera
            Camera cam = new GameObject("Main Camera").AddComponent<Camera>();
            cam.transform.position = new Vector3(0, 5, -10);
            cam.transform.LookAt(Vector3.zero);
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.05f, 0.05f, 0.1f);

            // Create directional light
            GameObject lightObj = new GameObject("Directional Light");
            Light light = lightObj.AddComponent<Light>();
            light.type = LightType.Directional;
            light.transform.rotation = Quaternion.Euler(50, -30, 0);
            light.color = new Color(0.9f, 0.95f, 1f);
            light.intensity = 1.0f;

            // Create audio analyzer
            GameObject analyzerObj = new GameObject("AudioAnalyzer");
            AudioAnalyzer analyzer = analyzerObj.AddComponent<AudioAnalyzer>();
            analyzer.bandCount = 8;
            analyzer.sampleSize = 512;
            analyzer.fftWindow = FFTWindow.BlackmanHarris;

            // Create audio source
            GameObject audioObj = new GameObject("AudioSource");
            AudioSource audioSource = audioObj.AddComponent<AudioSource>();
            audioSource.playOnAwake = false;
            audioSource.loop = true;
            analyzer.audioSource = audioSource;

            // Create visualizer plane
            GameObject planeObj = GameObject.CreatePrimitive(PrimitiveType.Plane);
            planeObj.name = "Visualizer Plane";
            planeObj.transform.position = Vector3.zero;
            planeObj.transform.rotation = Quaternion.Euler(0, 0, 0);
            planeObj.transform.localScale = new Vector3(2, 1, 1);

            // Create grid of reactive cubes
            int gridSize = 8;
            float spacing = 1.2f;
            float startX = -((gridSize - 1) * spacing) / 2f;

            for (int x = 0; x < gridSize; x++)
            {
                for (int z = 0; z < gridSize; z++)
                {
                    GameObject cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    cube.name = $"Bar_{x}_{z}";
                    cube.transform.position = new Vector3(
                        startX + x * spacing,
                        0.5f,
                        startX + z * spacing
                    );
                    cube.transform.localScale = new Vector3(0.8f, 1f, 0.8f);

                    // Add audio reactive base
                    AudioReactiveBase reactive = cube.AddComponent<AudioReactiveBase>();
                    reactive.analyzer = analyzer;
                    reactive.bandIndex = x % 8; // Map to different bands
                    reactive.intensityMultiplier = 3.0f;
                }
            }

            // Create central sphere
            GameObject sphereObj = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            sphereObj.name = "Central Sphere";
            sphereObj.transform.position = new Vector3(0, 1.5f, 0);
            sphereObj.transform.localScale = new Vector3(2, 2, 2);

            BeatPulse pulse = sphereObj.AddComponent<BeatPulse>();
            pulse.analyzer = analyzer;
            pulse.pulseScale = 1.2f;
            pulse.pulseDuration = 0.2f;

            // Create demo material
            Material demoMaterial = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            demoMaterial.name = "DemoMaterial";
            demoMaterial.color = new Color(0.2f, 0.6f, 1f);
            demoMaterial.EnableKeyword("_EMISSION");
            demoMaterial.SetColor("_EmissionColor", new Color(0.1f, 0.3f, 0.5f));

            AssetDatabase.CreateAsset(demoMaterial, "Assets/Materials/DemoMaterial.mat");

            // Apply material to sphere
            sphereObj.GetComponent<Renderer>().material = demoMaterial;

            // Save scene
            UnityEngine.SceneManagement.Scene newScene2 = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            EditorSceneManager.SaveScene(newScene2, "Assets/Scenes/DemoVisualizer.unity");
            EditorSceneManager.OpenScene("Assets/Scenes/DemoVisualizer.unity");

            Debug.Log("✅ Demo scene created at Assets/Scenes/DemoVisualizer.unity");
        }
    }
}
