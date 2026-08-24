using UnityEngine;
using UnityEditor;
using System.Collections;
using System.Collections.Generic;
using System.IO;

/// <summary>
/// Coronation scene generator for "Take the Crown" by NeoCortext.
/// Builds the full scene programmatically, animates to beat, renders frames.
/// </summary>
public class CoronationScene : MonoBehaviour
{
    [Header("Audio")]
    public AudioSource audioSource;
    public string audioPath = "Assets/Audio/take-the-crown.mp3";
    
    [Header("Render Settings")]
    public int fps = 24;
        public int durationSeconds = 15;
    public int resolutionWidth = 1280;
    public int resolutionHeight = 720;
    public string outputPath = "Assets/Textures/render_frames/frame_";
    
    [Header("Crown")]
    public GameObject crown;
    public float beatInterval = 0.394f; // 152 BPM
    public float pulseScale = 1.3f;
    
    [Header("Embers")]
    public ParticleSystem embers;
    public int embersIntro = 10;
    public int embersDrop = 34;
    public int embersVerse = 18;
    public int embersBuild = 26;
    
    [Header("Lighting")]
    public Light sun;
    public Light[] emberLights;
    public Color introColor = new Color(0.4f, 0.3f, 0.2f);
    public Color goldColor = new Color(1f, 0.85f, 0.4f);
    public Color ashColor = new Color(0.04f, 0.03f, 0.02f);
    
    private int frameCount = 0;
    private float timer = 0f;
    private float beatTimer = 0f;
    private bool isRendering = false;
    
    void Start()
    {
        BuildScene();
        StartCoroutine(RenderFrames());
    }
    
    void BuildScene()
    {
        // Load audio
        var audioClip = AssetDatabase.LoadAssetAtPath<AudioClip>(audioPath);
        if (audioClip != null)
        {
            audioSource.clip = audioClip;
            audioSource.Play();
        }
        
        // Create ground
        GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
        ground.name = "Ground";
        ground.transform.localScale = new Vector3(2, 1, 2);
        var groundRenderer = ground.GetComponent<Renderer>();
        var ashMat = new Material(Shader.Find("Standard"));
        ashMat.color = ashColor;
        ashMat.SetFloat("_Metallic", 0.1f);
        ashMat.SetFloat("_Glossiness", 0.1f);
        groundRenderer.material = ashMat;
        
        // Create crown from primitives (fallback if FBX not imported)
        if (crown == null)
        {
            crown = CreateCrown();
        }
        
        // Setup lighting
        if (sun == null)
        {
            GameObject sunObj = new GameObject("Sun");
            sun = sunObj.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = introColor;
            sun.intensity = 2f;
            sunObj.transform.rotation = Quaternion.Euler(50, -30, 0);
        }
        
        if (emberLights == null || emberLights.Length == 0)
        {
            emberLights = new Light[2];
            for (int i = 0; i < 2; i++)
            {
                GameObject lightObj = new GameObject($"EmberLight_{i}");
                emberLights[i] = lightObj.AddComponent<Light>();
                emberLights[i].type = LightType.Point;
                emberLights[i].color = new Color(1f, 0.4f, 0.1f);
                emberLights[i].intensity = 5f;
                emberLights[i].range = 10f;
                lightObj.transform.position = new Vector3(i == 0 ? -3 : 3, 1, 1);
            }
        }
        
        // Create embers particle system
        if (embers == null)
        {
            GameObject emberObj = new GameObject("Embers");
            embers = emberObj.AddComponent<ParticleSystem>();
            var main = embers.main;
            main.maxParticles = 50;
            main.startLifetime = 3f;
            main.startSpeed = 1f;
            main.startSize = 0.05f;
            var emission = embers.emission;
            emission.rateOverTime = embersIntro;
            var shape = embers.shape;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 25f;
            shape.radius = 3f;
        }
        
        // Position camera
        Camera.main.transform.position = new Vector3(0, 3, -8);
        Camera.main.transform.rotation = Quaternion.Euler(15, 0, 0);
        Camera.main.fieldOfView = 45f;
        
        // Create output directory
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
    }
    
