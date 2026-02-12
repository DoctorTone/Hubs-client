import { addComponent, addEntity, defineQuery, enterQuery } from "bitecs";
import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";
import { addObject3DComponent } from "../utils/jsx-entity";
import { HubsWorld } from "../app";
import { CursorRaycastable, RemoteHoverTarget, SingleActionButton, Interacted } from "../bit-components";

let spawned = false;

const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff];
let colorIndex = 0;

const SPIN_DURATION = 2000;
const spinning = new Map<number, { startTime: number; startY: number }>();

const clickedQuery = enterQuery(defineQuery([SingleActionButton, Interacted]));

export function colourToggleSystem(world: HubsWorld) {
  if (!spawned) {
    const eid = addEntity(world);
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: colors[0] }));
    mesh.position.set(0, 1.5, 0);
    addObject3DComponent(world, eid, mesh);

    addComponent(world, CursorRaycastable, eid);
    addComponent(world, RemoteHoverTarget, eid);
    addComponent(world, SingleActionButton, eid);

    world.scene.add(mesh);
    spawned = true;
  }

  const now = world.time.elapsed;

  clickedQuery(world).forEach(eid => {
    const obj = world.eid2obj.get(eid);
    if (obj instanceof Mesh) {
      colorIndex = (colorIndex + 1) % colors.length;
      (obj.material as MeshStandardMaterial).color.set(colors[colorIndex]);

      spinning.set(eid, { startTime: now, startY: obj.rotation.y });
    }
  });

  spinning.forEach((spin, eid) => {
    const obj = world.eid2obj.get(eid);
    if (!obj) {
      spinning.delete(eid);
      return;
    }
    const t = (now - spin.startTime) / SPIN_DURATION;
    if (t >= 1) {
      obj.rotation.y = spin.startY + Math.PI * 2;
      spinning.delete(eid);
    } else {
      obj.rotation.y = spin.startY + t * Math.PI * 2;
    }
  });
}
