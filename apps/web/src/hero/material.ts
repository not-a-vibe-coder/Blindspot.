import * as THREE from "three";

export interface GlowUniforms {
  uPointer: { value: THREE.Vector3 };
  uGlow: { value: number };
  uScale: { value: number };
}

export function createGlowUniforms(): GlowUniforms {
  return {
    uPointer: { value: new THREE.Vector3(0, 0, -1e5) },
    uGlow: { value: 0 },
    uScale: { value: 1 },
  };
}

export const GLASS = {
  color: 0x17171b,
  roughness: 0.36,
  clearcoat: 0.7,
  clearcoatRoughness: 0.12,
  specularIntensity: 0.7,
  iridescence: 0.55,
  iridescenceHover: 1.0,
  envMapIntensity: 1,
  envMapIntensityHover: 1.9,
} as const;

/**
 * Thick smoked glass: dark charcoal faces, soft studio gradients, thin bright rims and a
 * green/violet thin-film sheen when a piece tips toward the light. Optionally a soft
 * lavender glow under the pointer, injected via onBeforeCompile:
 *   vec3(.42,.37,.62) · .16 · exp(−1.6·(d/300S)²)
 */
export function createGlassMaterial(glow: GlowUniforms | null, iridescence: number = GLASS.iridescence) {
  const m = new THREE.MeshPhysicalMaterial({
    color: GLASS.color,
    roughness: GLASS.roughness,
    metalness: 0,
    clearcoat: GLASS.clearcoat,
    clearcoatRoughness: GLASS.clearcoatRoughness,
    specularIntensity: GLASS.specularIntensity,
    iridescence,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [250, 650],
    envMapIntensity: GLASS.envMapIntensity,
  });

  if (glow) {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uPointer = glow.uPointer;
      shader.uniforms.uGlow = glow.uGlow;
      shader.uniforms.uScale = glow.uScale;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vGlowWorld;")
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvGlowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vGlowWorld;\nuniform vec3 uPointer;\nuniform float uGlow;\nuniform float uScale;",
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          float gd = distance(vGlowWorld, uPointer) / (300.0 * uScale);
          totalEmissiveRadiance += vec3(0.42, 0.37, 0.62) * 0.16 * exp(-1.6 * gd * gd) * uGlow;`,
        );
    };
    m.customProgramCacheKey = () => "blindspot-glass-glow";
  }
  return m;
}
