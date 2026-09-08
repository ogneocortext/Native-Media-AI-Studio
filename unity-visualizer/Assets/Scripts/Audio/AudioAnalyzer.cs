using System;
using UnityEngine;

namespace NativeMediaVisualizer.Audio
{
    /// <summary>
    /// Real-time audio spectrum analyzer using FFT.
    /// Provides frequency band data, beat detection, and smoothed audio values.
    /// </summary>
    public class AudioAnalyzer : MonoBehaviour
    {
        [Header("Audio Source")]
        [Tooltip("AudioSource to analyze. If null, uses AudioListener.GetSpectrumData.")]
        public AudioSource audioSource;

        [Header("FFT Settings")]
        [Tooltip("Number of FFT samples (must be power of 2, min 64, max 8192).")]
        public int sampleSize = 1024;

        [Tooltip("FFT window function for frequency analysis.")]
        public FFTWindow fftWindow = FFTWindow.BlackmanHarris;

        [Header("Frequency Bands")]
        [Tooltip("Number of frequency bands for visualization.")]
        public int bandCount = 8;

        [Tooltip("Minimum frequency in Hz.")]
        public float minFrequency = 20f;

        [Tooltip("Maximum frequency in Hz.")]
        public float maxFrequency = 20000f;

        [Header("Smoothing")]
        [Tooltip("Smoothing factor for band values (0 = no smoothing, 1 = infinite smoothing).")]
        [Range(0f, 1f)]
        public float smoothFactor = 0.15f;

        [Tooltip("Decay rate for band values when audio is quiet.")]
        [Range(0.8f, 1f)]
        public float decayRate = 0.95f;

        [Header("Beat Detection")]
        [Tooltip("Enable beat detection.")]
        public bool enableBeatDetection = true;

        [Tooltip("Energy multiplier for beat threshold (higher = less sensitive).")]
        public float beatThreshold = 1.3f;

        [Tooltip("Minimum seconds between beat detections.")]
        public float beatCooldown = 0.15f;

        // Public data
        public float[] BandValues { get; private set; }
        public float[] SmoothedBandValues { get; private set; }
        public float OverallAmplitude { get; private set; }
        public bool IsBeat { get; private set; }
        public float BeatIntensity { get; private set; }
        public float[] SpectrumData { get; private set; }

        // Internal state
        private float[] _spectrumHistory;
        private float _lastBeatTime;
        private float _lastAnalysisTime;
        private float _analysisInterval = 0.016f; // ~60fps
        private int[] _bandStartIndices;
        private int[] _bandEndIndices;

        // Events
        public System.Action<float> OnBeat;
        public System.Action<float[]> OnSpectrumUpdate;

        private void Awake()
        {
            InitializeArrays();
        }

        private void InitializeArrays()
        {
            SpectrumData = new float[sampleSize];
            BandValues = new float[bandCount];
            SmoothedBandValues = new float[bandCount];
            _spectrumHistory = new float[43]; // ~1 second at 60fps

            // Calculate frequency band boundaries
            _bandStartIndices = new int[bandCount];
            _bandEndIndices = new int[bandCount];

            float binSize = AudioSettings.outputSampleRate / (sampleSize * 2f);
            float frequencyRange = maxFrequency - minFrequency;

            for (int i = 0; i < bandCount; i++)
            {
                float freqStart = minFrequency + (frequencyRange * i / bandCount);
                float freqEnd = minFrequency + (frequencyRange * (i + 1) / bandCount);

                _bandStartIndices[i] = Mathf.FloorToInt(freqStart / binSize);
                _bandEndIndices[i] = Mathf.FloorToInt(freqEnd / binSize);

                // Clamp to valid range
                _bandStartIndices[i] = Mathf.Clamp(_bandStartIndices[i], 0, sampleSize - 1);
                _bandEndIndices[i] = Mathf.Clamp(_bandEndIndices[i], 0, sampleSize - 1);
            }
        }

