# Interactive Objects — Naming Conventions

All interactive behaviour is driven by the **object name** in Spoke (or the GLB node name). Matching is **case-sensitive**, and file extensions (`.glb`, `.gltf`, `.fbx`, `.obj`) are stripped before matching.

There are four name conventions plus one prefix.

---

## 1. Interactive animation — `_interactive_animation`

Click or reach into an object to play an animation.

### Name grammar

```
<AnyLabel>_interactive_animation[_hand|_both][_<Target>][_clip_<ClipName>][_loop]
```

`<AnyLabel>` is free text — use it to name the object however you like. The parser reads the parts in this order: trailing `_loop`, then `_clip_<name>`, then the mode prefix, and whatever remains is the target name.

### All valid permutations

| Name | Trigger | Animates | Repeat |
| --- | --- | --- | --- |
| `X_interactive_animation` | Desktop click | Itself | Once |
| `X_interactive_animation_loop` | Desktop click | Itself | Toggles loop on/off |
| `X_interactive_animation_Target` | Desktop click | Itself **and** `Target` | Once |
| `X_interactive_animation_Target_loop` | Desktop click | `Target` | Toggles loop on/off |
| `X_interactive_animation_Target_clip_ClipName` | Desktop click | `Target`, only clip `ClipName` | Once |
| `X_interactive_animation_hand` | VR hand enters its box | Itself | Once |
| `X_interactive_animation_hand_loop` | VR hand | Itself | Toggles loop on/off |
| `X_interactive_animation_hand_Target` | VR hand | Itself and `Target` | Once |
| `X_interactive_animation_hand_Target_loop` | VR hand | `Target` | Toggles loop on/off |
| `X_interactive_animation_hand_Target_clip_ClipName` | VR hand | `Target`, only clip `ClipName` | Once |
| `X_interactive_animation_both` | Click **or** VR hand | Itself | Once |
| `X_interactive_animation_both_loop` | Click or VR hand | Itself | Toggles loop on/off |
| `X_interactive_animation_both_Target` | Click or VR hand | Itself and `Target` | Once |
| `X_interactive_animation_both_Target_loop` | Click or VR hand | `Target` | Toggles loop on/off |
| `X_interactive_animation_both_Target_clip_ClipName` | Click or VR hand | `Target`, only clip `ClipName` | Once |

### Trigger modes

| Mode | Written as | Behaviour |
| --- | --- | --- |
| Desktop | *(no prefix — the default)* | Cursor click only. In VR this is the controller **trigger**. |
| Hand | `_hand` | VR hand entering the object's bounding box only. **Not clickable on desktop** — these objects get no cursor raycast at all. |
| Both | `_both` | Either a click or a VR hand entry. |

### Rules

- **`_clip_` only works with a target.** A clip name with no target is silently ignored — the object plays all of its own clips instead.
- **`_clip_` overrides `_loop`.** A clip-specific trigger always plays once, even if `_loop` is also present.
- **`_clip_` locks its target** for the duration of the clip. While it is playing, clicks on *any* clip-trigger sharing the same target are ignored — the user is locked into their choice until it finishes. (This is the quiz-answer behaviour.) Non-clip triggers ignore the lock.
- **`_loop` is a toggle, not play-forever.** Clicking a looping trigger while it runs stops it.
- **Target matching** is by exact name *or* `Target_1`, `Target_2`, … — the suffixes the GLTF loader adds when several objects share a name. All matching objects animate together. Extensions are stripped from both sides, so a dropped-in `robot.glb` matches a target written as `robot`.
- **Targets never auto-play on load.** Any name used as a target has its looping clips suppressed so it only animates when its trigger fires. This is done clip-by-clip, so genuine auto-loop objects in the same GLB keep running.
- **VR hand triggers fire on entry only** — the hand must leave the bounding box before the object can fire again.
- **Desktop click vs. drag:** on grabbable triggers, a release within **250 ms** and **5 cm** counts as a click and plays the animation. Anything longer or further is treated as a drag and does not animate. This test is skipped in VR, where the trigger interacts and the grip picks up.
- **Everything is networked by object name** — when one person fires a trigger, everyone in the room sees the animation.

