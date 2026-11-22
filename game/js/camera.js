// 3인칭 궤도 카메라 (벽 뚫림 방지 포함)
import * as THREE from 'three';

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI; this.pitch = 0.35; this.dist = 7;
    this.ray = new THREE.Raycaster();
    this.cur = new THREE.Vector3();
  }
  rotate(dx, dy) {
    this.yaw -= dx * 0.0025;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0025, -0.4, 1.3);
  }
  // 카메라 기준 앞/오른쪽 (수평)
  basis() {
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    return { f, r };
  }
  update(dt, target, obstacles) {
    const focus = target.clone().add(new THREE.Vector3(0, 1.6, 0));
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    let d = this.dist;
    this.ray.set(focus, dir); this.ray.far = this.dist;
    const hit = this.ray.intersectObjects(obstacles, false)[0];
    if (hit) d = Math.max(1.2, hit.distance - 0.3);
    const want = focus.clone().addScaledVector(dir, d);
    this.cur.lerp(want, 1 - Math.exp(-20 * dt));
    if (this.cur.lengthSq() === 0) this.cur.copy(want);
    this.camera.position.copy(this.cur);
    this.camera.lookAt(focus);
  }
}
