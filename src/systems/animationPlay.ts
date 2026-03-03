import { addComponent, defineQuery, enterQuery, exitQuery } from "bitecs";
import { AnimationMixer, LoopOnce, Object3D } from "three";
import { HubsWorld } from "../app";
import {
  AnimationOnClick,
  CursorRaycastable,
  Interacted,
  MixerAnimatableData,
  NetworkedAnimationOnClick,
  Object3DTag,
  RemoteHoverTarget,
  SingleActionButton
} from "../bit-components";
import { localClientID } from "../bit-systems/networking";

const ANIMATION_NAME_TAG = "_interactive_animation";
const NAF_DATA_TYPE = "animation-play";

const mixers = new Map<number, AnimationMixer>();
const animRoots = new Map<number, Object3D>();
const triggerUUIDs = new Map<number, Set<string>>();
const lastPlayCount = new Map<number, number>();
const nameToEid = new Map<string, number>();

let nafHandlerRegistered = false;

const newObjectQuery = enterQuery(defineQuery([Object3DTag]));
const animQuery = defineQuery([AnimationOnClick, SingleActionButton]);
const animEnterQuery = enterQuery(animQuery);
const animExitQuery = exitQuery(animQuery);
const clickedQuery = enterQuery(defineQuery([AnimationOnClick, NetworkedAnimationOnClick, SingleActionButton, Interacted]));
const networkedAnimQuery = defineQuery([AnimationOnClick, NetworkedAnimationOnClick]);

function ensureNafHandler() {
  if (nafHandlerRegistered) return;
  nafHandlerRegistered = true;
  NAF.connection.subscribeToDataChannel(NAF_DATA_TYPE, (_senderId: string, _dataType: string, data: { name: string }) => {
    const eid = nameToEid.get(data.name);
    if (eid !== undefined) {
      NetworkedAnimationOnClick.playing[eid]++;
    }
  });
}

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

function playAnimations(eid: number) {
  const root = animRoots.get(eid);
  const mixer = mixers.get(eid);
  const uuids = triggerUUIDs.get(eid);
  if (!root || !mixer || !uuids) return;

  const myClips = root.animations.filter(clip =>
    clip.tracks.some(track => uuids.has(track.name.split(".")[0]))
  );

  mixer.stopAllAction();
  for (const clip of myClips) {
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = false;
    action.play();
  }
}

export function animationPlaySystem(world: HubsWorld) {
  // Register NAF receive handler as soon as NAF is connected
  if (typeof NAF !== "undefined" && localClientID) {
    ensureNafHandler();
  }

  // Auto-tag any object whose name contains the marker string
  newObjectQuery(world).forEach(eid => {
    const obj = world.eid2obj.get(eid);
    if (!obj?.name.includes(ANIMATION_NAME_TAG)) return;
    addComponent(world, AnimationOnClick, eid);
    addComponent(world, NetworkedAnimationOnClick, eid);
    addComponent(world, CursorRaycastable, eid);
    addComponent(world, RemoteHoverTarget, eid);
    addComponent(world, SingleActionButton, eid);
    nameToEid.set(obj.name, eid);
  });

  // Set up mixer and suppress auto-play for newly tagged entities
  animEnterQuery(world).forEach(eid => {
    const obj = world.eid2obj.get(eid);
    if (!obj) return;
    const ctx = findAnimationContext(obj);
    if (!ctx) return;

    const uuids = new Set<string>();
    obj.traverse(child => uuids.add(child.uuid));
    triggerUUIDs.set(eid, uuids);

    animRoots.set(eid, ctx.root);
    mixers.set(eid, new AnimationMixer(ctx.root));
    lastPlayCount.set(eid, NetworkedAnimationOnClick.playing[eid]);

    // Stop auto-play from both the bitecs and AFrame animation systems
    if (ctx.root.eid !== undefined) MixerAnimatableData.get(ctx.root.eid)?.stopAllAction();
    ctx.aframeMixer?.stopAllAction();
  });

  // Clean up when entity is removed
  animExitQuery(world).forEach(eid => {
    const obj = world.eid2obj.get(eid);
    if (obj) nameToEid.delete(obj.name);
    mixers.get(eid)?.stopAllAction();
    mixers.delete(eid);
    animRoots.delete(eid);
    triggerUUIDs.delete(eid);
    lastPlayCount.delete(eid);
  });

  // Advance all active mixers
  animQuery(world).forEach(eid => {
    mixers.get(eid)?.update(world.time.delta / 1000.0);
  });

  // On click: increment counter locally and broadcast to other clients by name
  clickedQuery(world).forEach(eid => {
    NetworkedAnimationOnClick.playing[eid]++;
    const obj = world.eid2obj.get(eid);
    if (obj && typeof NAF !== "undefined" && localClientID) {
      NAF.connection.broadcastDataGuaranteed(NAF_DATA_TYPE, { name: obj.name });
    }
  });

  // Detect counter changes — triggered by local clicks and remote receives
  networkedAnimQuery(world).forEach(eid => {
    const current = NetworkedAnimationOnClick.playing[eid];
    if (!lastPlayCount.has(eid)) {
      // First encounter: seed without playing
      lastPlayCount.set(eid, current);
      return;
    }
    if (current !== lastPlayCount.get(eid)) {
      lastPlayCount.set(eid, current);
      playAnimations(eid);
    }
  });
}
