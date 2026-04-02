import { addComponent, defineQuery, enterQuery, exitQuery } from "bitecs";
import { AnimationMixer, Box3, LoopOnce, Object3D, Vector3 } from "three";
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

const enum TriggerMode {
  Desktop, // click only (default)
  Hand, // VR hand only
  Both // click + VR hand
}

const mixers = new Map<number, AnimationMixer>();
const animRoots = new Map<number, Object3D>();
const triggerUUIDs = new Map<number, Set<string>>();
const lastPlayCount = new Map<number, number>();
const nameToEid = new Map<string, number>();

// Linked target animation support
const targetName = new Map<number, string>(); // eid -> target object name suffix
const targetMixersList = new Map<number, AnimationMixer[]>();
const targetRootsList = new Map<number, Object3D[]>();
const targetUUIDsList = new Map<number, Set<string>[]>();

// VR hand trigger support
const triggerMode = new Map<number, TriggerMode>();
const handBounds = new Map<number, Box3>();
const handInside = new Map<number, boolean>(); // debounce: true while hand is inside

let nafHandlerRegistered = false;

const newObjectQuery = enterQuery(defineQuery([Object3DTag]));
const animQuery = defineQuery([AnimationOnClick, SingleActionButton]);
const animEnterQuery = enterQuery(animQuery);
const animExitQuery = exitQuery(animQuery);
const clickedQuery = enterQuery(defineQuery([AnimationOnClick, NetworkedAnimationOnClick, SingleActionButton, Interacted]));
const networkedAnimQuery = defineQuery([AnimationOnClick, NetworkedAnimationOnClick]);

// Reusable vectors for hand position checks
const controllerPos = new Vector3();
const tmpBox = new Box3();

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

