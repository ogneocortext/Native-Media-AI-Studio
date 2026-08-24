using UnityEngine;
using UnityEditor;

public class BeatAnimationCreator
{
    public static void CreateBeatAnimation()
    {
        var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>("Assets/Animations/beat_pulse.anim");
        if (clip == null) { Debug.Log("Clip not found"); return; }
        
        float[] beatTimes = {1.277f, 1.672f, 2.067f, 2.461f, 2.856f, 3.251f, 3.646f, 4.04f};
        var scaleX = new AnimationCurve();
        var scaleY = new AnimationCurve();
        var scaleZ = new AnimationCurve();
        
        for (int i = 0; i < beatTimes.Length; i++)
        {
            float scale = (i % 2 == 0) ? 2f : 1.5f;
            scaleX.AddKey(beatTimes[i], scale);
            scaleY.AddKey(beatTimes[i], scale);
            scaleZ.AddKey(beatTimes[i], scale);
        }
        
        clip.SetCurve("", typeof(Transform), "m_LocalScale.x", scaleX);
        clip.SetCurve("", typeof(Transform), "m_LocalScale.y", scaleY);
        clip.SetCurve("", typeof(Transform), "m_LocalScale.z", scaleZ);
        
        AssetDatabase.SaveAssets();
        Debug.Log("Animation curves set for " + beatTimes.Length + " beats");
    }
}
