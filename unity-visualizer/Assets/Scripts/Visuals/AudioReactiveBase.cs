using UnityEngine;
using NativeMediaVisualizer.Audio;

namespace NativeMediaVisualizer.Visuals
{
    /// <summary>
    /// Base class for audio-reactive visual components.
    /// Subclass this to create custom audio-reactive behaviors.
    /// </summary>
    public abstract class AudioReactiveBase : MonoBehaviour
    {
        [Header("Audio Reference")]
        public AudioAnalyzer analyzer;

        [Header("Reactivity")]
        public int bandIndex = 0;
        public float intensityMultiplier = 1.0f;
        public float smoothSpeed = 10f;

        protected float _currentValue;
        protected float _targetValue;

        protected virtual void Update()
        {
            if (analyzer == null) return;

            _targetValue = analyzer.GetBandValue(bandIndex) * intensityMultiplier;
            _currentValue = Mathf.Lerp(_currentValue, _targetValue, Time.deltaTime * smoothSpeed);
        }

        /// <summary>
        /// Gets the current smoothed audio value for this component.
        /// </summary>
        public float CurrentValue => _currentValue;

        /// <summary>
        /// Gets the raw target audio value.
        /// </summary>
        public float TargetValue => _targetValue;
    }
}
