// 싱글 모드: 맵에 흩어진 코인을 모두 모으면 클리어
import * as THREE from 'three';
import { createWorld, mulberry32 } from './world.js';
import { Player } from './player.js';
import { FollowCamera } from './camera.js';

const COIN_COUNT = 15;

export class SingleGame {
  constructor(renderer, input, profile, ui) {
    this.renderer = renderer; this.input = input; this.profile = profile; this.ui = ui;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 300);
    const { colliders } = createWorld(this.scene);
    this.colliders = colliders;
    this.obstacles = this.scene.children.filter((o) => o.isMesh);
    this.player = new Player(this.scene, profile);
    this.follow = new FollowCamera(this.camera);
    this.spawnCoins();
    this.reset();
  }

  spawnCoins() {
    const geo = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 24);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 0.6, roughness: 0.25, emissive: 0x553300 });
    const rand = mulberry32(42);
    this.coins = [];
    const ray = new THREE.Raycaster();
    while (this.coins.length < COIN_COUNT) {
      const x = (rand() - 0.5) * 70, z = (rand() - 0.5) * 70;
      ray.set(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObjects(this.obstacles, false)[0];
      if (!hit) continue;
      const c = new THREE.Mesh(geo, mat);
      c.rotation.z = Math.PI / 2;
      c.position.set(x, hit.point.y + 1, z);
      c.castShadow = true;
      this.scene.add(c);
      this.coins.push(c);
    }
    // 탑 꼭대기에 보너스 코인 하나는 꼭 배치
    this.coins[0].position.set(0, 5, 0);
  }

  reset() {
    this.player.spawn(0, 0.5, 12);
    this.follow.yaw = 0; this.follow.cur.set(0, 0, 0);
    for (const c of this.coins) c.visible = true;
    this.collected = 0; this.time = 0; this.finished = false;
    this.ui.setCoins(0, this.coins.length);
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  update(dt) {
    const [mx, my] = this.input.consumeMouse();
    this.follow.rotate(mx, my);

    const { f, r } = this.follow.basis();
    const move = new THREE.Vector3();
    if (this.input.down('KeyW') || this.input.down('ArrowUp')) move.add(f);
    if (this.input.down('KeyS') || this.input.down('ArrowDown')) move.sub(f);
    if (this.input.down('KeyD') || this.input.down('ArrowRight')) move.add(r);
    if (this.input.down('KeyA') || this.input.down('ArrowLeft')) move.sub(r);
    if (move.lengthSq() > 0) move.normalize();

    this.player.update(dt, move, this.input.down('Space'),
      this.input.down('ShiftLeft') || this.input.down('ShiftRight'), this.colliders);
    this.follow.update(dt, this.player.pos, this.obstacles);

    // 코인
    const t = performance.now() / 1000;
    const center = this.player.pos.clone().add(new THREE.Vector3(0, 1, 0));
    for (const c of this.coins) {
      if (!c.visible) continue;
      c.rotation.y = t * 2;
      if (c.position.distanceTo(center) < 1.2) {
        c.visible = false; this.collected++;
        this.ui.setCoins(this.collected, this.coins.length);
      }
    }

    if (!this.finished) {
      this.time += dt;
      this.ui.setTime(this.time);
      if (this.collected === this.coins.length) { this.finished = true; this.ui.onFinish(this.time); }
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach((m) => m.dispose());
    });
  }
}
