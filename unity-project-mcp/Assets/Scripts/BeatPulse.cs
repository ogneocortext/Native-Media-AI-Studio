using UnityEngine;

public class BeatPulse : MonoBehaviour
{
    public float beatInterval = 0.394f; // 152 BPM = 0.394s per beat
    public float pulseScale = 1.3f;
    public float decaySpeed = 5f;
    
    private float targetScale = 1f;
    private float currentScale = 1f;
    private float timer = 0f;
    
    void Update()
    {
        timer += Time.deltaTime;
        
        if (timer >= beatInterval)
        {
            timer = 0f;
            targetScale = pulseScale;
        }
        
        targetScale = Mathf.Lerp(targetScale, 1f, Time.deltaTime * decaySpeed);
        currentScale = Mathf.Lerp(currentScale, targetScale, Time.deltaTime * 10f);
        
        transform.localScale = Vector3.one * currentScale;
    }
}
