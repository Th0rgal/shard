import * as THREE from "three";

export type ModelVariant = "classic" | "slim";

// Minecraft skin UV coordinates for 64x64 skins
// All coordinates are in pixels, will be normalized to 0-1 range
const SKIN_WIDTH = 64;
const SKIN_HEIGHT = 64;

interface UVCoords {
  front: [number, number, number, number]; // x, y, width, height
  back: [number, number, number, number];
  top: [number, number, number, number];
  bottom: [number, number, number, number];
  left: [number, number, number, number];
  right: [number, number, number, number];
}

// UV mappings for each body part (64x64 skin format)
const UV_MAP = {
  head: {
    front: [8, 8, 8, 8],
    back: [24, 8, 8, 8],
    top: [8, 0, 8, 8],
    bottom: [16, 0, 8, 8],
    right: [0, 8, 8, 8],
    left: [16, 8, 8, 8],
  } as UVCoords,
  headOverlay: {
    front: [40, 8, 8, 8],
    back: [56, 8, 8, 8],
    top: [40, 0, 8, 8],
    bottom: [48, 0, 8, 8],
    right: [32, 8, 8, 8],
    left: [48, 8, 8, 8],
  } as UVCoords,
  body: {
    front: [20, 20, 8, 12],
    back: [32, 20, 8, 12],
    top: [20, 16, 8, 4],
    bottom: [28, 16, 8, 4],
    right: [16, 20, 4, 12],
    left: [28, 20, 4, 12],
  } as UVCoords,
  bodyOverlay: {
    front: [20, 36, 8, 12],
    back: [32, 36, 8, 12],
    top: [20, 32, 8, 4],
    bottom: [28, 32, 8, 4],
    right: [16, 36, 4, 12],
    left: [28, 36, 4, 12],
  } as UVCoords,
  rightArm: {
    front: [44, 20, 4, 12],
    back: [52, 20, 4, 12],
    top: [44, 16, 4, 4],
    bottom: [48, 16, 4, 4],
    right: [40, 20, 4, 12],
    left: [48, 20, 4, 12],
  } as UVCoords,
  rightArmOverlay: {
    front: [44, 36, 4, 12],
    back: [52, 36, 4, 12],
    top: [44, 32, 4, 4],
    bottom: [48, 32, 4, 4],
    right: [40, 36, 4, 12],
    left: [48, 36, 4, 12],
  } as UVCoords,
  leftArm: {
    front: [36, 52, 4, 12],
    back: [44, 52, 4, 12],
    top: [36, 48, 4, 4],
    bottom: [40, 48, 4, 4],
    right: [32, 52, 4, 12],
    left: [40, 52, 4, 12],
  } as UVCoords,
  leftArmOverlay: {
    front: [52, 52, 4, 12],
    back: [60, 52, 4, 12],
    top: [52, 48, 4, 4],
    bottom: [56, 48, 4, 4],
    right: [48, 52, 4, 12],
    left: [56, 52, 4, 12],
  } as UVCoords,
  rightLeg: {
    front: [4, 20, 4, 12],
    back: [12, 20, 4, 12],
    top: [4, 16, 4, 4],
    bottom: [8, 16, 4, 4],
    right: [0, 20, 4, 12],
    left: [8, 20, 4, 12],
  } as UVCoords,
  rightLegOverlay: {
    front: [4, 36, 4, 12],
    back: [12, 36, 4, 12],
    top: [4, 32, 4, 4],
    bottom: [8, 32, 4, 4],
    right: [0, 36, 4, 12],
    left: [8, 36, 4, 12],
  } as UVCoords,
  leftLeg: {
    front: [20, 52, 4, 12],
    back: [28, 52, 4, 12],
    top: [20, 48, 4, 4],
    bottom: [24, 48, 4, 4],
    right: [16, 52, 4, 12],
    left: [24, 52, 4, 12],
  } as UVCoords,
  leftLegOverlay: {
    front: [4, 52, 4, 12],
    back: [12, 52, 4, 12],
    top: [4, 48, 4, 4],
    bottom: [8, 48, 4, 4],
    right: [0, 52, 4, 12],
    left: [8, 52, 4, 12],
  } as UVCoords,
};