    GameObject CreateCrown()
    {
        GameObject crownRoot = new GameObject("Crown");
        crownRoot.transform.position = Vector3.zero;
        
        // Gold material
        var goldMat = new Material(Shader.Find("Standard"));
        goldMat.color = new Color(0.79f, 0.6f, 0.2f);
        goldMat.SetFloat("_Metallic", 0.92f);
        goldMat.SetFloat("_Glossiness", 0.3f);
        
        // Band
        GameObject band = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        band.name = "CrownBand";
        band.transform.parent = crownRoot.transform;
        band.transform.localPosition = new Vector3(0, 0.25f, 0);
        band.transform.localScale = new Vector3(1.6f, 0.5f, 1.6f);
        band.GetComponent<Renderer>().material = goldMat;
        
        // Spikes
        for (int i = 0; i < 6; i++)
        {
            float angle = (i / 6f) * Mathf.PI * 2;
            GameObject spike = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            spike.name = $"Spike_{i}";
            spike.transform.parent = crownRoot.transform;
            spike.transform.localPosition = new Vector3(Mathf.Cos(angle) * 0.7f, 0.7f, Mathf.Sin(angle) * 0.7f);
            spike.transform.localScale = new Vector3(0.1f, 0.4f, 0.1f);
            spike.GetComponent<Renderer>().material = goldMat;
        }
        
        // Apex orb
        GameObject orb = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        orb.name = "CrownOrb";
        orb.transform.parent = crownRoot.transform;
        orb.transform.localPosition = new Vector3(0, 1.05f, 0);
        orb.transform.localScale = Vector3.one * 0.3f;
        var orbMat = new Material(Shader.Find("Standard"));
        orbMat.color = new Color(1f, 0.95f, 0.77f);
        orbMat.SetColor("_EmissionColor", new Color(1f, 0.95f, 0.77f) * 2f);
        orbMat.EnableKeyword("_EMISSION");
        orb.GetComponent<Renderer>().material = orbMat;
        
        return crownRoot;
    }
    
    IEnumerator RenderFrames()
    {
        isRendering = true;
        frameCount = 0;
        float interval = 1f / fps;
        
        var wait = new WaitForSeconds(interval);
        
        while (frameCount < fps * durationSeconds)
        {
            yield return wait;
            
            // Animate to beat
            beatTimer += interval;
            if (beatTimer >= beatInterval)
            {
                beatTimer = 0f;
                StartCoroutine(PulseCrown());
            }
            
            // Capture frame
            frameCount++;
            string path = outputPath + frameCount.ToString("D4") + ".png";
            ScreenCapture.CaptureScreenshot(path);
            
            // Progress
            if (frameCount % 24 == 0)
            {
                Debug.Log($"Rendered {frameCount}/{fps * durationSeconds} frames ({frameCount / fps}s)");
            }
        }
        
        isRendering = false;
        Debug.Log($"Render complete: {frameCount} frames");
        #if UNITY_EDITOR
        EditorApplication.isPlaying = false;
        #endif
    }
    
    IEnumerator PulseCrown()
    {
        if (crown == null) yield break;
        
        float elapsed = 0f;
        float duration = 0.2f;
        
        while (elapsed < duration)
        {
            elapsed += Time.deltaTime;
            float t = elapsed / duration;
            float scale = Mathf.Lerp(1f, pulseScale, 1f - t);
            crown.transform.localScale = Vector3.one * scale;
            yield return null;
        }
        
        crown.transform.localScale = Vector3.one;
    }
    
    void Update()
    {
        // Camera orbit during build section (3-6s)
        if (Time.timeSinceLevelLoad > 3f && Time.timeSinceLevelLoad < 6f)
        {
            float angle = (Time.timeSinceLevelLoad - 3f) * 0.3f;
            Camera.main.transform.position = new Vector3(Mathf.Sin(angle) * 8, 3, Mathf.Cos(angle) * -8);
            Camera.main.transform.LookAt(Vector3.zero);
        }
    }
}
