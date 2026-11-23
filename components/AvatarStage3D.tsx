'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Bot } from 'lucide-react';

type Avatar3DPayload = {
  available: boolean;
  reason?: string;
  objText?: string;
  mtlText?: string;
};

const avatar3DCache = new Map<number, Avatar3DPayload>();

interface AvatarStage3DProps {
  robloxUserId?: number | null;
  fallbackAvatarUrl?: string | null;
  alt: string;
}

export default function AvatarStage3D({
  robloxUserId,
  fallbackAvatarUrl,
  alt,
}: AvatarStage3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready3d' | 'fallback'>('loading');

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !robloxUserId) {
      setStatus('fallback');
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let resizeObs: ResizeObserver | null = null;
    let sceneObj: THREE.Scene | null = null;

    setStatus('loading');

    async function init() {
      let payload = avatar3DCache.get(robloxUserId!);
      if (!payload) {
        const res = await fetch(`/api/avatar-3d?userId=${robloxUserId}`);
        payload = (await res.json()) as Avatar3DPayload;
        if (payload.available) {
          avatar3DCache.set(robloxUserId!, payload);
        }
      }

      if (cancelled || !container) return;
      if (!payload.available || !payload.objText || !payload.mtlText) {
        setStatus('fallback');
        return;
      }

      const width = container.clientWidth || 320;
      const height = container.clientHeight || 272;

      const scene = new THREE.Scene();
      sceneObj = scene;

      const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
      camera.position.set(0.4, 2.75, 8.2);

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'default',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(width, height);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.32;

      container.innerHTML = '';
      container.appendChild(renderer.domElement);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.cursor = 'grab';

      // Bright Studio Lighting (clear face/outfit visibility + Kage crimson rim)
      const hemi = new THREE.HemisphereLight(0xffffff, 0x4b1d24, 2.35);
      scene.add(hemi);

      const frontFill = new THREE.DirectionalLight(0xffffff, 2.3);
      frontFill.position.set(0, 3.6, 9.5);
      scene.add(frontFill);

      const keyLight = new THREE.DirectionalLight(0xfff7f7, 2.4);
      keyLight.position.set(4.5, 8, 6.5);
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0xe0e7ff, 1.35);
      fillLight.position.set(-5, 4.5, 5);
      scene.add(fillLight);

      const rimLight = new THREE.PointLight(0xef4444, 5.0, 16);
      rimLight.position.set(-3.2, 3.8, -4.5);
      scene.add(rimLight);

      const underGlow = new THREE.PointLight(0xdc2626, 2.8, 8);
      underGlow.position.set(0, -0.3, 2.2);
      scene.add(underGlow);

      // 3D Layered Tech Podium (top surface sits at y = 0)
      const podiumGroup = new THREE.Group();

      const bodyGeo = new THREE.CylinderGeometry(2.15, 2.38, 0.42, 64);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x160a0e,
        metalness: 0.72,
        roughness: 0.35,
      });
      const podiumBody = new THREE.Mesh(bodyGeo, bodyMat);
      podiumBody.position.y = -0.21;
      podiumGroup.add(podiumBody);

      const rimBaseGeo = new THREE.CylinderGeometry(2.42, 2.52, 0.12, 64);
      const rimBaseMat = new THREE.MeshStandardMaterial({
        color: 0x2a0c13,
        metalness: 0.8,
        roughness: 0.25,
      });
      const rimBase = new THREE.Mesh(rimBaseGeo, rimBaseMat);
      rimBase.position.y = -0.44;
      podiumGroup.add(rimBase);

      const topPlateGeo = new THREE.CylinderGeometry(1.98, 1.98, 0.03, 64);
      const topPlateMat = new THREE.MeshStandardMaterial({
        color: 0x11070a,
        metalness: 0.55,
        roughness: 0.45,
      });
      const topPlate = new THREE.Mesh(topPlateGeo, topPlateMat);
      topPlate.position.y = 0.005;
      podiumGroup.add(topPlate);

      const outerNeonGeo = new THREE.TorusGeometry(2.12, 0.028, 12, 72);
      const outerNeonMat = new THREE.MeshBasicMaterial({ color: 0xf87171 });
      const outerNeon = new THREE.Mesh(outerNeonGeo, outerNeonMat);
      outerNeon.rotation.x = Math.PI / 2;
      outerNeon.position.y = 0.015;
      podiumGroup.add(outerNeon);

      const midRingGeo = new THREE.RingGeometry(1.52, 1.58, 64);
      const midRingMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.75,
      });
      const midRing = new THREE.Mesh(midRingGeo, midRingMat);
      midRing.rotation.x = -Math.PI / 2;
      midRing.position.y = 0.024;
      podiumGroup.add(midRing);

      const innerRingGeo = new THREE.RingGeometry(0.95, 0.99, 48);
      const innerRingMat = new THREE.MeshBasicMaterial({
        color: 0xfca5a5,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.55,
      });
      const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
      innerRing.rotation.x = -Math.PI / 2;
      innerRing.position.y = 0.025;
      podiumGroup.add(innerRing);

      // Subtle dark contact shadow disc directly on top of the podium
      const shadowGeo = new THREE.CircleGeometry(1.15, 48);
      const shadowMat = new THREE.MeshBasicMaterial({
        color: 0x050203,
        transparent: true,
        opacity: 0.6,
      });
      const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
      shadowDisc.rotation.x = -Math.PI / 2;
      shadowDisc.position.y = 0.026;
      podiumGroup.add(shadowDisc);

      scene.add(podiumGroup);

      // Parse Roblox MTL + OBJ
      const mtlLoader = new MTLLoader();
      mtlLoader.setCrossOrigin('anonymous');
      const materials = mtlLoader.parse(payload.mtlText, '');
      materials.preload();

      const objLoader = new OBJLoader();
      objLoader.setMaterials(materials);
      const avatar = objLoader.parse(payload.objText);

      // Clean up textured materials so wings/hair/hats render crisply in depth buffer
      avatar.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => {
            if (!m) return;
            const std = m as THREE.MeshPhongMaterial;
            std.side = THREE.DoubleSide;
            if (std.map) {
              std.alphaTest = 0.3;
              std.transparent = false;
            }
            std.needsUpdate = true;
          });
        }
      });

      // Roblox avatar faces -Z in exported OBJ -> flip to face camera at +Z
      avatar.rotation.y = Math.PI;
      avatar.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(avatar);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const targetHeight = 3.95;
      const scale = size.y > 0 ? targetHeight / size.y : 0.65;
      avatar.scale.setScalar(scale);
      avatar.updateMatrixWorld(true);

      const scaledBox = new THREE.Box3().setFromObject(avatar);
      const scaledCenter = new THREE.Vector3();
      scaledBox.getCenter(scaledCenter);

      // Plant feet cleanly on podium top (y = 0.028)
      avatar.position.x -= scaledCenter.x;
      avatar.position.z -= scaledCenter.z;
      avatar.position.y += 0.028 - scaledBox.min.y;

      scene.add(avatar);

      // Interactive 360 OrbitControls
      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 1.85, 0);
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.minPolarAngle = Math.PI / 3.1;
      controls.maxPolarAngle = Math.PI / 2.02;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.85;
      controls.update();

      controls.addEventListener('start', () => {
        if (renderer) renderer.domElement.style.cursor = 'grabbing';
      });
      controls.addEventListener('end', () => {
        if (renderer) renderer.domElement.style.cursor = 'grab';
      });

      resizeObs = new ResizeObserver((entries) => {
        if (!renderer || !entries[0]) return;
        const { width: w, height: h } = entries[0].contentRect;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      });
      resizeObs.observe(container);

      setStatus('ready3d');

      let lastTime = 0;
      const animate = (now: number) => {
        if (cancelled) return;
        rafId = requestAnimationFrame(animate);
        if (document.hidden) return;
        // Cap around ~36fps to keep dashboard super light on GPU
        if (now - lastTime < 26) return;
        lastTime = now;
        controls?.update();
        renderer?.render(scene, camera);
      };
      rafId = requestAnimationFrame(animate);
    }

    init().catch(() => {
      if (!cancelled) setStatus('fallback');
    });

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      resizeObs?.disconnect();
      controls?.dispose();
      if (sceneObj) {
        sceneObj.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const m = obj as THREE.Mesh;
            m.geometry?.dispose();
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach((mat) => {
              if (!mat) return;
              const pm = mat as THREE.MeshPhongMaterial;
              pm.map?.dispose();
              mat.dispose();
            });
          }
        });
      }
      renderer?.dispose();
      if (renderer?.domElement && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [robloxUserId]);

  return (
    <div className="relative flex flex-col items-center justify-end h-72 my-2 rounded-2xl overflow-hidden border border-red-500/20 bg-gradient-to-b from-[#17090e] via-[#0d0508] to-[#060204]">
      {/* Studio Backdrop Lighting + Subtle Perspective Depth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 75% 58% at 50% 42%, rgba(220,38,38,0.22), transparent 70%), radial-gradient(ellipse 90% 35% at 50% 92%, rgba(239,68,68,0.16), transparent 70%)',
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-28 pointer-events-none opacity-25"
        style={{ perspective: '260px' }}
      >
        <div
          className="w-full h-full origin-bottom"
          style={{
            transform: 'rotateX(68deg)',
            backgroundImage:
              'linear-gradient(to right, rgba(239,68,68,0.3) 1px, transparent 1px), linear-gradient(to bottom, rgba(239,68,68,0.3) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
            WebkitMaskImage:
              'radial-gradient(ellipse 72% 85% at 50% 72%, #000 18%, transparent 82%)',
            maskImage:
              'radial-gradient(ellipse 72% 85% at 50% 72%, #000 18%, transparent 82%)',
          }}
        />
      </div>

      {/* Three.js Canvas Mount */}
      <div
        ref={containerRef}
        className={`relative z-10 w-full h-full transition-opacity duration-300 ${
          status === 'ready3d' ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Fallback / Loading 2D Avatar */}
      {status !== 'ready3d' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-end pb-4 pointer-events-none">
          {fallbackAvatarUrl ? (
            <img
              src={fallbackAvatarUrl}
              alt={alt}
              className="h-52 w-52 object-contain"
              style={{
                WebkitMaskImage:
                  'radial-gradient(ellipse 43% 46% at 50% 48%, #000 50%, transparent 92%)',
                maskImage:
                  'radial-gradient(ellipse 43% 46% at 50% 48%, #000 50%, transparent 92%)',
              }}
            />
          ) : (
            <div className="w-28 h-28 mb-8 rounded-full border border-red-500/40 bg-red-950/50 flex items-center justify-center text-red-300">
              <Bot className="w-12 h-12" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