// Slim arm UV mappings (3px wide instead of 4px)
const UV_MAP_SLIM_RIGHT_ARM = {
  front: [44, 20, 3, 12],
  back: [51, 20, 3, 12],
  top: [44, 16, 3, 4],
  bottom: [47, 16, 3, 4],
  right: [40, 20, 4, 12],
  left: [47, 20, 4, 12],
} as UVCoords;

const UV_MAP_SLIM_RIGHT_ARM_OVERLAY = {
  front: [44, 36, 3, 12],
  back: [51, 36, 3, 12],
  top: [44, 32, 3, 4],
  bottom: [47, 32, 3, 4],
  right: [40, 36, 4, 12],
  left: [47, 36, 4, 12],
} as UVCoords;

const UV_MAP_SLIM_LEFT_ARM = {
  front: [36, 52, 3, 12],
  back: [43, 52, 3, 12],
  top: [36, 48, 3, 4],
  bottom: [39, 48, 3, 4],
  right: [32, 52, 4, 12],
  left: [39, 52, 4, 12],
} as UVCoords;

const UV_MAP_SLIM_LEFT_ARM_OVERLAY = {
  front: [52, 52, 3, 12],
  back: [59, 52, 3, 12],
  top: [52, 48, 3, 4],
  bottom: [55, 48, 3, 4],
  right: [48, 52, 4, 12],
  left: [55, 52, 4, 12],
} as UVCoords;

// Convert pixel coordinates to UV (0-1 range), flipping Y axis
function pixelToUV(
  x: number,
  y: number,
  w: number,
  h: number
): [number, number, number, number] {
  return [
    x / SKIN_WIDTH,
    1 - (y + h) / SKIN_HEIGHT,
    w / SKIN_WIDTH,
    h / SKIN_HEIGHT,
  ];
}

// Create box geometry with custom UV mapping per face
function createBoxWithUV(
  width: number,
  height: number,
  depth: number,
  uvCoords: UVCoords,
  scale = 1
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(
    width * scale,
    height * scale,
    depth * scale
  );

  const uvAttribute = geometry.attributes.uv;
  const uvArray = uvAttribute.array as Float32Array;

  // Face order in BoxGeometry: right, left, top, bottom, front, back
  const faces: (keyof UVCoords)[] = [
    "right",
    "left",
    "top",
    "bottom",
    "front",
    "back",
  ];

  faces.forEach((face, faceIndex) => {
    const [px, py, pw, ph] = uvCoords[face];
    const [u, v, uw, vh] = pixelToUV(px, py, pw, ph);

    const baseIndex = faceIndex * 8; // 4 vertices * 2 coords per face

    // UV coordinates for quad (2 triangles)
    // Vertex order: top-left, bottom-left, top-right, bottom-right
    uvArray[baseIndex + 0] = u + uw; // top-right u
    uvArray[baseIndex + 1] = v + vh; // top-right v
    uvArray[baseIndex + 2] = u; // top-left u
    uvArray[baseIndex + 3] = v + vh; // top-left v
    uvArray[baseIndex + 4] = u + uw; // bottom-right u
    uvArray[baseIndex + 5] = v; // bottom-right v
    uvArray[baseIndex + 6] = u; // bottom-left u
    uvArray[baseIndex + 7] = v; // bottom-left v
  });

  uvAttribute.needsUpdate = true;
  return geometry;
}

// Scale factor: 1 Minecraft pixel = 1 unit
const SCALE = 1;

export interface PlayerModelParts {
  head: THREE.Group;
  body: THREE.Group; // Now a group containing torso mesh and carrying head/arms
  bodyMesh: THREE.Mesh; // The actual torso mesh for texture
  rightArm: THREE.Group;
  leftArm: THREE.Group;
  rightLeg: THREE.Group;
  leftLeg: THREE.Group;
  // Overlay parts
  headOverlay: THREE.Mesh;
  bodyOverlay: THREE.Mesh;
  rightArmOverlay: THREE.Mesh;
  leftArmOverlay: THREE.Mesh;
  rightLegOverlay: THREE.Mesh;
  leftLegOverlay: THREE.Mesh;
}

