using UnityEngine;
using NativeMediaVisualizer.Audio;

namespace NativeMediaVisualizer.Visuals
{
    /// <summary>
    /// Simple beat-synced pulse effect for any GameObject.
    /// Attach to a GameObject with a Renderer to pulse scale/emission on beat.
    /// </summary>
    public class BeatPulse : MonoBehaviour
    {
        [Header("Audio Reference")]
        public AudioAnalyzer analyzer;

        [Header("Pulse Settings")]
        public float pulseScale = 1.3f;
        public float pulseDuration = 0.15f;
        public AnimationCurve pulseCurve = AnimationCurve.EaseInOut(0, 1, 1, 1);

        [Header("Intensity")]
        public float minIntensity = 0.3f;
        public float maxIntensity = 1.0f;

        private Renderer _renderer;
        private MaterialPropertyBlock _mpb;
        private float _pulseTime;
        private bool _isPulsing;
        private Color _originalColor;
        private float _originalEmission;

        private void Awake()
        {
            _renderer = GetComponent<Renderer>();
            _mpb = new MaterialPropertyBlock();
        }

        private void Update()
        {
            if (analyzer == null || _renderer == null) return;

            // Check for beat
            if (analyzer.IsBeat)
            {
                float intensity = Mathf.Lerp(minIntensity, maxIntensity, analyzer.BeatIntensity);
                StartPulse(intensity);
            }

            // Animate pulse
            if (_isPulsing)
            {
                _pulseTime += Time.deltaTime / pulseDuration;
                if (_pulseTime >= 1f)
                {
                    _pulseTime = 0f;
                    _isPulsing = false;
                    ResetPulse();
                }
                else
                {
                    float curveValue = pulseCurve.Evaluate(_pulseTime);
                    ApplyPulse(curveValue);
                }
            }
        }

        private void StartPulse(float intensity)
        {
            _isPulsing = true;
            _pulseTime = 0f;
            _originalColor = _renderer.material.color;
            _originalEmission = _renderer.material.GetFloat("_EmissionIntensity");

            // Store original values if not already stored
            if (!_renderer.HasPropertyBlock())
            {
                _renderer.GetPropertyBlock(_mpb);
            }
        }

        private void ApplyPulse(float curveValue)
        {
            float scale = 1f + (pulseScale - 1f) * curveValue;
            transform.localScale = Vector3.one * scale;

            // Pulse emission if available
            if (_renderer.material.HasProperty("_EmissionIntensity"))
            {
                _mpb.SetFloat("_EmissionIntensity", _originalEmission * curveValue);
                _renderer.SetPropertyBlock(_mpb);
            }
        }

        private void ResetPulse()
        {
            transform.localScale = Vector3.one;

            if (_renderer.material.HasProperty("_EmissionIntensity"))
            {
                _mpb.SetFloat("_EmissionIntensity", _originalEmission);
                _renderer.SetPropertyBlock(_mpb);
            }
        }
    }
}
