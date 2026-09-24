Shader "NativeMedia/AudioSyncMediaLibrary"
{
    Properties
    {
        _BaseColor ("Base Color", Color) = (0.015, 0.02, 0.06, 1)
        _AccentColor ("Accent Color", Color) = (0.1, 0.8, 1.0, 1)
        _Bass ("Bass", Range(0, 1)) = 0
        _Mid ("Mid", Range(0, 1)) = 0
        _Treble ("Treble", Range(0, 1)) = 0
        _Beat ("Beat", Range(0, 1)) = 0
        _Energy ("Energy", Range(0, 1)) = 0
        _AudioTime ("Audio Time", Float) = 0
        _Progress ("Progress", Range(0, 1)) = 0
        _Intensity ("Intensity", Range(0, 4)) = 1
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

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionCS : SV_POSITION; float3 normalWS : TEXCOORD0; float2 uv : TEXCOORD1; };

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float4 _AccentColor;
                float _Bass;
                float _Mid;
                float _Treble;
                float _Beat;
                float _Energy;
                float _AudioTime;
                float _Progress;
                float _Intensity;
            CBUFFER_END

            Varyings vert(Attributes input)
            {
                Varyings output;
                float3 displaced = input.positionOS.xyz;
                float pulse = (_Bass * 0.35) + (_Beat * 0.18);
                displaced += input.normalOS * pulse * sin(_AudioTime * 3.0 + input.positionOS.y * 4.0);
                output.positionCS = TransformObjectToHClip(displaced);
                output.normalWS = normalize(TransformObjectToWorldNormal(input.normalOS));
                output.uv = input.uv;
                return output;
            }

            float4 frag(Varyings input) : SV_Target
            {
                float3 viewDir = normalize(_WorldSpaceCameraPos - TransformWorldToHDir(input.normalWS));
                float rim = pow(1.0 - saturate(dot(normalize(input.normalWS), viewDir)), 2.5);
                float bands = saturate(_Bass * 0.6 + _Mid * 0.3 + _Treble * 0.5);
                float wave = 0.5 + 0.5 * sin((input.uv.y + _Progress * 0.25) * 18.0 + _AudioTime * 2.0);
                float pulse = saturate(_Beat * 0.75 + _Energy * 0.35);
                float3 color = _BaseColor.rgb;
                color += _AccentColor.rgb * (bands * 0.7 + rim * 0.45 + wave * pulse * 0.18);
                color *= _Intensity;
                return float4(color, 1.0);
            }
            ENDHLSL
        }
    }

    FallBack "Universal Render Pipeline/Unlit"
}
