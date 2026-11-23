'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function KageBackdrop() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x070506, 0.045);

    const camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.set(0, 0, 14);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x070506, 1);
    container.appendChild(renderer.domElement);

    // Subtle crimson moon / shrine halo behind the UI
    const haloGeo = new THREE.RingGeometry(3.8, 5.2, 64);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xdc2626,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(0, 0.8, -8);
    scene.add(halo);

    // Floating ember particles
    const count = 220;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const phases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 26;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 18;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 14 - 2;
      speeds[i] = 0.008 + Math.random() * 0.018;
      phases[i] = Math.random() * Math.PI * 2;
    }

    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const emberMat = new THREE.PointsMaterial({
      color: 0xff4d3d,
      size: 0.09,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const embers = new THREE.Points(emberGeo, emberMat);
    scene.add(embers);

    // Secondary soft ash/gold motes
    const ashCount = 120;
    const ashPos = new Float32Array(ashCount * 3);
    for (let i = 0; i < ashCount; i++) {
      ashPos[i * 3] = (Math.random() - 0.5) * 28;
      ashPos[i * 3 + 1] = (Math.random() - 0.5) * 18;
      ashPos[i * 3 + 2] = (Math.random() - 0.5) * 12 - 3;
    }
    const ashGeo = new THREE.BufferGeometry();
    ashGeo.setAttribute('position', new THREE.BufferAttribute(ashPos, 3));
    const ashMat = new THREE.PointsMaterial({
      color: 0xfca5a5,
      size: 0.045,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ash = new THREE.Points(ashGeo, ashMat);
    scene.add(ash);

    let targetX = 0;
    let targetY = 0;
    const onPointerMove = (e: PointerEvent) => {
      if (prefersReducedMotion) return;
      targetX = ((e.clientX / window.innerWidth) - 0.5) * 1.1;
      targetY = -((e.clientY / window.innerHeight) - 0.5) * 0.7;
    };

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('resize', onResize);

    let frameId = 0;
    let t = 0;

    const renderFrame = () => {
      if (document.hidden) {
        frameId = requestAnimationFrame(renderFrame);
        return;
      }

      if (!prefersReducedMotion) {
        t += 0.012;
        const posAttr = emberGeo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < count; i++) {
          let y = posAttr.getY(i) + speeds[i];
          const x = posAttr.getX(i) + Math.sin(t + phases[i]) * 0.004;
          if (y > 9) y = -9;
          posAttr.setXY(i, x, y);
        }
        posAttr.needsUpdate = true;

        ash.rotation.y = Math.sin(t * 0.15) * 0.08;
        halo.scale.setScalar(1 + Math.sin(t * 0.8) * 0.03);

        camera.position.x += (targetX - camera.position.x) * 0.03;
        camera.position.y += (targetY - camera.position.y) * 0.03;
        camera.lookAt(0, 0, -4);
      }

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(renderFrame);
    };

    renderFrame();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', onResize);
      haloGeo.dispose();
      haloMat.dispose();
      emberGeo.dispose();
      emberMat.dispose();
      ashGeo.dispose();
      ashMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
}
