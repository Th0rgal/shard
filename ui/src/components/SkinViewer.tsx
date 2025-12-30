import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  createPlayerModel,
  loadSkinTexture,
  createCapeModel,
  loadCapeTexture,
  type PlayerModel,
  type CapeModel,
  type ModelVariant,
} from "../lib/player-model";
import {
  createAnimationState,
  updateAnimation,
  setAnimationType,
  setAnimationSpeed,
  type AnimationState,
  type AnimationType,
} from "../lib/player-animations";

// Re-export types for external use
export type { AnimationType, ModelVariant };

interface SkinViewerProps {
  skinUrl: string;
  capeUrl?: string | null;
  model?: ModelVariant;
  width?: number;
  height?: number;
  animation?: AnimationType;
  animationSpeed?: number;
  zoom?: number;
  className?: string;
}

// Viewer instance state
interface ViewerState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  playerModel: PlayerModel;
  capeModel: CapeModel | null;
  animationState: AnimationState;
  clock: THREE.Clock;
  animationId: number | null;
}

export function SkinViewer({
  skinUrl,
  capeUrl,
  model = "classic",
  width = 200,
  height = 300,
  animation = "idle",
  animationSpeed = 1.0,
  zoom = 0.9,
  className,
}: SkinViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<ViewerState | null>(null);

  // Track current values to detect changes
  const currentSkinUrlRef = useRef<string>("");
  const currentCapeUrlRef = useRef<string | null | undefined>(undefined);
  const currentModelRef = useRef<ModelVariant>("classic");

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();

    // Camera - positioned to see the player
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    const distance = 60 / zoom;
    camera.position.set(-distance * 0.4, 20, distance);
    camera.lookAt(0, 16, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    scene.add(directionalLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
    backLight.position.set(-50, 50, -50);
    scene.add(backLight);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.5;
    controls.target.set(0, 16, 0);
    controls.minPolarAngle = Math.PI * 0.2;
    controls.maxPolarAngle = Math.PI * 0.8;

    // Create player model
    const playerModel = createPlayerModel(model);
    scene.add(playerModel.group);

    // Create cape (initially hidden)
    const capeModel = createCapeModel();
    capeModel.group.visible = false;
    playerModel.group.add(capeModel.group);

    // Animation state
    const animationState = createAnimationState(animation, animationSpeed);
    const clock = new THREE.Clock();

    // Animation loop
    let animationId: number | null = null;

    const animate = () => {
      animationId = requestAnimationFrame(animate);

      const delta = clock.getDelta();

      // Update controls
      controls.update();

      // Update animation
      updateAnimation(
        playerModel.parts,
        capeModel.group.visible ? capeModel : null,
        animationState,
        delta
      );

      // Render
      renderer.render(scene, camera);
    };

    animate();

    // Store viewer state
    viewerRef.current = {
      scene,
      camera,
      renderer,
      controls,
      playerModel,
      capeModel,
      animationState,
      clock,
      animationId,
    };

    // Cleanup
    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      controls.dispose();
      renderer.dispose();
      playerModel.dispose();
      capeModel.dispose();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, zoom]);

  // Handle model variant changes - requires rebuilding the model
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (model === currentModelRef.current) return;

    // Remove old model
    viewer.scene.remove(viewer.playerModel.group);
    viewer.playerModel.dispose();

    // Create new model with correct variant
    const newPlayerModel = createPlayerModel(model);
    viewer.scene.add(newPlayerModel.group);

    // Re-add cape to new model
    newPlayerModel.group.add(viewer.capeModel!.group);

    // Update reference
    viewer.playerModel = newPlayerModel;
    currentModelRef.current = model;

    // Reload skin texture for new model
    if (currentSkinUrlRef.current) {
      loadSkinTexture(newPlayerModel, currentSkinUrlRef.current).catch(
        console.error
      );
    }
  }, [model]);

  // Handle animation changes
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    setAnimationType(viewer.animationState, animation);
    setAnimationSpeed(viewer.animationState, animationSpeed);
  }, [animation, animationSpeed]);

  // Handle skin URL changes
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (skinUrl === currentSkinUrlRef.current) return;

    setIsLoading(true);
    setError(null);

    loadSkinTexture(viewer.playerModel, skinUrl)
      .then(() => {
        currentSkinUrlRef.current = skinUrl;
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load skin:", err);
        setError("Failed to load skin");
        setIsLoading(false);
      });
  }, [skinUrl]);

  // Handle cape URL changes
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.capeModel) return;
    if (capeUrl === currentCapeUrlRef.current) return;

    if (!capeUrl) {
      viewer.capeModel.group.visible = false;
      currentCapeUrlRef.current = capeUrl;
      return;
    }

    loadCapeTexture(viewer.capeModel, capeUrl)
      .then(() => {
        viewer.capeModel!.group.visible = true;
        currentCapeUrlRef.current = capeUrl;
      })
      .catch((err) => {
        console.warn("Failed to load cape:", err);
        viewer.capeModel!.group.visible = false;
      });
  }, [capeUrl]);

  return (
    <div
      className={`skin-viewer ${className ?? ""}`}
      style={{ position: "relative", width, height }}
    >
      {isLoading && (
        <div className="skin-viewer-overlay skin-viewer-overlay--loading">
          <div className="skin-viewer-loading" />
        </div>
      )}
      {error && (
        <div className="skin-viewer-overlay skin-viewer-overlay--error">
          {error}
        </div>
      )}
      <canvas ref={canvasRef} className="skin-viewer-canvas" />
    </div>
  );
}
