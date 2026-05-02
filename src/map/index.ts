/**
 * Sub-export entry-point: `node-dreame/map`.
 *
 * Phase 1 ships the pure decoder. `MapManager` (Phases 3-4) and the
 * `package.json` `exports` field wiring (Phase 5) come later.
 */

export {
  MapDecoder,
  MapDecodeError,
  HEADER_SIZE,
  ANGLE_ABSENT,
  FRAME_TYPE,
  unwrapEnvelope,
  parseMapHeader,
  parseMapJsonTail,
  sliceTailText,
  classifyPixelFsm1,
  decodePixelGridFsm1,
  parsePathTr,
  parseObstacles,
} from "./decoder.js";
export type { MapHeader, MapTail, RawSegInf, PixelClass } from "./decoder.js";

export { requestIFrame, requestPFrame } from "./request.js";
export type { RequestIFrameOptions, RequestPFrameOptions } from "./request.js";

export type {
  MapData,
  MapDecodeOptions,
  MapDimensions,
  MapBoundingBox,
  MapPoint,
  MapPose,
  MapRun,
  MapLayer,
  MapLayerType,
  MapSegment,
  MapPath,
  MapPathType,
  MapObstacle,
  MapFrameType,
} from "./types.js";
