// 맵: 바닥, 플랫폼(충돌 박스), 조명
import * as THREE from 'three';

export function createWorld(scene) {
  scene.background = new THREE.Color(0x8ec5ff);
  scene.fog = new THREE.Fog(0x8ec5ff, 40, 110);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(20, 35, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -50; s.right = 50; s.top = 50; s.bottom = -50; s.near = 1; s.far = 120;
  scene.add(sun);

  const colliders = []; // THREE.Box3 목록

  // 바닥
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(80, 1, 80),
    new THREE.MeshStandardMaterial({ color: 0x7fbf5a, roughness: 0.9 })
  );
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);
  colliders.push(new THREE.Box3().setFromObject(ground));

  // 바닥 격자 무늬
  const grid = new THREE.GridHelper(80, 40, 0x5c9a3e, 0x6aab49);
  grid.position.y = 0.01;
  scene.add(grid);

  const palette = [0xf2f2f2, 0xffd166, 0x6ec6ff, 0xff8fab, 0xb39ddb];
  const addBox = (x, y, z, w, h, d, ci = 0) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: palette[ci % palette.length], roughness: 0.7 })
    );
    m.position.set(x, y + h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    colliders.push(new THREE.Box3().setFromObject(m));
    return m;
  };

  // 외곽 벽
  addBox(0, 0, -40.5, 82, 3, 1); addBox(0, 0, 40.5, 82, 3, 1);
  addBox(-40.5, 0, 0, 1, 3, 80); addBox(40.5, 0, 0, 1, 3, 80);

  // 계단식 플랫폼
  for (let i = 0; i < 6; i++) addBox(8 + i * 2.5, 0, -8 - i * 2.5, 3, 0.8 + i * 0.8, 3, 1 + (i % 4));
  // 중앙 탑
  addBox(0, 0, 0, 6, 2, 6, 2);
  addBox(0, 2, 0, 3, 2, 3, 3);
  // 흩어진 상자
  const rand = mulberry32(7);
  for (let i = 0; i < 18; i++) {
    const x = (rand() - 0.5) * 66, z = (rand() - 0.5) * 66;
    if (Math.hypot(x, z) < 8) continue;
    const w = 1.5 + rand() * 3, h = 0.8 + rand() * 2.5;
    addBox(x, 0, z, w, h, w, i);
  }
  // 공중 다리
  addBox(-14, 3, 10, 10, 0.5, 2.5, 4);
  addBox(-14, 0, 4, 2.5, 1.2, 2.5, 1);
  addBox(-14, 0, 6.5, 2.5, 2.2, 2.5, 2);

  return { colliders, rand };
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
