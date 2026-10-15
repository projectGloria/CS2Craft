import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, RotateCcw, Rotate3D, RefreshCw } from 'lucide-react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { api } from './api';
import type { Item } from './types';
const lightPresets = { Mirage: { background: '#68756e', key: '#fff0ca', exposure: 1.3 }, Inferno: { background: '#463832', key: '#ffd0a8', exposure: 1.1 }, Nuke: { background: '#283b4b', key: '#cadfff', exposure: .95 }, 'Dust II': { background: '#8d806b', key: '#fff4d0', exposure: 1.55 } };

export default function Viewer3D({ item }: { item: Item }) {
  const host = useRef<HTMLDivElement>(null);
  const controls = useRef<OrbitControls | null>(null);
  const reset = useRef<() => void>(() => {});
  const [expanded, setExpanded] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('Preparing the model from your installed CS2 files…');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [preset, setPreset] = useState<keyof typeof lightPresets>('Mirage'); const [wear, setWear] = useState(item.minFloat ?? 0); const [painted, setPainted] = useState(false);
  const wearUniform = useRef({ value: 0 }); const applyLighting = useRef<(preset: keyof typeof lightPresets) => void>(() => {}); const inspectUntil = useRef(0);
  useEffect(() => { applyLighting.current(preset); }, [preset]);
  useEffect(() => { wearUniform.current.value = wear; }, [wear]);
  useEffect(() => {
    if (!expanded) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setExpanded(false); } };
    document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true);
  }, [expanded]);
  useEffect(() => { if (controls.current) controls.current.autoRotate = rotating; }, [rotating]);
  useEffect(() => {
    const element = host.current; if (!element) return;
    let live = true, frame = 0, renderer: THREE.WebGLRenderer | undefined, orbit: OrbitControls | undefined, environment: THREE.WebGLRenderTarget | undefined;
    const scene = new THREE.Scene(); let displayModel: THREE.Object3D | undefined;
    let observer: ResizeObserver | undefined;
    const disposeObject = (object: THREE.Object3D) => object.traverse(child => {
      const mesh = child as THREE.Mesh; mesh.geometry?.dispose();
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose(); material.dispose();
      }
    });
    setError(''); setNote(''); setStatus('Preparing the model from your installed CS2 files…');
    void (async () => {
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setClearColor('#14191f');
        renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
        renderer.domElement.setAttribute('aria-label', `${item.name} interactive 3D preview`); renderer.domElement.tabIndex = 0;
        element.appendChild(renderer.domElement);
        const camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
        orbit = new OrbitControls(camera, renderer.domElement); orbit.enableDamping = true; orbit.enablePan = false; orbit.autoRotate = rotating; orbit.autoRotateSpeed = 1; controls.current = orbit;
        const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(); environment = pmrem.fromScene(room, .04); room.dispose(); pmrem.dispose(); scene.environment = environment.texture;
        scene.add(new THREE.HemisphereLight(0xffffff, 0x38465c, 2));
        const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(2, 3, 4); scene.add(key);
        applyLighting.current = name => { if (!renderer) return; const p = lightPresets[name]; renderer.setClearColor(p.background); renderer.toneMappingExposure = p.exposure; key.color.set(p.key); }; applyLighting.current(preset);
        const size = () => { if (!renderer) return; const width = element.clientWidth, height = element.clientHeight; if (!width || !height) return; renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); };
        observer = new ResizeObserver(size); observer.observe(element); size();
        const animate = () => { if (!live || !renderer || !orbit) return; if (displayModel && inspectUntil.current > 0) { const t = Math.min(1, 1 - (inspectUntil.current - performance.now()) / 4000); displayModel.rotation.y = Math.sin(t * Math.PI) * Math.PI; displayModel.rotation.z = Math.sin(t * Math.PI * 2) * .15; if (t >= 1) { inspectUntil.current = 0; displayModel.rotation.set(0, 0, 0); } } orbit.update(); renderer.render(scene, camera); frame = requestAnimationFrame(animate); }; animate();
        const result = await api.model(item.id); if (!live) return;
        setStatus('Loading the local 3D preview…');
        const manager = new THREE.LoadingManager(); let failedTexture = false;
        manager.onError = () => { failedTexture = true; };
        const gltf = await new GLTFLoader(manager).loadAsync(result.url);
        if (!live) { disposeObject(gltf.scene); return; }
        if (failedTexture) { disposeObject(gltf.scene); throw new Error('A local model texture could not be loaded. Try again or reinstall CS2 Craft.'); }
        const model = gltf.scene;
        displayModel = model; setPainted(result.painted);
        if (result.painted) model.traverse(child => {
          const mesh = child as THREE.Mesh;
          if (!mesh.material) return;
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (material instanceof THREE.MeshStandardMaterial && material.map) {
            material.onBeforeCompile = shader => { shader.uniforms.cs2CraftWear = wearUniform.current; shader.fragmentShader = 'uniform float cs2CraftWear;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
              #ifdef USE_MAP
                float chipNoise = fract(sin(dot(floor(vMapUv * 1200.0), vec2(12.9898, 78.233))) * 43758.5453);
                float chipped = smoothstep(1.0 - cs2CraftWear * 0.55, 1.0, chipNoise);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.13, 0.14), chipped * cs2CraftWear);
              #endif`); };
          }
        });
        // Source 2 export already converts the game axes into glTF coordinates.
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model), dimensions = bounds.getSize(new THREE.Vector3());
        const extent = Math.max(dimensions.x, dimensions.y, dimensions.z);
        if (!Number.isFinite(extent) || extent <= 0) { disposeObject(model); throw new Error('This model has no visible geometry.'); }
        model.scale.multiplyScalar(2 / extent);
        model.updateMatrixWorld(true); const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()); model.position.sub(center);
        const fitted = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        scene.add(model);
        reset.current = () => {
          if (!orbit) return;
          const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
          const distance = Math.max(fitted.x / (2 * tangent * camera.aspect), fitted.y / (2 * tangent)) * 1.35 + fitted.z;
          camera.position.set(.35, .25, distance); orbit.target.set(0, 0, 0); orbit.minDistance = .8; orbit.maxDistance = Math.max(12, distance * 2); orbit.update(); orbit.saveState();
        };
        reset.current(); setNote(result.note); setStatus('');
      } catch (failure) { if (live) { setError(String(failure instanceof Error ? failure.message : failure)); setStatus(''); } }
    })();
    return () => {
      live = false; cancelAnimationFrame(frame); observer?.disconnect(); orbit?.dispose(); controls.current = null; reset.current = () => {};
      applyLighting.current = () => {}; inspectUntil.current = 0;
      disposeObject(scene); environment?.dispose(); renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
    };
  }, [item.id, attempt]);
  const ready = !status && !error;
  return <div className={`viewer3d ${expanded ? 'viewer3d-expanded' : ''}`}>
    <div className="viewer3d-toolbar"><span><Rotate3D size={14} />Offline 3D</span><div><button className="icon-button" disabled={!ready} aria-label="Reset 3D view" title="Reset view" onClick={() => reset.current()}><RotateCcw size={14} /></button><button className={`icon-button ${rotating ? 'active' : ''}`} disabled={!ready} aria-label="Auto rotate" aria-pressed={rotating} title="Auto rotate" onClick={() => setRotating(value => !value)}><Rotate3D size={14} /></button><button className="icon-button" aria-label={expanded ? 'Shrink 3D viewer' : 'Expand 3D viewer'} title={expanded ? 'Shrink viewer' : 'Expand viewer'} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button></div></div>
    <div className="viewer3d-canvas" ref={host} />
    <div className="viewer-options"><label>Lighting<select value={preset} onChange={e => setPreset(e.target.value as typeof preset)}>{Object.keys(lightPresets).map(name => <option key={name}>{name}</option>)}</select></label><button className="text-button" disabled={!ready} onClick={() => { inspectUntil.current = performance.now() + 4000; }}>Inspect rotation</button>{painted && <label>Approximate wear · {wear.toFixed(4)}<input type="range" aria-label="Approximate finish wear" min={item.minFloat ?? 0} max={item.maxFloat ?? 1} step=".0001" value={wear} onChange={e => setWear(Number(e.target.value))} /></label>}</div>
    {(status || error) && <div className="viewer3d-message">{status ? <><RefreshCw className="spin" size={20} /><p>{status}</p><small>The first view takes longer. Previews are saved locally.</small></> : <><p>{error}</p><button className="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></>}</div>}
    <div className="viewer3d-caption"><span>{ready ? 'Drag to rotate · Scroll to zoom' : 'Local CS2 assets'}</span>{note && <small>{note}</small>}<small>Map-inspired lighting and procedural wear are approximations.</small></div>
  </div>;
}
