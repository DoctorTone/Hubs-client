import { addComponent, defineQuery, enterQuery, exitQuery } from "bitecs";
import { AnimationMixer, LoopOnce, Object3D } from "three";
import { HubsWorld } from "../app";
import {
  AnimationOnClick,
  CursorRaycastable,
  Interacted,
  MixerAnimatableData,
  Object3DTag,
  RemoteHoverTarget,
  SingleActionButton
} from "../bit-components";

const ANIMATION_NAME_TAG = "_interactive_animation";

const mixers = new Map<number, AnimationMixer>();
const animRoots = new Map<number, Object3D>();

const newObjectQuery = enterQuery(defineQuery([Object3DTag]));
const animQuery = defineQuery([AnimationOnClick, SingleActionButton]);
const animEnterQuery = enterQuery(animQuery);
const animExitQuery = exitQuery(animQuery);
const clickedQuery = enterQuery(defineQuery([AnimationOnClick, SingleActionButton, Interacted]));

// Walk up the hierarchy to find the nearest ancestor that has animation clips,
// and continue walking to find the AFrame animation-mixer component if present.
// Both live on different ancestors because gltf-model-plus sets animations on
// gltf.scene while the AFrame animation-mixer sits one level higher on el.object3D.
function findAnimationContext(obj: Object3D): { root: Object3D; aframeMixer: AnimationMixer | null } | null {
  let root: Object3D | null = null;
  let aframeMixer: AnimationMixer | null = null;
  let current: Object3D | null = obj;

  while (current) {
    if (!root && current.animations?.length > 0) root = current;
    if (!aframeMixer) {
      const mixer = (current.el as any)?.components?.["animation-mixer"]?.mixer;
      if (mixer) aframeMixer = mixer;
    }
    if (root && aframeMixer) break;
    current = current.parent;
  }

  return root ? { root, aframeMixer } : null;
}

export function animationPlaySystem(world: HubsWorld) {
  // Auto-tag any object whose name contains the marker string
  newObjectQuery(world).forEach(eid => {
    const obj = world.eid2obj.get(eid);
    if (!obj?.name.includes(ANIMATION_NAME_TAG)) return;
    addComponent(world, AnimationOnClick, eid);
    addComponent(world, CursorRaycastable, eid);
    addComponent(world, RemoteHoverTarget, eid);
    addComponent(world, SingleActionButton, eid);
  });

  // Set up mixer and suppress auto-play for newly tagged entities
  animEnterQuery(world).forEach(eid => {
    const obj = world.eid2obj.get(eid);
    if (!obj) return;
    const ctx = findAnimationContext(obj);
    if (!ctx) return;

    animRoots.set(eid, ctx.root);
    mixers.set(eid, new AnimationMixer(ctx.root));

    // Stop auto-play from both the bitecs and AFrame animation systems
    if (ctx.root.eid !== undefined) MixerAnimatableData.get(ctx.root.eid)?.stopAllAction();
    ctx.aframeMixer?.stopAllAction();
  });

  // Clean up when entity is removed
  animExitQuery(world).forEach(eid => {
    mixers.get(eid)?.stopAllAction();
    mixers.delete(eid);
    animRoots.delete(eid);
  });

  // Advance all active mixers
  animQuery(world).forEach(eid => {
    mixers.get(eid)?.update(world.time.delta / 1000.0);
  });

  // Play all clips once on click
  clickedQuery(world).forEach(eid => {
    const root = animRoots.get(eid);
    const mixer = mixers.get(eid);
    if (!root || !mixer) return;

    mixer.stopAllAction();
    for (const clip of root.animations) {
      const action = mixer.clipAction(clip);
      action.reset();
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = false;
      action.play();
    }
  });
}