        private void Update()
        {
            if (Time.time - _lastAnalysisTime >= _analysisInterval)
            {
                AnalyzeAudio();
                _lastAnalysisTime = Time.time;
            }
        }

        /// <summary>
        /// Performs FFT analysis on the audio source and updates band values.
        /// </summary>
        public void AnalyzeAudio()
        {
            if (audioSource != null && audioSource.isPlaying)
            {
                audioSource.GetSpectrumData(SpectrumData, 0, fftWindow);
            }
            else
            {
                // Fallback to AudioListener (captures all audio)
                AudioListener.GetSpectrumData(SpectrumData, 0, fftWindow);
            }

            // Calculate band averages
            for (int i = 0; i < bandCount; i++)
            {
                float sum = 0f;
                int count = _bandEndIndices[i] - _bandStartIndices[i];
                count = Mathf.Max(count, 1);

                for (int j = _bandStartIndices[i]; j <= _bandEndIndices[i] && j < sampleSize; j++)
                {
                    sum += SpectrumData[j];
                }

                BandValues[i] = sum / count;
            }

            // Calculate overall amplitude
            float totalEnergy = 0f;
            for (int i = 0; i < bandCount; i++)
            {
                totalEnergy += BandValues[i];
            }
            OverallAmplitude = totalEnergy / bandCount;

            // Apply smoothing and decay
            for (int i = 0; i < bandCount; i++)
            {
                // Exponential moving average
                SmoothedBandValues[i] += (BandValues[i] - SmoothedBandValues[i]) * smoothFactor;

                // Decay when quiet
                SmoothedBandValues[i] *= decayRate;
            }

            // Beat detection
            if (enableBeatDetection)
            {
                DetectBeat();
            }

            // Fire spectrum update event
            OnSpectrumUpdate?.Invoke(SmoothedBandValues);
        }

        /// <summary>
        /// Detects beats using energy-based thresholding.
        /// </summary>
        private void DetectBeat()
        {
            IsBeat = false;
            BeatIntensity = 0f;

            // Focus on bass band for beat detection (first band)
            float bassEnergy = SmoothedBandValues[0];

            // Shift history
            Array.Copy(_spectrumHistory, 1, _spectrumHistory, 0, _spectrumHistory.Length - 1);
            _spectrumHistory[_spectrumHistory.Length - 1] = bassEnergy;

            // Calculate average energy
            float average = 0f;
            for (int i = 0; i < _spectrumHistory.Length; i++)
            {
                average += _spectrumHistory[i];
            }
            average /= _spectrumHistory.Length;

            // Threshold check with cooldown
            float threshold = average * beatThreshold;
            if (bassEnergy > threshold && Time.time - _lastBeatTime > beatCooldown)
            {
                IsBeat = true;
                BeatIntensity = Mathf.Clamp01((bassEnergy - threshold) / (average + 0.0001f));
                _lastBeatTime = Time.time;

                OnBeat?.Invoke(BeatIntensity);
            }
        }

        /// <summary>
        /// Gets the average value of a specific frequency band.
        /// </summary>
        public float GetBandValue(int bandIndex)
        {
            if (bandIndex >= 0 && bandIndex < SmoothedBandValues.Length)
            {
                return SmoothedBandValues[bandIndex];
            }
            return 0f;
        }

        /// <summary>
        /// Gets the frequency range for a specific band in Hz.
        /// </summary>
        public Vector2 GetBandFrequencyRange(int bandIndex)
        {
            if (bandIndex >= 0 && bandIndex < bandCount)
            {
                float binSize = AudioSettings.outputSampleRate / (sampleSize * 2f);
                float freqStart = minFrequency + ((maxFrequency - minFrequency) * bandIndex / bandCount);
                float freqEnd = minFrequency + ((maxFrequency - minFrequency) * (bandIndex + 1) / bandCount);
                return new Vector2(freqStart, freqEnd);
            }
            return Vector2.zero;
        }

        private void OnDestroy()
        {
            OnBeat = null;
            OnSpectrumUpdate = null;
        }
    }
}
