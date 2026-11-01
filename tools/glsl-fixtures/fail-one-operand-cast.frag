#version 100
precision highp float;

// FAIL (one-operand cast): GLSL ES 1.00 does not allow
// `float(vec3)` — a vec3 cannot be implicitly narrowed to float
// with a single-argument constructor. Use component access
// (color.r) or dot(color, vec3(1.0/3.0)) instead.
// Expected: glslangValidator reports "no matching constructor"
// or "cannot convert 'const highp vec3' to 'highp float'".
void main() {
    vec3 color = vec3(1.0, 0.5, 0.2);
    float c = float(color);  // <-- INVALID: single-argument vec3->float cast
    gl_FragColor = vec4(c, c, c, 1.0);
}