// Find all scene objects matching the target name exactly or as TargetName_N (numbered suffix)
function findSceneObjectsByTargetName(name: string): Object3D[] {
  const scene = AFRAME.scenes[0]?.object3D;
  if (!scene) return [];
  const suffixPattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_\\d+$`);
  const results: Object3D[] = [];
  scene.traverse((child: Object3D) => {
    if (child.name === name || suffixPattern.test(child.name)) {
      results.push(child);
    }
  });
  return results;
}

// Parse the suffix after _interactive_animation to extract mode and optional target name
function parseSuffix(suffix: string): { mode: TriggerMode; target: string | null } {
  if (!suffix) return { mode: TriggerMode.Desktop, target: null };

  if (suffix === "hand") return { mode: TriggerMode.Hand, target: null };
  if (suffix === "both") return { mode: TriggerMode.Both, target: null };
  if (suffix.startsWith("hand_")) return { mode: TriggerMode.Hand, target: suffix.substring(5) };
  if (suffix.startsWith("both_")) return { mode: TriggerMode.Both, target: suffix.substring(5) };

  // No mode prefix — entire suffix is the target name, desktop mode
  return { mode: TriggerMode.Desktop, target: suffix };
}

// Compute world-space AABB for an object
function computeWorldBounds(obj: Object3D): Box3 {
  const box = new Box3();
  box.setFromObject(obj);
  return box;
}

// Get VR controller Object3Ds (cached references)
let leftController: Object3D | null = null;
let rightController: Object3D | null = null;

function getControllers(): { left: Object3D | null; right: Object3D | null } {
  if (!leftController) {
    const el = document.querySelector("#player-left-controller") as any;
    if (el?.object3D) leftController = el.object3D;
  }
  if (!rightController) {
    const el = document.querySelector("#player-right-controller") as any;
    if (el?.object3D) rightController = el.object3D;
  }
  return { left: leftController, right: rightController };
}

function playClips(mixer: AnimationMixer, root: Object3D, uuids: Set<string>) {
  const clips = root.animations.filter(clip =>
    clip.tracks.some(track => uuids.has(track.name.split(".")[0]))
  );

  mixer.stopAllAction();
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = false;
    action.play();
  }
}

function playAnimations(eid: number) {
  const root = animRoots.get(eid);
  const mixer = mixers.get(eid);
  const uuids = triggerUUIDs.get(eid);
  if (!root || !mixer || !uuids) {
    console.warn(`[animPlay] playAnimations eid=${eid} — missing: root=${!!root} mixer=${!!mixer} uuids=${!!uuids}`);
    return;
  }

  const clips = root.animations?.filter(clip => clip.tracks.some(track => uuids.has(track.name.split(".")[0])));
  console.log(`[animPlay] playAnimations eid=${eid} root="${root.name}" matchingClips=${clips?.length ?? 0} totalClips=${root.animations?.length ?? 0}`);

  playClips(mixer, root, uuids);

  // Also play linked target animations if configured
  playTargetAnimations(eid);
}

function playTargetAnimations(eid: number) {
  const tName = targetName.get(eid);
  if (!tName) return;

  // Resolve targets lazily each time so late-arriving objects (e.g. uploads) are found
  const tObjects = findSceneObjectsByTargetName(tName);
  if (tObjects.length === 0) {
    console.log(`[animPlay] playTargetAnimations eid=${eid} target="${tName}" — no objects found`);
    return;
  }

  // Stop any previously active target mixers
  targetMixersList.get(eid)?.forEach(m => m.stopAllAction());

  const mixerList: AnimationMixer[] = [];
  const rootList: Object3D[] = [];
  const uuidList: Set<string>[] = [];

  for (const tObj of tObjects) {
    const tCtx = findAnimationContext(tObj);
    if (!tCtx) {
      console.warn(`[animPlay] playTargetAnimations target "${tObj.name}" — findAnimationContext returned NULL`);
      continue;
    }

    const tUuids = new Set<string>();
    tObj.traverse(child => tUuids.add(child.uuid));
    uuidList.push(tUuids);
    rootList.push(tCtx.root);
    mixerList.push(new AnimationMixer(tCtx.root));

    if (tCtx.root.eid !== undefined) MixerAnimatableData.get(tCtx.root.eid)?.stopAllAction();
    tCtx.aframeMixer?.stopAllAction();
  }

  console.log(`[animPlay] playTargetAnimations eid=${eid} target="${tName}" found=${tObjects.length} withAnims=${mixerList.length}`);

  // Cache for the update loop to tick, and play
  if (mixerList.length > 0) {
    targetMixersList.set(eid, mixerList);
    targetRootsList.set(eid, rootList);
    targetUUIDsList.set(eid, uuidList);

    for (let i = 0; i < mixerList.length; i++) {
      playClips(mixerList[i], rootList[i], uuidList[i]);
    }
  }
}

// Check if either VR controller is inside the object's bounding box
function isControllerInside(eid: number): boolean {
  const bounds = handBounds.get(eid);
  if (!bounds) return false;

  // Recompute world bounds each frame (object may move)
  const obj = (APP as any).world?.eid2obj?.get(eid);
  if (obj) {
    tmpBox.setFromObject(obj);
  } else {
    tmpBox.copy(bounds);
  }

  const { left, right } = getControllers();

  if (left) {
    left.getWorldPosition(controllerPos);
    if (tmpBox.containsPoint(controllerPos)) return true;
  }
  if (right) {
    right.getWorldPosition(controllerPos);
    if (tmpBox.containsPoint(controllerPos)) return true;
  }

  return false;
}

export function animationPlaySystem(world: HubsWorld) {
  // Register NAF receive handler as soon as NAF is connected
  if (typeof NAF !== "undefined" && localClientID) {
    ensureNafHandler();
  }

  // Auto-tag any object whose name contains the marker string
  newObjectQuery(world).forEach(eid => {
    const obj = world.eid2obj.get(eid);
    if (!obj) return;
    // Strip common file extensions before checking for the animation tag
    const objName = obj.name.replace(/\.(glb|gltf|fbx|obj)$/i, "");
    if (!objName.includes(ANIMATION_NAME_TAG)) return;

    console.log(`[animPlay] TAGGED eid=${eid} name="${obj.name}" stripped="${objName}"`);

    // Parse mode and target from the suffix
    const suffixStart = objName.indexOf(ANIMATION_NAME_TAG) + ANIMATION_NAME_TAG.length;
    let suffix = "";
    if (suffixStart < objName.length && objName[suffixStart] === "_") {
      suffix = objName.substring(suffixStart + 1);
    }
    const { mode, target } = parseSuffix(suffix);

    console.log(`[animPlay]   mode=${mode} target=${target ?? "none"} suffix="${suffix}"`);

    addComponent(world, AnimationOnClick, eid);
    addComponent(world, NetworkedAnimationOnClick, eid);
    addComponent(world, SingleActionButton, eid);
    nameToEid.set(obj.name, eid);
    triggerMode.set(eid, mode);

    // Only add click/raycast components for desktop and both modes
    if (mode === TriggerMode.Desktop || mode === TriggerMode.Both) {
      addComponent(world, CursorRaycastable, eid);
      addComponent(world, RemoteHoverTarget, eid);
    }

    if (target) {
      targetName.set(eid, target);
    }

    // Set up bounding box for hand modes
    if (mode === TriggerMode.Hand || mode === TriggerMode.Both) {
      handBounds.set(eid, computeWorldBounds(obj));
      handInside.set(eid, false);
    }
  });

  // Set up mixer and suppress auto-play for newly tagged entities
  animEnterQuery(world).forEach(eid => {
    const obj = world.eid2obj.get(eid);
    if (!obj) {
      console.warn(`[animPlay] ENTER eid=${eid} — no Object3D, skipping`);
      return;
    }
    const ctx = findAnimationContext(obj);
    if (!ctx) {
      console.warn(`[animPlay] ENTER eid=${eid} name="${obj.name}" — findAnimationContext returned NULL (no ancestor with animations)`);
      // Walk parents to show hierarchy for debugging
      let p = obj.parent;
      let depth = 0;
      while (p && depth < 10) {
        console.log(`  [animPlay]   parent[${depth}]: "${p.name}" type=${p.type} animations=${p.animations?.length ?? 0} eid=${(p as any).eid ?? "none"}`);
        p = p.parent;
        depth++;
      }
      return;
    }

    console.log(`[animPlay] ENTER eid=${eid} name="${obj.name}" root="${ctx.root.name}" rootAnimations=${ctx.root.animations?.length} aframeMixer=${!!ctx.aframeMixer}`);
    ctx.root.animations?.forEach((clip, i) => console.log(`  [animPlay]   clip[${i}]: "${clip.name}" tracks=${clip.tracks.length}`));

    const uuids = new Set<string>();
    obj.traverse(child => uuids.add(child.uuid));
    triggerUUIDs.set(eid, uuids);

    animRoots.set(eid, ctx.root);
    mixers.set(eid, new AnimationMixer(ctx.root));
    lastPlayCount.set(eid, NetworkedAnimationOnClick.playing[eid]);

    // Stop auto-play from both the bitecs and AFrame animation systems
    if (ctx.root.eid !== undefined) MixerAnimatableData.get(ctx.root.eid)?.stopAllAction();
    ctx.aframeMixer?.stopAllAction();

    // Target resolution is now done lazily in playTargetAnimations
    // so that objects uploaded after scene load are found
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
    targetName.delete(eid);
    triggerMode.delete(eid);
    targetMixersList.get(eid)?.forEach(m => m.stopAllAction());
    targetMixersList.delete(eid);
    targetRootsList.delete(eid);
    targetUUIDsList.delete(eid);
    handBounds.delete(eid);
    handInside.delete(eid);
  });

  // Advance all active mixers (including linked targets)
  animQuery(world).forEach(eid => {
    const dt = world.time.delta / 1000.0;
    mixers.get(eid)?.update(dt);
    targetMixersList.get(eid)?.forEach(m => m.update(dt));
  });

  // On click: increment counter locally and broadcast to other clients by name
  // Only fires for Desktop and Both modes (Hand-only objects have no CursorRaycastable)
  clickedQuery(world).forEach(eid => {
    NetworkedAnimationOnClick.playing[eid]++;
    const obj = world.eid2obj.get(eid);
    if (obj && typeof NAF !== "undefined" && localClientID) {
      NAF.connection.broadcastDataGuaranteed(NAF_DATA_TYPE, { name: obj.name });
    }
  });

  // VR hand collision check — only when in VR mode
  const inVR = APP.scene?.is("vr-mode");
  if (inVR) {
    networkedAnimQuery(world).forEach(eid => {
      const mode = triggerMode.get(eid);
      if (mode !== TriggerMode.Hand && mode !== TriggerMode.Both) return;

      const inside = isControllerInside(eid);
      const wasInside = handInside.get(eid) ?? false;

      // Trigger on entry only — require hand to leave before re-triggering
      if (inside && !wasInside) {
        NetworkedAnimationOnClick.playing[eid]++;
        const obj = world.eid2obj.get(eid);
        if (obj && typeof NAF !== "undefined" && localClientID) {
          NAF.connection.broadcastDataGuaranteed(NAF_DATA_TYPE, { name: obj.name });
        }
      }

      handInside.set(eid, inside);
    });
  }

  // Detect counter changes — triggered by local clicks, hand entry, and remote receives
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
