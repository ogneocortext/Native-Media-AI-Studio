using UnityEngine;

/// <summary>
/// Feeds AudioAnalyzer band/beat data into a material's shader uniforms
/// via a shared MaterialPropertyBlock. Attach to the same GameObject as the
/// renderer you want to drive (or assign target explicitly).
/// </summary>
[RequireComponent(typeof(Renderer))]
public class AudioReactiveShader : MonoBehaviour
{
    [Header("Source")]
    public AudioAnalyzer analyzer;

    [Header("Target")]
    public Renderer target;

    [Header("Tuning")]
    public float displacementStrength = 0.3f;
    public float noiseFrequency = 4.0f;
    public float rimPower = 3.0f;
    public float intensity = 1.0f;

    private MaterialPropertyBlock _mpb;
    private static readonly int BandLevelsId = Shader.PropertyToID("_BandLevels");
    private static readonly int BeatLevelId = Shader.PropertyToID("_BeatLevel");
        private static readonly int TimeId = Shader.PropertyToID("_AudioTime");
    private static readonly int DisplacementStrengthId = Shader.PropertyToID("_DisplacementStrength");
    private static readonly int NoiseFrequencyId = Shader.PropertyToID("_NoiseFrequency");
    private static readonly int RimPowerId = Shader.PropertyToID("_RimPower");
    private static readonly int IntensityId = Shader.PropertyToID("_Intensity");

    private void Reset()
    {
        if (target == null) target = GetComponent<Renderer>();
        if (analyzer == null) analyzer = FindObjectOfType<AudioAnalyzer>();
    }

    private void Update()
    {
        if (analyzer == null || target == null) return;

        _mpb ??= new MaterialPropertyBlock();
        target.GetPropertyBlock(_mpb);

        // Audio data
        if (analyzer.SmoothedBandValues != null && analyzer.SmoothedBandValues.Length >= 8)
        {
            _mpb.SetFloatArray(BandLevelsId, analyzer.SmoothedBandValues);
        }

        _mpb.SetFloat(BeatLevelId, analyzer.BeatIntensity);
        _mpb.SetFloat(TimeId, Time.time);

        // Tuning
        _mpb.SetFloat(DisplacementStrengthId, displacementStrength);
        _mpb.SetFloat(NoiseFrequencyId, noiseFrequency);
        _mpb.SetFloat(RimPowerId, rimPower);
        _mpb.SetFloat(IntensityId, intensity);

        target.SetPropertyBlock(_mpb);
    }
}
