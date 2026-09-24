Shader "AudioReactive/AudioReactiveUnlit"
{
    Properties
    {
        _Color("Color", Color) = (1, 1, 1, 1)
        _MainTex("Texture", 2D) = "white" {}
        _Intensity("Intensity", Range(0, 5)) = 1.0
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
                float2 uv : TEXCOORD0;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            // Per-material audio data (fed via MaterialPropertyBlock)
            float4 _BandLevels[8];
            float  _BeatLevel;
            float  _AudioTime;
            float  _Intensity;
            float4 _Color;

            TEXTURE2D(_MainTex);
            SAMPLER(sampler_MainTex);

            v2f vert(appdata v)
            {
                v2f o;
                o.pos = TransformObjectToHClip(v.vertex.xyz);
                o.uv = v.uv;
                return o;
            }

            float4 frag(v2f i) : SV_Target
            {
                float4 tex = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv);

                // Map low/mid/high bands to RGB
                float3 audioCol = float3(
                    _BandLevels[0] + _BandLevels[1],
                    _BandLevels[2] + _BandLevels[3],
                    _BandLevels[4] + _BandLevels[5] + _BandLevels[6]
                );

                float3 color = tex.rgb * _Color.rgb;
                color += audioCol * _BeatLevel * 0.7;
                color *= _Intensity;

                return float4(color, 1.0);
            }
            ENDHLSL
        }
    }

    FallBack "Universal Render Pipeline/Unlit"
}
