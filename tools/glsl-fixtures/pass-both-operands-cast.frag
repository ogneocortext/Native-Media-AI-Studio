#version 100
precision highp float;

// PASS (both-operands cast): `float(float)` is a valid scalar-to-scalar
// conversion in GLSL ES 1.00. Both operands of the addition are already
// floats, so the cast is a no-op but legal.
// Expected: glslangValidator exits 0 with no errors.
void main() {
    float a = 1.0;
    float b = 2.0;
    float c = float(a + b);  // <-- VALID: float(float) is legal
    gl_FragColor = vec4(c, c, c, 1.0);
}
