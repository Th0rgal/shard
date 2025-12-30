import type { PlayerModelParts } from "./player-model";
import type { CapeModel } from "./player-model";

export type AnimationType =
  | "idle"
  | "walk"
  | "run"
  | "fly"
  | "wave"
  | "crouch"
  | "none";

export interface AnimationState {
  type: AnimationType;
  speed: number;
  time: number;
}

// Easing functions
const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;

// Animation update function signature
type AnimationUpdater = (
  parts: PlayerModelParts,
  cape: CapeModel | null,
  state: AnimationState,
  delta: number
) => void;

// Default body Y position (center of body at y=18 in world space)
const DEFAULT_BODY_Y = 18;

// Reset all rotations to default pose
function resetPose(parts: PlayerModelParts): void {
  parts.head.rotation.set(0, 0, 0);
  parts.rightArm.rotation.set(0, 0, 0);
  parts.leftArm.rotation.set(0, 0, 0);
  parts.rightLeg.rotation.set(0, 0, 0);
  parts.leftLeg.rotation.set(0, 0, 0);
  parts.body.rotation.set(0, 0, 0);
  parts.body.position.y = DEFAULT_BODY_Y;
}

// Idle animation - subtle breathing and head movement
const updateIdle: AnimationUpdater = (parts, cape, state, delta) => {
  state.time += delta * state.speed;
  const t = state.time;

  // Breathing - subtle body rise (head and arms move with body automatically now)
  const breathe = Math.sin(t * 1.5) * 0.02;
  parts.body.position.y = DEFAULT_BODY_Y + breathe * 4;

  // Subtle arm sway
  parts.rightArm.rotation.z = Math.sin(t * 0.8) * 0.02 + 0.05;
  parts.leftArm.rotation.z = Math.sin(t * 0.8 + Math.PI) * 0.02 - 0.05;

  // Slight head movement
  parts.head.rotation.y = Math.sin(t * 0.3) * 0.05;
  parts.head.rotation.x = Math.sin(t * 0.5) * 0.02;

  // Cape gentle sway
  if (cape) {
    cape.group.rotation.x = Math.PI * 0.1 + Math.sin(t * 0.8) * 0.03;
  }
};

// Walking animation
const updateWalk: AnimationUpdater = (parts, cape, state, delta) => {
  state.time += delta * state.speed;
  const t = state.time * 4;

  // Arm swing
  const armSwing = Math.sin(t) * 0.8;
  parts.rightArm.rotation.x = armSwing;
  parts.leftArm.rotation.x = -armSwing;

  // Leg swing (opposite to arms)
  const legSwing = Math.sin(t) * 0.6;
  parts.rightLeg.rotation.x = -legSwing;
  parts.leftLeg.rotation.x = legSwing;

  // Head bob
  parts.head.rotation.x = Math.sin(t * 2) * 0.05;

  // Body bob
  parts.body.position.y = DEFAULT_BODY_Y + Math.abs(Math.sin(t)) * 0.5;

  // Cape movement
  if (cape) {
    cape.group.rotation.x = Math.PI * 0.15 + Math.sin(t) * 0.1;
  }
};

// Running animation - faster and more exaggerated
const updateRun: AnimationUpdater = (parts, cape, state, delta) => {
  state.time += delta * state.speed;
  const t = state.time * 8;

  // Exaggerated arm swing
  const armSwing = Math.sin(t) * 1.2;
  parts.rightArm.rotation.x = armSwing;
  parts.leftArm.rotation.x = -armSwing;

  // Bent arms while running
  parts.rightArm.rotation.z = 0.3;
  parts.leftArm.rotation.z = -0.3;

  // Fast leg movement
  const legSwing = Math.sin(t) * 1.0;
  parts.rightLeg.rotation.x = -legSwing;
  parts.leftLeg.rotation.x = legSwing;

  // Head bob
  parts.head.rotation.x = Math.sin(t * 2) * 0.1 - 0.1;

  // Body tilt forward
  parts.body.rotation.x = -0.15;
  parts.body.position.y = DEFAULT_BODY_Y + Math.abs(Math.sin(t)) * 1;

  // Cape flying back
  if (cape) {
    cape.group.rotation.x = Math.PI * 0.4 + Math.sin(t * 2) * 0.15;
  }
};

