import { anyEntityWith, findAncestorEntity } from "../utils/bit-utils";
import { CONSTANTS } from "three-ammo";
const { DISABLE_DEACTIVATION, ACTIVE_TAG } = CONSTANTS.ACTIVATION_STATE;

import { addComponent, defineQuery, enterQuery, entityExists, removeComponent, exitQuery, hasComponent } from "bitecs";
import {
  RemoteRight,
  RemoteLeft,
  HandRight,
  HandLeft,
  HeldRemoteRight,
  HeldRemoteLeft,
  HeldHandRight,
  HeldHandLeft,
  OffersHandConstraint,
  OffersRemoteConstraint,
  Rigidbody,
  Constraint,
  ConstraintHandLeft,
  ConstraintHandRight,
  ConstraintRemoteLeft,
  ConstraintRemoteRight
} from "../bit-components";

const queryRemoteRight = defineQuery([HeldRemoteRight, OffersRemoteConstraint]);
const queryEnterRemoteRight = enterQuery(queryRemoteRight);
const queryExitRemoteRight = exitQuery(queryRemoteRight);

const queryRemoteLeft = defineQuery([HeldRemoteLeft, OffersRemoteConstraint]);
const queryEnterRemoteLeft = enterQuery(queryRemoteLeft);
const queryExitRemoteLeft = exitQuery(queryRemoteLeft);

const queryHandRight = defineQuery([HeldHandRight, OffersHandConstraint]);
const queryEnterHandRight = enterQuery(queryHandRight);
const queryExitHandRight = exitQuery(queryHandRight);

const queryHandLeft = defineQuery([HeldHandLeft, OffersHandConstraint]);
const queryEnterHandLeft = enterQuery(queryHandLeft);
const queryExitHandLeft = exitQuery(queryHandLeft);

const grabBodyOptions = { type: "dynamic", activationState: DISABLE_DEACTIVATION };
const releaseBodyOptions = { activationState: ACTIVE_TAG };

// Body type each grabbed entity had before we made it dynamic, so the release can put it back.
// `grabBodyOptions` sets the type but `releaseBodyOptions` never restored it, so anything that
// took a constraint stayed dynamic forever.
const preGrabTypes = new Map();

function add(world, physicsSystem, interactor, constraintComponent, entities) {
  for (let i = 0; i < entities.length; i++) {
    const eid = findAncestorEntity(world, entities[i], ancestor => hasComponent(world, Rigidbody, ancestor));
    if (!entityExists(world, eid)) continue;

    // A static body is scene geometry and is never grabbable. This matters because the lookup
    // above walks up to the nearest Rigidbody *ancestor*: an interactive Spoke object has no
    // body of its own, so it resolves to #environment-root (hub.html), which carries the scene's
    // trimesh floor collider. Making that dynamic breaks the floor for everything — Bullet
    // cannot simulate a concave btBvhTriangleMeshShape as a dynamic body, so it stops generating
    // contacts and every object dropped afterwards falls straight through.
    const bodyData = physicsSystem.bodyUuidToData.get(Rigidbody.bodyId[eid]);
    if (bodyData && bodyData.options.type === "static") continue;

    if (bodyData) preGrabTypes.set(eid, bodyData.options.type);
    physicsSystem.updateRigidBodyOptions(eid, grabBodyOptions);
    physicsSystem.addConstraint(interactor, Rigidbody.bodyId[eid], Rigidbody.bodyId[interactor], {});
    addComponent(world, Constraint, eid);
    addComponent(world, constraintComponent, eid);
  }
}

function remove(world, offersConstraint, constraintComponent, physicsSystem, interactor, entities) {
  for (let i = 0; i < entities.length; i++) {
    const eid = findAncestorEntity(world, entities[i], ancestor => hasComponent(world, Rigidbody, ancestor));
    if (!entityExists(world, eid)) {
      preGrabTypes.delete(eid);
      continue;
    }
    if (hasComponent(world, offersConstraint, entities[i]) && hasComponent(world, Rigidbody, eid)) {
      // Put the body type back if we changed it. Safe against the floaty release path: this
      // system runs immediately before floatyObjectSystem in the same frame (hubs-systems.ts),
      // so a floaty object's own release branch overwrites this with the state it wants. For
      // everything else — anything neither Owned nor a FloatyObject — this is the only thing
      // that undoes the grab, and without it the body stays dynamic for the rest of the session.
      const preGrabType = preGrabTypes.get(eid);
      preGrabTypes.delete(eid);
      physicsSystem.updateRigidBodyOptions(
        eid,
        preGrabType ? Object.assign({ type: preGrabType }, releaseBodyOptions) : releaseBodyOptions
      );
      physicsSystem.removeConstraint(interactor);
      removeComponent(world, constraintComponent, eid);
      if (
        !hasComponent(world, ConstraintHandLeft, eid) &&
        !hasComponent(world, ConstraintHandRight, eid) &&
        !hasComponent(world, ConstraintRemoteLeft, eid) &&
        !hasComponent(world, ConstraintRemoteRight, eid)
      ) {
        removeComponent(world, Constraint, eid);
      }
    }
  }
}

export function constraintsSystem(world, physicsSystem) {
  add(world, physicsSystem, anyEntityWith(world, RemoteRight), ConstraintRemoteRight, queryEnterRemoteRight(world));
  add(world, physicsSystem, anyEntityWith(world, RemoteLeft), ConstraintRemoteLeft, queryEnterRemoteLeft(world));
  add(world, physicsSystem, anyEntityWith(world, HandRight), ConstraintHandRight, queryEnterHandRight(world));
  add(world, physicsSystem, anyEntityWith(world, HandLeft), ConstraintHandLeft, queryEnterHandLeft(world));
  remove(
    world,
    OffersRemoteConstraint,
    ConstraintRemoteRight,
    physicsSystem,
    anyEntityWith(world, RemoteRight),
    queryExitRemoteRight(world)
  );
  remove(
    world,
    OffersRemoteConstraint,
    ConstraintRemoteLeft,
    physicsSystem,
    anyEntityWith(world, RemoteLeft),
    queryExitRemoteLeft(world)
  );
  remove(
    world,
    OffersHandConstraint,
    ConstraintHandRight,
    physicsSystem,
    anyEntityWith(world, HandRight),
    queryExitHandRight(world)
  );
  remove(
    world,
    OffersHandConstraint,
    ConstraintHandLeft,
    physicsSystem,
    anyEntityWith(world, HandLeft),
    queryExitHandLeft(world)
  );
}
