using UnityEngine;

public class AutoCapture : MonoBehaviour
{
    public int fps = 24;
    public int durationSeconds = 10;
    public string outputPath = "Assets/Textures/auto_frame";
    
    private int frameCount = 0;
    private float timer = 0f;
    private float interval;
    
    void Start()
    {
        interval = 1f / fps;
        Screen.SetResolution(1280, 720, false);
    }
    
    void Update()
    {
        timer += Time.deltaTime;
        
        if (timer >= interval)
        {
            timer = 0f;
            frameCount++;
            string path = outputPath + "_" + frameCount.ToString("D4") + ".png";
            ScreenCapture.CaptureScreenshot(path);
        }
        
        if (frameCount >= fps * durationSeconds)
        {
            Debug.Log("Capture complete: " + frameCount + " frames");
            #if UNITY_EDITOR
            UnityEditor.EditorApplication.isPlaying = false;
            #endif
        }
    }
}
