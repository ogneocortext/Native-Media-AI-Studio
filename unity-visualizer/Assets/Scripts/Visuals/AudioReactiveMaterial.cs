using UnityEngine;
using NativeMediaVisualizer.Audio;

namespace NativeMediaVisualizer.Visuals
{
    /// <summary>
    /// Drives material properties from audio data in real-time.
    /// Use this to make any material react to audio without writing custom shaders.
    /// </summary>
    public class AudioReactiveMaterial : MonoBehaviour
    {
        [Header("Audio Reference")]
        public AudioAnalyzer analyzer;

        [Header("Material Properties")]
        public Renderer targetRenderer;
        public int bandIndex = 0;
        public float intensityMultiplier = 1.0f;

        [Header("Property Names")]
        public string emissionProperty = "_EmissionIntensity";
        public string colorProperty = "_BaseColor";
        public string scaleProperty = "_Tiling";

        [Header("Intensity Range")]
        public float minIntensity = 0.1f;
        public float maxIntensity = 2.0f;

        private MaterialPropertyBlock _mpb;
        private Color _originalColor;
        private float _originalEmission;
        private Vector2 _originalTiling;

        private void Awake()
        {
            if (targetRenderer == null)
            {
                targetRenderer = GetComponent<Renderer>();
            }

            _mpb = new MaterialPropertyBlock();
            CacheOriginalValues();
        }

        private void CacheOriginalValues()
        {
            if (targetRenderer == null) return;

            targetRenderer.GetPropertyBlock(_mpb);

            if (targetRenderer.material.HasProperty(colorProperty))
            {
                _originalColor = targetRenderer.material.color;
            }

            if (targetRenderer.material.HasProperty(emissionProperty))
            {
                _originalEmission = targetRenderer.material.GetFloat(emissionProperty);
            }

            if (targetRenderer.material.HasProperty(scaleProperty))
            {
                _originalTiling = targetRenderer.material.mainTextureScale;
            }
        }

        private void Update()
        {
            if (analyzer == null || targetRenderer == null) return;

            float bandValue = analyzer.GetBandValue(bandIndex) * intensityMultiplier;
            float normalizedValue = Mathf.Lerp(minIntensity, maxIntensity, bandValue);

            _mpb.Clear();

            // Apply emission intensity
            if (targetRenderer.material.HasProperty(emissionProperty))
            {
                _mpb.SetFloat(emissionProperty, _originalEmission * normalizedValue);
            }

            // Apply color brightness
            if (targetRenderer.material.HasProperty(colorProperty))
            {
                Color brightColor = _originalColor * normalizedValue;
                _mpb.SetColor(colorProperty, brightColor);
            }

            targetRenderer.SetPropertyBlock(_mpb);
        }
    }
}
