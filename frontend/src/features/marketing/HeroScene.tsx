import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/**
 * 3D hero model: a QR code built from voxels that assembles itself, floats inside a pulsing
 * geofence with an orbiting ring of particles and a location pin. Follows the pointer, pauses
 * off-screen, renders a single still frame for reduced motion, and reports `onFail` when WebGL is
 * unavailable so the page can show a static fallback. Loaded lazily (three.js is a separate chunk).
 */
export default function HeroScene({ reducedMotion, onFail }: { reducedMotion: boolean; onFail?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      onFail?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.4, 15);

    scene.add(new THREE.AmbientLight(0xbfd6fe, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 6, 8);
    scene.add(key);
    const rim = new THREE.PointLight(0x0ea5e9, 40, 30);
    rim.position.set(-6, -3, 4);
    scene.add(rim);
    const glow = new THREE.PointLight(0x22c55e, 18, 20);
    glow.position.set(5, 4, 2);
    scene.add(glow);

    const world = new THREE.Group();
    scene.add(world);

    // ── QR voxel tile ───────────────────────────────────────────────────────
    const N = 21;
    const cell = 0.3;
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const finder = (x: number, y: number) => {
      const inBox = (ox: number, oy: number) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
      for (const [ox, oy] of [[0, 0], [N - 7, 0], [0, N - 7]]) {
        if (inBox(ox, oy)) {
          const dx = x - ox, dy = y - oy;
          const ring = dx === 0 || dx === 6 || dy === 0 || dy === 6;
          const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
          return ring || core ? 2 : 0;
        }
      }
      const sep = (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);
      return sep ? -1 : 1;
    };
    type Voxel = { x: number; y: number; home: THREE.Vector3; from: THREE.Vector3; isFinder: boolean };
    const voxels: Voxel[] = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const f = finder(x, y);
        const dark = f === 2 || (f === 1 && rand() > 0.52);
        if (!dark) continue;
        const home = new THREE.Vector3((x - (N - 1) / 2) * cell, ((N - 1) / 2 - y) * cell, 0.12);
        const from = new THREE.Vector3((rand() - 0.5) * 18, (rand() - 0.5) * 12, (rand() - 0.2) * 12);
        voxels.push({ x, y, home, from, isFinder: f === 2 });
      }
    }
    const boxGeo = new THREE.BoxGeometry(cell * 0.9, cell * 0.9, cell * 0.9);
    const boxMat = new THREE.MeshStandardMaterial({ metalness: 0.35, roughness: 0.35 });
    const qr = new THREE.InstancedMesh(boxGeo, boxMat, voxels.length);
    const navy = new THREE.Color(0x0b1f4d);
    const blue = new THREE.Color(0x2563eb);
    voxels.forEach((v, i) => qr.setColorAt(i, v.isFinder ? blue : navy));
    world.add(qr);

    const plateGeo = new THREE.BoxGeometry(N * cell + 0.7, N * cell + 0.7, 0.12);
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.05, roughness: 0.25, emissive: 0xdbe8fe, emissiveIntensity: 0.25, transparent: true, opacity: 0 });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    world.add(plate);

    // ── Geofence: pulsing rings + orbiting particles ────────────────────────
    const fence = new THREE.Group();
    fence.rotation.x = -1.15;
    world.add(fence);
    const ringMat = (c: number, o: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, side: THREE.DoubleSide });
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(5.1, 0.025, 8, 160), ringMat(0x0ea5e9, 0.75));
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(5.1, 0.015, 8, 160), ringMat(0x60a5fa, 0.5));
    fence.add(ringA, ringB);
    const pulse = new THREE.Mesh(new THREE.RingGeometry(4.6, 5.0, 96), ringMat(0x0ea5e9, 0.18));
    fence.add(pulse);

    const P = 520;
    const pos = new Float32Array(P * 3);
    for (let i = 0; i < P; i++) {
      const a = (i / P) * Math.PI * 2;
      const r = 5.1 + (rand() - 0.5) * 0.9;
      pos.set([Math.cos(a) * r, Math.sin(a) * r, (rand() - 0.5) * 0.5], i * 3);
    }
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ptsMat = new THREE.PointsMaterial({ color: 0x93c5fd, size: 0.05, transparent: true, opacity: 0.85, depthWrite: false });
    const particles = new THREE.Points(ptsGeo, ptsMat);
    fence.add(particles);

    // ── Location pin with a check ───────────────────────────────────────────
    const pin = new THREE.Group();
    const pinMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, metalness: 0.2, roughness: 0.3, emissive: 0x16a34a, emissiveIntensity: 0.35 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 32), pinMat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.75, 32), pinMat);
    tip.rotation.x = Math.PI;
    tip.position.y = -0.52;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 }));
    dot.position.z = 0.33;
    pin.add(head, tip, dot);
    pin.position.set(3.9, 2.6, 1.2);
    world.add(pin);

    // ── Interaction, sizing and loop ────────────────────────────────────────
    const target = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      target.y = (e.clientX / window.innerWidth - 0.5) * 0.6;
      target.x = (e.clientY / window.innerHeight - 0.5) * 0.35;
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      // Fit the whole model (QR tile, geofence rings and pin ≈ 6.4 units radius) in either dimension.
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      camera.position.z = 5.5 / Math.tan(halfFov) / Math.min(1, camera.aspect);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const ASSEMBLE = 2.4;
    const ease = (k: number) => 1 - Math.pow(1 - k, 4);

    const draw = (t: number) => {
      voxels.forEach((v, i) => {
        // Staggered assembly from the centre outwards, then a gentle wave.
        const delay = (Math.hypot(v.x - N / 2, v.y - N / 2) / N) * 0.9;
        const k = reducedMotion ? 1 : ease(Math.min(1, Math.max(0, (t - delay) / ASSEMBLE)));
        p.lerpVectors(v.from, v.home, k);
        p.z += k === 1 && !reducedMotion ? Math.sin(t * 2.2 + (v.x + v.y) * 0.45) * 0.06 : 0;
        q.setFromEuler(new THREE.Euler((1 - k) * 3, (1 - k) * 2, 0));
        m.compose(p, q, s);
        qr.setMatrixAt(i, m);
      });
      qr.instanceMatrix.needsUpdate = true;
      const appear = reducedMotion ? 1 : Math.min(1, Math.max(0, (t - 1.2) / 1.2));
      plateMat.opacity = 0.92 * appear;
      ringA.material.opacity = 0.75 * appear;
      ringB.material.opacity = 0.5 * appear;
      ptsMat.opacity = 0.85 * appear;
      const pp = (t * 0.45) % 1;
      pulse.scale.setScalar(0.75 + pp * 0.45);
      (pulse.material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - pp) * appear;
      particles.rotation.z = t * 0.12;
      ringB.rotation.z = -t * 0.2;
      ringB.scale.setScalar(1 + Math.sin(t * 1.4) * 0.02);
      pin.position.y = 2.6 + Math.sin(t * 1.6) * 0.18;
      pin.rotation.y = Math.sin(t * 0.8) * 0.5;
      pin.scale.setScalar(appear);
      world.rotation.y += ((reducedMotion ? -0.35 : -0.35 + Math.sin(t * 0.3) * 0.18 + target.y) - world.rotation.y) * 0.05;
      world.rotation.x += ((reducedMotion ? 0.12 : 0.12 + target.x) - world.rotation.x) * 0.05;
      renderer.render(scene, camera);
    };

    let raf = 0;
    let visible = true;
    const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (visible) draw(clock.getElapsedTime());
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) clock.start();
    });
    io.observe(el);
    if (reducedMotion) draw(10);
    else loop();
    setReady(true);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('pointermove', onPointer);
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [reducedMotion, onFail]);

  return <div ref={host} className={`h-full w-full transition-opacity duration-700 ${ready ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />;
}