---

## 2. Proximity animation — `_proximity_near` / `_proximity_medium` / `_proximity_far`

Animation plays as you walk up to an object.

| Name | Radius |
| --- | --- |
| `X_proximity_near` | 2 m |
| `X_proximity_medium` | 5 m |
| `X_proximity_far` | 10 m |

Behaviour depends on **how many animation clips the object has**:

| Clips | On enter | On leave |
| --- | --- | --- |
| 1 | Loops continuously | Pauses in place; resumes from that point on re-entry |
| 2 or more | Clip 1 plays once, clamped at its final frame | Clip 2 plays once, clamped at its final frame |

Clips 3 and beyond are unused.

Distance is measured from the camera to the object's world position. The trigger requires 10 consecutive in-range frames, and you must have been seen *outside* the radius at least once before it can fire — this prevents false triggers from the "Enter Room" teleport. Networked: one person walking in plays it for everyone.

---

## 3. Proximity video — `_video_proximity_near` / `_video_proximity_medium` / `_video_proximity_far`

| Name | Radius |
| --- | --- |
| `X_video_proximity_near` | 2 m |
| `X_video_proximity_medium` | 5 m |
| `X_video_proximity_far` | 10 m |

The video is paused on load, **plays looping** when you enter the radius, and pauses when you leave. Same debounce and networking as proximity animation.

---

## 4. Proximity audio — `_audio_proximity_near` / `_audio_proximity_medium` / `_audio_proximity_far`

| Name | Radius |
| --- | --- |
| `X_audio_proximity_near` | 2 m |
| `X_audio_proximity_medium` | 5 m |
| `X_audio_proximity_far` | 10 m |

The audio is paused on load, **plays once (no loop)** when you enter the radius, and pauses when you leave.

> **Watch the token order.** Animation uses `_proximity_near`, but video and audio use `_video_proximity_near` and `_audio_proximity_near`. The media types put their type *before* `proximity`.

---

## 5. Spawners — `Spawner_<ObjectName>`

Naming a Spoke spawner `Spawner_` + a name makes every spawned copy take that name. This lets all the conventions above flow through a spawner without re-authoring the underlying GLB.

**Example:** a spawner named `Spawner_Robot_interactive_animation_both` spawns copies named `Robot_interactive_animation_both`, each of which is a working click-or-hand animation trigger.

The spawner object itself never becomes a trigger, and its preview model does not auto-animate.

---

## Uploaded and dragged-in models

When a model is uploaded or dragged into a room, its original filename (extension stripped) becomes its object name, and that name is stored on the entity so it **survives pinning, reloads, and late-joining clients**.

This means:

- `Door_interactive_animation.glb` dropped into a room is a working trigger.
- `robot.glb` dropped into a room is a valid `robot` target for an existing trigger.

---

## Quick reference

| Convention | Purpose |
| --- | --- |
| `_interactive_animation` | Click / VR-hand triggered animation, on itself or a named target |
| `_hand` / `_both` | Trigger mode modifier (default is desktop click) |
| `_<Target>` | Animate another object by name instead of / as well as itself |
| `_clip_<ClipName>` | Play one specific named clip on the target, with a lock while it runs |
| `_loop` | Make the trigger a loop on/off toggle |
| `_proximity_near\|medium\|far` | Walk-up animation at 2 m / 5 m / 10 m |
| `_video_proximity_near\|medium\|far` | Walk-up video (loops while in range) |
| `_audio_proximity_near\|medium\|far` | Walk-up audio (plays once on entry) |
| `Spawner_<ObjectName>` | Pass any of the above through to spawned copies |
