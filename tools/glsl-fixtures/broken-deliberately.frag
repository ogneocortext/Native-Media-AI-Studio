#version 100
precision highp float;

// BROKEN (deliberately): references an undeclared variable.
// Expected: glslangValidator reports "undefined variable" or
// "no matching overloaded function found" for vec4(undefined_var).
void main() {
    gl_FragColor = vec4(undefined_var, 0.0, 0.0, 1.0);
}
