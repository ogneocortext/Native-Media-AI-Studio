#version 100
precision highp float;

// FAIL (uint type): GLSL ES 1.00 has no uint type — it was introduced in
// ESSL 3.00. Declaring `uint` should produce "undeclared identifier" from
// glslangValidator.
// Expected: glslangValidator exits non-zero with a uint-related error.
void main() {
    uint x = 5u;  // <-- INVALID: uint does not exist in ESSL 1.00
    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
}