export interface PlayerModel {
  group: THREE.Group;
  parts: PlayerModelParts;
  material: THREE.MeshStandardMaterial;
  overlayMaterial: THREE.MeshStandardMaterial;
  variant: ModelVariant;
  dispose: () => void;
}

export function createPlayerModel(
  variant: ModelVariant = "classic"
): PlayerModel {
  const group = new THREE.Group();

  // Create materials
  const material = new THREE.MeshStandardMaterial({
    side: THREE.FrontSide,
    transparent: false,
    alphaTest: 0.5,
  });

  const overlayMaterial = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.01,
  });

  const armWidth = variant === "slim" ? 3 : 4;
  const armUVs =
    variant === "slim"
      ? {
          right: UV_MAP_SLIM_RIGHT_ARM,
          rightOverlay: UV_MAP_SLIM_RIGHT_ARM_OVERLAY,
          left: UV_MAP_SLIM_LEFT_ARM,
          leftOverlay: UV_MAP_SLIM_LEFT_ARM_OVERLAY,
        }
      : {
          right: UV_MAP.rightArm,
          rightOverlay: UV_MAP.rightArmOverlay,
          left: UV_MAP.leftArm,
          leftOverlay: UV_MAP.leftArmOverlay,
        };

  // Body group - contains torso, head, and arms so they move together
  const bodyGroup = new THREE.Group();
  bodyGroup.position.set(0, 18, 0); // Center of body in world space
  group.add(bodyGroup);

  // Body mesh (8x12x4) - positioned at origin of body group
  const bodyGeom = createBoxWithUV(8, 12, 4, UV_MAP.body, SCALE);
  const bodyMesh = new THREE.Mesh(bodyGeom, material);
  bodyGroup.add(bodyMesh);

  // Body overlay
  const bodyOverlayGeom = createBoxWithUV(8, 12, 4, UV_MAP.bodyOverlay, SCALE * 1.05);
  const bodyOverlayMesh = new THREE.Mesh(bodyOverlayGeom, overlayMaterial);
  bodyGroup.add(bodyOverlayMesh);

  // Head (8x8x8) - relative to body group (body is 12 tall, so top is +6, plus half head = +10)
  const headGroup = new THREE.Group();
  const headGeom = createBoxWithUV(8, 8, 8, UV_MAP.head, SCALE);
  const headMesh = new THREE.Mesh(headGeom, material);
  headGroup.add(headMesh);
  headGroup.position.set(0, 10, 0); // 6 (half body) + 4 (half head)
  bodyGroup.add(headGroup);

  // Head overlay (slightly larger)
  const headOverlayGeom = createBoxWithUV(8, 8, 8, UV_MAP.headOverlay, SCALE * 1.1);
  const headOverlayMesh = new THREE.Mesh(headOverlayGeom, overlayMaterial);
  headGroup.add(headOverlayMesh);

  // Right arm - positioned at edge of body (body is 8 wide, so edge is at -4)
  // Position relative to body group, at shoulder height (+6 from body center)
  const rightArmGroup = new THREE.Group();
  const rightArmGeom = createBoxWithUV(armWidth, 12, 4, armUVs.right, SCALE);
  const rightArmMesh = new THREE.Mesh(rightArmGeom, material);
  rightArmMesh.position.set(0, -6, 0); // Pivot at top of arm
  rightArmGroup.add(rightArmMesh);
  rightArmGroup.position.set(-4 - armWidth / 2, 6, 0); // Shoulder position relative to body
  bodyGroup.add(rightArmGroup);

  // Right arm overlay
  const rightArmOverlayGeom = createBoxWithUV(armWidth, 12, 4, armUVs.rightOverlay, SCALE * 1.05);
  const rightArmOverlayMesh = new THREE.Mesh(rightArmOverlayGeom, overlayMaterial);
  rightArmOverlayMesh.position.copy(rightArmMesh.position);
  rightArmGroup.add(rightArmOverlayMesh);

  // Left arm - positioned at edge of body (body is 8 wide, so edge is at +4)
  const leftArmGroup = new THREE.Group();
  const leftArmGeom = createBoxWithUV(armWidth, 12, 4, armUVs.left, SCALE);
  const leftArmMesh = new THREE.Mesh(leftArmGeom, material);
  leftArmMesh.position.set(0, -6, 0);
  leftArmGroup.add(leftArmMesh);
  leftArmGroup.position.set(4 + armWidth / 2, 6, 0); // Shoulder position relative to body
  bodyGroup.add(leftArmGroup);

  // Left arm overlay
  const leftArmOverlayGeom = createBoxWithUV(armWidth, 12, 4, armUVs.leftOverlay, SCALE * 1.05);
  const leftArmOverlayMesh = new THREE.Mesh(leftArmOverlayGeom, overlayMaterial);
  leftArmOverlayMesh.position.copy(leftArmMesh.position);
  leftArmGroup.add(leftArmOverlayMesh);

  // Right leg
  const rightLegGroup = new THREE.Group();
  const rightLegGeom = createBoxWithUV(4, 12, 4, UV_MAP.rightLeg, SCALE);
  const rightLegMesh = new THREE.Mesh(rightLegGeom, material);
  rightLegMesh.position.set(0, -6, 0);
  rightLegGroup.add(rightLegMesh);
  rightLegGroup.position.set(-2, 12, 0);
  group.add(rightLegGroup);

  // Right leg overlay
  const rightLegOverlayGeom = createBoxWithUV(4, 12, 4, UV_MAP.rightLegOverlay, SCALE * 1.05);
  const rightLegOverlayMesh = new THREE.Mesh(rightLegOverlayGeom, overlayMaterial);
  rightLegOverlayMesh.position.copy(rightLegMesh.position);
  rightLegGroup.add(rightLegOverlayMesh);

  // Left leg
  const leftLegGroup = new THREE.Group();
  const leftLegGeom = createBoxWithUV(4, 12, 4, UV_MAP.leftLeg, SCALE);
  const leftLegMesh = new THREE.Mesh(leftLegGeom, material);
  leftLegMesh.position.set(0, -6, 0);
  leftLegGroup.add(leftLegMesh);
  leftLegGroup.position.set(2, 12, 0);
  group.add(leftLegGroup);

  // Left leg overlay
  const leftLegOverlayGeom = createBoxWithUV(4, 12, 4, UV_MAP.leftLegOverlay, SCALE * 1.05);
  const leftLegOverlayMesh = new THREE.Mesh(leftLegOverlayGeom, overlayMaterial);
  leftLegOverlayMesh.position.copy(leftLegMesh.position);
  leftLegGroup.add(leftLegOverlayMesh);

  // Center the model at origin (feet at y=0)
  group.position.y = 0;

  const parts: PlayerModelParts = {
    head: headGroup,
    body: bodyGroup,
    bodyMesh: bodyMesh,
    rightArm: rightArmGroup,
    leftArm: leftArmGroup,
    rightLeg: rightLegGroup,
    leftLeg: leftLegGroup,
    headOverlay: headOverlayMesh,
    bodyOverlay: bodyOverlayMesh,
    rightArmOverlay: rightArmOverlayMesh,
    leftArmOverlay: leftArmOverlayMesh,
    rightLegOverlay: rightLegOverlayMesh,
    leftLegOverlay: leftLegOverlayMesh,
  };

  const dispose = () => {
    // Dispose geometries
    headGeom.dispose();
    headOverlayGeom.dispose();
    bodyGeom.dispose();
    bodyOverlayGeom.dispose();
    rightArmGeom.dispose();
    rightArmOverlayGeom.dispose();
    leftArmGeom.dispose();
    leftArmOverlayGeom.dispose();
    rightLegGeom.dispose();
    rightLegOverlayGeom.dispose();
    leftLegGeom.dispose();
    leftLegOverlayGeom.dispose();

    // Dispose materials
    material.dispose();
    overlayMaterial.dispose();

    // Dispose textures if any
    if (material.map) material.map.dispose();
    if (overlayMaterial.map) overlayMaterial.map.dispose();
  };

  return {
    group,
    parts,
    material,
    overlayMaterial,
    variant,
    dispose,
  };
}

