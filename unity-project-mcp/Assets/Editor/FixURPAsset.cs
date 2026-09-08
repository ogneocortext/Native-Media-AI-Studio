using UnityEditor;
using UnityEngine;

public static class FixURPAsset
{
    public static void Fix()
    {
        var pipelineAsset = AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset>("Assets/Settings/UniversalRenderPipelineAsset.asset");
        if (pipelineAsset == null)
        {
            Debug.LogError("URP asset not found");
            return;
        }

        var rendererData = AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.Universal.UniversalRendererData>("Assets/Settings/UniversalRendererData.asset");
        if (rendererData == null)
        {
            Debug.LogError("Renderer data asset not found");
            return;
        }

        Debug.Log($"Found renderer data: {rendererData.name} (guid: {AssetDatabase.AssetPathToGUID(AssetDatabase.GetAssetPath(rendererData))})");
        
        var so = new SerializedObject(pipelineAsset);
        var rendererList = so.FindProperty("m_RendererDataList");
        if (rendererList == null)
        {
            Debug.LogError("m_RendererDataList property not found");
            return;
        }

        rendererList.arraySize = 1;
        rendererList.GetArrayElementAtIndex(0).objectReferenceValue = rendererData;
        so.ApplyModifiedProperties();
        
        Debug.Log($"Set default renderer to: {rendererData.name}");
    }
}
