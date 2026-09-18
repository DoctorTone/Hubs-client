import { HubsWorld } from "../app";
import { MediaImageLoaderData } from "../bit-components";
import { AlphaModeName, getAlphaModeFromAlphaModeName } from "../utils/create-image-mesh";
import { ProjectionModeName, getProjectionFromProjectionName } from "../utils/projection-mode";
import { inflateMediaLoader } from "./media-loader";

export interface ImageLoaderParams {
  src: string;
  projection: ProjectionModeName;
  alphaMode: AlphaModeName;
  alphaCutoff: number;
  // Part of the glTF schema, but deliberately unused here: "controls" means media controls, not
  // "this image has a link". Adding a MediaLink for it gave every Spoke image a src-less Link,
  // which showed a dead "open link" hover menu and made the image cursor-grabbable. Images with a
  // real Spoke link component still get MediaLink via the ext.link -> media-link mapping in
  // gltf-model-plus, which actually sets the src.
  controls: boolean;
}

const DEFAULTS: Partial<ImageLoaderParams> = {
  projection: ProjectionModeName.FLAT,
  alphaMode: AlphaModeName.OPAQUE,
  alphaCutoff: 0.5,
  controls: false
};

export function inflateImageLoader(world: HubsWorld, eid: number, params: ImageLoaderParams) {
  inflateMediaLoader(world, eid, {
    src: params.src,
    recenter: false,
    resize: false,
    animateLoad: false,
    isObjectMenuTarget: false
  });

  const requiredParams = Object.assign({}, DEFAULTS, params) as Required<ImageLoaderParams>;
  MediaImageLoaderData.set(eid, {
    alphaCutoff: requiredParams.alphaCutoff,
    // This inflator is glTF inflator. alphaMode and projection are
    // passed as strings from glTF. They are different typed, just regular enum,
    // in Hubs Client internal. So needs to convert here.
    alphaMode: getAlphaModeFromAlphaModeName(requiredParams.alphaMode),
    projection: getProjectionFromProjectionName(requiredParams.projection)
  });
}