// Load skin texture and apply to model
export async function loadSkinTexture(
  model: PlayerModel,
  url: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = "anonymous";

    loader.load(
      url,
      (texture) => {
        // Configure texture for pixel art
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = false;

        // Dispose old textures
        if (model.material.map) model.material.map.dispose();
        if (model.overlayMaterial.map) model.overlayMaterial.map.dispose();

        // Apply to both materials
        model.material.map = texture;
        model.material.needsUpdate = true;

        // Clone texture for overlay (shares underlying image)
        const overlayTexture = texture.clone();
        overlayTexture.needsUpdate = true;
        model.overlayMaterial.map = overlayTexture;
        model.overlayMaterial.needsUpdate = true;

        resolve();
      },
      undefined,
      (error) => {
        reject(error);
      }
    );
  });
}

// Cape UV mapping
const CAPE_UV = {
  front: [1, 1, 10, 16],
  back: [12, 1, 10, 16],
  top: [1, 0, 10, 1],
  bottom: [11, 0, 10, 1],
  left: [0, 1, 1, 16],
  right: [11, 1, 1, 16],
} as UVCoords;

const CAPE_WIDTH = 64;
const CAPE_HEIGHT = 32;

function createCapeGeometry(): THREE.BufferGeometry {
  // Cape dimensions: 10x16x1 pixels
  const geometry = new THREE.BoxGeometry(10 * SCALE, 16 * SCALE, 1 * SCALE);
  const uvAttribute = geometry.attributes.uv;
  const uvArray = uvAttribute.array as Float32Array;

  const faces: (keyof UVCoords)[] = [
    "right",
    "left",
    "top",
    "bottom",
    "front",
    "back",
  ];

  faces.forEach((face, faceIndex) => {
    const [px, py, pw, ph] = CAPE_UV[face];
    const u = px / CAPE_WIDTH;
    const v = 1 - (py + ph) / CAPE_HEIGHT;
    const uw = pw / CAPE_WIDTH;
    const vh = ph / CAPE_HEIGHT;

    const baseIndex = faceIndex * 8;
    uvArray[baseIndex + 0] = u + uw;
    uvArray[baseIndex + 1] = v + vh;
    uvArray[baseIndex + 2] = u;
    uvArray[baseIndex + 3] = v + vh;
    uvArray[baseIndex + 4] = u + uw;
    uvArray[baseIndex + 5] = v;
    uvArray[baseIndex + 6] = u;
    uvArray[baseIndex + 7] = v;
  });

  uvAttribute.needsUpdate = true;
  return geometry;
}

