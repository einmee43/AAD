'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function KageBackdrop() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
    renderer.setClearColor(0x070506, 0);
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
      size: 0.13,
      transparent: true,
      opacity: 0.88,
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
      targetX = ((e.clientX / window.innerWidth) - 0.5) * 1.8;
      targetY = -((e.clientY / window.innerHeight) - 0.5) * 1.1;
      if (glowRef.current) {
        glowRef.current.style.transform = `translate3d(${e.clientX - 240}px, ${e.clientY - 240}px, 0)`;
      }
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

      t += 0.014;
      const posAttr = emberGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        let y = posAttr.getY(i) + speeds[i] * 1.4;
        const x = posAttr.getX(i) + Math.sin(t + phases[i]) * 0.007;
        if (y > 9) y = -9;
        posAttr.setXY(i, x, y);
      }
      posAttr.needsUpdate = true;

      ash.rotation.y = Math.sin(t * 0.22) * 0.14;
      halo.scale.setScalar(1 + Math.sin(t * 1.1) * 0.05);

      camera.position.x += (targetX - camera.position.x) * 0.045;
      camera.position.y += (targetY - camera.position.y) * 0.045;
      camera.lookAt(0, 0, -4);

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
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#070506]">
      <img
        src="/themes/reze-bg.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover blur-md opacity-30 animate-bg-drift"
      />
      <div className="aurora-blob aurora-1" />
      <div className="aurora-blob aurora-2" />
      <div className="aurora-blob aurora-3" />
      <div className="kage-cyber-grid" />
      <div
        ref={glowRef}
        className="absolute top-0 left-0 w-[480px] h-[480px] rounded-full pointer-events-none transition-transform duration-150 ease-out"
        style={{
          background:
            'radial-gradient(circle, rgba(255,74,99,0.18) 0%, rgba(255,154,31,0.06) 40%, transparent 70%)',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#070506]/65 via-[#070506]/40 to-[#070506]/85" />
      <div ref={containerRef} className="absolute inset-0" />
      <div className="kage-grain" />
    </div>
  );
}