// Wave animation
const updateWave: AnimationUpdater = (parts, cape, state, delta) => {
  state.time += delta * state.speed;
  const t = state.time;

  // Reset pose first
  parts.leftArm.rotation.set(0, 0, 0);
  parts.rightLeg.rotation.set(0, 0, 0);
  parts.leftLeg.rotation.set(0, 0, 0);

  // Right arm raised and waving
  parts.rightArm.rotation.z = -Math.PI * 0.8;
  parts.rightArm.rotation.x = Math.sin(t * 6) * 0.3;

  // Subtle body sway
  const breathe = Math.sin(t * 1.5) * 0.02;
  parts.body.position.y = DEFAULT_BODY_Y + breathe * 2;

  // Head looking at camera
  parts.head.rotation.y = Math.sin(t * 0.5) * 0.1;

  // Cape gentle sway
  if (cape) {
    cape.group.rotation.x = Math.PI * 0.1 + Math.sin(t * 0.8) * 0.03;
  }
};

// Crouch animation
const updateCrouch: AnimationUpdater = (parts, cape, state, delta) => {
  state.time += delta * state.speed;
  const t = state.time;

  // Bend knees
  parts.rightLeg.rotation.x = 0.6;
  parts.leftLeg.rotation.x = 0.6;

  // Lower body (crouch lowers the body)
  const crouchY = DEFAULT_BODY_Y - 4;
  parts.body.position.y = crouchY;
  parts.body.rotation.x = 0.3;

  // Head tilted down slightly for crouching
  parts.head.rotation.x = 0.15;

  // Arms slightly forward for balance
  parts.rightArm.rotation.x = -0.3;
  parts.leftArm.rotation.x = -0.3;

  // Subtle breathing
  const breathe = Math.sin(t * 1.5) * 0.02;
  parts.body.position.y = crouchY + breathe * 2;

  // Sneaky head movement
  parts.head.rotation.y = Math.sin(t * 0.8) * 0.15;

  // Cape hangs
  if (cape) {
    cape.group.rotation.x = Math.PI * 0.05;
  }
};

// Flying animation - superman pose
const updateFly: AnimationUpdater = (parts, cape, state, delta) => {
  state.time += delta * state.speed;
  const t = state.time;

  // Arms stretched forward
  parts.rightArm.rotation.x = -Math.PI * 0.9;
  parts.leftArm.rotation.x = -Math.PI * 0.9;
  parts.rightArm.rotation.z = 0.2;
  parts.leftArm.rotation.z = -0.2;

  // Legs straight back
  parts.rightLeg.rotation.x = 0.3;
  parts.leftLeg.rotation.x = 0.3;

  // Body horizontal (raised up for flying)
  const flyY = DEFAULT_BODY_Y + 2;
  parts.body.rotation.x = -Math.PI * 0.45;
  parts.body.position.y = flyY;

  // Head looking forward
  parts.head.rotation.x = Math.PI * 0.4;

  // Wind effect on cape
  if (cape) {
    cape.group.rotation.x = Math.PI * 0.7 + Math.sin(t * 8) * 0.1;
  }

  // Subtle floating motion
  const float = Math.sin(t * 2) * 0.5;
  parts.body.position.y = flyY + float;
};

// Animation registry
const animations: Record<AnimationType, AnimationUpdater | null> = {
  idle: updateIdle,
  walk: updateWalk,
  run: updateRun,
  wave: updateWave,
  crouch: updateCrouch,
  fly: updateFly,
  none: null,
};

// Create animation state
export function createAnimationState(
  type: AnimationType = "idle",
  speed = 1
): AnimationState {
  return { type, speed, time: 0 };
}

// Update animation
export function updateAnimation(
  parts: PlayerModelParts,
  cape: CapeModel | null,
  state: AnimationState,
  delta: number
): void {
  const updater = animations[state.type];

  if (updater) {
    updater(parts, cape, state, delta);
  } else {
    // No animation - reset to default pose
    resetPose(parts);
  }
}

// Change animation type
export function setAnimationType(
  state: AnimationState,
  type: AnimationType
): void {
  if (state.type !== type) {
    state.type = type;
    state.time = 0; // Reset time for smooth transition
  }
}

// Set animation speed
export function setAnimationSpeed(state: AnimationState, speed: number): void {
  state.speed = speed;
}