export interface CapeModel {
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  dispose: () => void;
}

export function createCapeModel(): CapeModel {
  const group = new THREE.Group();

  const material = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.1,
  });

  const geometry = createCapeGeometry();
  const mesh = new THREE.Mesh(geometry, material);

  // Position cape behind player, hanging down
  mesh.position.set(0, -8, 0);
  group.add(mesh);

  // Cape pivot at top-center-back
  group.position.set(0, 24, -2.5);
  group.rotation.x = Math.PI * 0.1; // Slight tilt

  const dispose = () => {
    geometry.dispose();
    material.dispose();
    if (material.map) material.map.dispose();
  };

  return { group, mesh, material, dispose };
}

// Texture cache for preloaded cape textures
const capeTextureCache = new Map<string, THREE.Texture>();

// Load a texture (with caching)
async function loadTexture(url: string): Promise<THREE.Texture> {
  // Check cache first
  const cached = capeTextureCache.get(url);
  if (cached) {
    return cached.clone();
  }

  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = "anonymous";

    loader.load(
      url,
      (texture) => {
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = false;

        // Cache the texture
        capeTextureCache.set(url, texture);

        // Return a clone so the cached texture isn't disposed
        resolve(texture.clone());
      },
      undefined,
      (error) => {
        reject(error);
      }
    );
  });
}

// Preload cape textures for instant switching
export async function preloadCapeTextures(urls: string[]): Promise<void> {
  await Promise.all(
    urls.map(async (url) => {
      if (capeTextureCache.has(url)) return;
      try {
        await loadTexture(url);
      } catch {
        // Silently ignore failed preloads
      }
    })
  );
}

export async function loadCapeTexture(
  cape: CapeModel,
  url: string
): Promise<void> {
  const texture = await loadTexture(url);

  if (cape.material.map) cape.material.map.dispose();
  cape.material.map = texture;
  cape.material.needsUpdate = true;
}
