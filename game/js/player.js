// 플레이어: 이동/점프/중력 + 박스 충돌. 멀티에서 원격 플레이어도 같은 모델을 사용.
import * as THREE from 'three';
import { createCharacter } from './character.js';

const RADIUS = 0.45, HEIGHT = 1.95;
const WALK = 6, RUN = 10, JUMP = 9, GRAVITY = 25;

export class Player {
  constructor(scene, { color, name } = {}) {
    this.name = name || '플레이어';
    this.mesh = createCharacter(color);
    scene.add(this.mesh);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;           // 캐릭터가 바라보는 방향
    this.grounded = false;
    this.speed01 = 0;
  }

  spawn(x, y, z) { this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.sync(); }

  // move: 카메라 기준 입력 벡터 (x,z), 길이 0~1
  update(dt, move, wantJump, running, colliders) {
    const target = (running ? RUN : WALK);
    const accel = this.grounded ? 14 : 5;
    this.vel.x += (move.x * target - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (move.z * target - this.vel.z) * Math.min(1, accel * dt);

    if (wantJump && this.grounded) { this.vel.y = JUMP; this.grounded = false; }
    this.vel.y -= GRAVITY * dt;

    // 수직 이동
    this.pos.y += this.vel.y * dt;
    this.grounded = false;
    for (const b of colliders) {
      if (!this.overlapXZ(b)) continue;
      const feet = this.pos.y, top = this.pos.y + HEIGHT;
      if (feet < b.max.y && top > b.min.y) {
        if (this.vel.y <= 0 && feet > b.max.y - 0.6) { this.pos.y = b.max.y; this.vel.y = 0; this.grounded = true; }
        else if (this.vel.y > 0 && top - b.min.y < 0.6) { this.pos.y = b.min.y - HEIGHT; this.vel.y = 0; }
      }
    }

    // 수평 이동 + 밀어내기 (원 vs 박스)
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    for (const b of colliders) {
      if (this.pos.y >= b.max.y - 0.05 || this.pos.y + HEIGHT <= b.min.y) continue;
      const cx = THREE.MathUtils.clamp(this.pos.x, b.min.x, b.max.x);
      const cz = THREE.MathUtils.clamp(this.pos.z, b.min.z, b.max.z);
      let dx = this.pos.x - cx, dz = this.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= RADIUS * RADIUS) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = RADIUS - d;
        this.pos.x += (dx / d) * push; this.pos.z += (dz / d) * push;
      } else { // 중심이 박스 안: 가장 가까운 면으로
        const opts = [[b.min.x - RADIUS - this.pos.x, 0], [b.max.x + RADIUS - this.pos.x, 0],
                      [0, b.min.z - RADIUS - this.pos.z], [0, b.max.z + RADIUS - this.pos.z]];
        opts.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
        this.pos.x += opts[0][0]; this.pos.z += opts[0][1];
      }
    }

    if (this.pos.y < -30) this.spawn(0, 6, 12); // 낙사 리스폰

    // 바라보는 방향 회전
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.3) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      let diff = ((want - this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.yaw += diff * Math.min(1, 12 * dt);
    }
    this.speed01 = Math.min(1, hs / RUN);
    this.mesh.userData.animate(dt, this.speed01, this.grounded);
    this.sync();
  }

  overlapXZ(b) {
    return this.pos.x + RADIUS * 0.7 > b.min.x && this.pos.x - RADIUS * 0.7 < b.max.x &&
           this.pos.z + RADIUS * 0.7 > b.min.z && this.pos.z - RADIUS * 0.7 < b.max.z;
  }

  sync() { this.mesh.position.copy(this.pos); this.mesh.rotation.y = this.yaw; }

  // 멀티플레이용 상태 직렬화
  snapshot() { return { p: this.pos.toArray(), y: this.yaw, s: this.speed01, g: this.grounded }; }

  dispose(scene) { scene.remove(this.mesh); }
}
