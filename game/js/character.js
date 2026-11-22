// 기본 도형(캡슐·구·박스)으로 만든 프로토타입 캐릭터
import * as THREE from 'three';

export function createCharacter(color = 0xffb547) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xffe2c4, roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1f2e, roughness: 0.4 });

  // 몸통
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.5, 6, 14), bodyMat);
  body.position.y = 0.95;
  root.add(body);

  // 머리
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 16), skinMat);
  head.position.y = 1.62;
  root.add(head);

  // 눈 (앞쪽 = +Z)
  for (const x of [-0.11, 0.11]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), darkMat);
    eye.position.set(x, 1.66, 0.28);
    root.add(eye);
  }

  // 팔·다리 (어깨/엉덩이 기준 피벗으로 흔들기)
  const limb = (w, h, mat, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    m.position.y = -h / 2;
    pivot.add(m);
    root.add(pivot);
    return pivot;
  };
  const armL = limb(0.16, 0.5, bodyMat, -0.5, 1.25);
  const armR = limb(0.16, 0.5, bodyMat, 0.5, 1.25);
  const legL = limb(0.2, 0.5, darkMat, -0.17, 0.5);
  const legR = limb(0.2, 0.5, darkMat, 0.17, 0.5);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  let phase = 0;
  // speed01: 0~1 이동 세기, grounded: 착지 여부
  root.userData.animate = (dt, speed01, grounded) => {
    if (!grounded) {
      armL.rotation.x = armR.rotation.x = -2.4;
      legL.rotation.x = 0.4; legR.rotation.x = -0.4;
      return;
    }
    phase += dt * (6 + speed01 * 8);
    const swing = Math.sin(phase) * 0.9 * speed01;
    armL.rotation.x = swing; armR.rotation.x = -swing;
    legL.rotation.x = -swing; legR.rotation.x = swing;
    body.position.y = 0.95 + Math.abs(Math.sin(phase)) * 0.05 * speed01;
  };

  return root;
}
