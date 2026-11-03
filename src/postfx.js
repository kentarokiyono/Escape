// ポストプロセス: ブルーム → トーンマップ/sRGB → フィルム（粒子・周辺減光・色収差・恐怖演出）
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FilmShader = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, fear: { value: 0 }, caught: { value: 0 }, aspect: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float time, fear, caught, aspect;
    varying vec2 vUv;
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 uv = 0.5 + c * (1.0 - 0.045 * r2);
      float row = floor(uv.y * 70.0);
      uv.x += caught * step(0.72, h12(vec2(row, floor(time * 24.0)))) * (h12(vec2(time, row)) - 0.5) * 0.09;
      float ca = (0.0012 + 0.003 * fear + 0.012 * caught) * (0.3 + r2 * 4.0);
      vec2 dir = normalize(c + 1e-5) * ca;
      vec3 col = vec3(texture2D(tDiffuse, uv + dir).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - dir).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(l), 0.15 + fear * 0.35);
      col *= vec3(1.0 + caught * 0.7, 1.0 - caught * 0.45, 1.0 - caught * 0.45);
      float g = h12(vUv * vec2(1733.0, 977.0) + fract(time * 7.31) * 311.0) - 0.5;
      col += g * (0.04 + 0.05 * fear + 0.25 * caught) * (1.0 - l * 0.5);
      float vig = smoothstep(0.95, 0.2, length(c * vec2(aspect, 1.0)) * 0.9);
      col *= mix(0.22, 1.0, vig) * (1.0 - fear * 0.2 * (1.0 - vig));
      col *= 1.0 - 0.06 * sin(vUv.y * 900.0 + time * 30.0) * caught;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.7, 0.5, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.film = new ShaderPass(FilmShader);
    this.composer.addPass(this.film);
    this.u = this.film.uniforms;
  }
  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.u.aspect.value = w / h;
  }
  render(dt, t) { this.u.time.value = t; this.composer.render(dt); }
}
