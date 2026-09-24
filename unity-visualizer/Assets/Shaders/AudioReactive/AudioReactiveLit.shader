Shader "AudioReactive/AudioReactiveLit"
{
    Properties
    {
        _BaseColor("Base Color", Color) = (0.1, 0.2, 0.8, 1)
        _EmissionColor("Emission Color", Color) = (1, 0.3, 0.1, 1)
        _DisplacementStrength("Displacement Strength", Range(0, 1)) = 0.3
        _NoiseFrequency("Noise Frequency", Range(0.1, 20)) = 4.0
        _RimPower("Rim Power", Range(1, 8)) = 3.0
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        LOD 100

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float2 uv : TEXCOORD0;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float3 worldPos : TEXCOORD0;
                float3 worldNormal : TEXCOORD1;
                float2 uv : TEXCOORD2;
            };

            // Per-material audio data (fed via MaterialPropertyBlock)
            float4 _BandLevels[8];
            float  _BeatLevel;
            float  _AudioTime;
            float  _DisplacementStrength;
            float  _NoiseFrequency;
            float  _RimPower;
            float4 _BaseColor;
            float4 _EmissionColor;

            // --- Simplex 2D noise (compact, GPU-friendly) ---
            float3 mod289(float3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            float2 mod289(float2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            float3 permute(float3 x) { return mod289(((x*34.0)+1.0)*x); }

            float snoise(float2 v)
            {
                const float4 C = float4(0.211324865405187, 0.366025403784439,
                                        -0.577350269189626, 0.024390243902439);
                float2 i  = floor(v + dot(v, C.yy));
                float2 x0 = v - i + dot(i, C.xx);
                float2 i1 = (x0.x > x0.y) ? float2(1.0, 0.0) : float2(0.0, 1.0);
                float4 x12 = x0.xyxy + C.xxzz;
                x12.xy -= i1;
                i = mod289(i);
                float3 p = permute(permute(i.y + float3(0.0, i1.y, 1.0))
                    + i.x + float3(0.0, i1.x, 1.0));
                float3 m = max(0.5 - float3(dot(x0,x0), dot(x12.xy,x12.xy),
                    dot(x12.zw,x12.zw)), 0.0);
                m = m*m; m = m*m;
                float3 x = 2.0 * frac(p * C.www) - 1.0;
                float3 h = abs(x) - 0.5;
                float3 ox = floor(x + 0.5);
                float3 a0 = x - ox;
                m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
                float3 g;
                g.x = a0.x * x0.x + h.x * x0.y;
                g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                return 130.0 * dot(m, g);
            }

            v2f vert(appdata v)
            {
                v2f o;
                float3 pos = v.vertex.xyz;

                // Bass band (index 0) drives vertical displacement
                float bass = _BandLevels[0];
                float n = snoise(float2(pos.x * _NoiseFrequency, pos.z * _NoiseFrequency) + _AudioTime * 0.5);
                pos += v.normal * bass * _DisplacementStrength * n;

                o.pos = TransformObjectToHClip(pos);
                o.worldPos = TransformObjectToWorld(pos);
                o.worldNormal = normalize(TransformObjectToNormal(v.normal));
                o.uv = v.uv;
                return o;
            }

            float4 frag(v2f i) : SV_Target
            {
                float3 viewDir = normalize(_WorldSpaceCameraPos - i.worldPos);
                float ndotv = saturate(dot(normalize(i.worldNormal), viewDir));
                float rim = pow(1.0 - ndotv, _RimPower);

                // Mid/high bands tint emission
                float3 audioTint = float3(
                    _BandLevels[2], // mid
                    _BandLevels[4], // high-mid
                    _BandLevels[6]  // high
                );

                float3 color = lerp(_BaseColor.rgb, _EmissionColor.rgb, _BeatLevel);
                color += audioTint * 0.5;
                color += _EmissionColor.rgb * rim * (0.5 + _BandLevels[3]);

                return float4(color, 1.0);
            }
            ENDHLSL
        }
    }

    FallBack "Universal Render Pipeline/Lit"
}
