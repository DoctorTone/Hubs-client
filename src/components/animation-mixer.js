/**
 * Instantiates and updates a THREE.AnimationMixer on an entity.
 * @component animation-mixer
 */

const components = [];
export class AnimationMixerSystem {
  tick(dt) {
    for (let i = 0; i < components.length; i++) {
      const cmp = components[i];
      if (cmp.mixer) {
        cmp.mixer.update(dt / 1000);
      }
    }
  }
}

AFRAME.registerComponent("animation-mixer", {
  initMixer(animations) {
    this.mixer = new THREE.AnimationMixer(this.el.object3D);
    this.el.object3D.animations = animations;
    this.animations = animations;
    // [anim-debug] An AFRAME animation-mixer was created on this object with N clips.
    console.warn(
      `[anim-debug] (aframe) animation-mixer initMixer on "${this.el.object3D?.name}"` +
        ` with ${animations?.length ?? 0} clips`
    );
  },
  play() {
    components.push(this);
  },
  pause() {
    // [anim-debug] Mixer removed from the tick loop — every clip on it freezes.
    console.warn(
      `[anim-debug] (aframe) animation-mixer PAUSE (tick removed) on "${this.el.object3D?.name}"`,
      new Error("stack").stack
    );
    components.splice(components.indexOf(this), 1);
  }
});
