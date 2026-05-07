/**
 * Sub-export entry-point: `node-dreame/map`.
 *
 * Per-concern modules are split for clarity (see each file's
 * docblock); this barrel re-exports the public surface so
 * consumers don't need to reach into specific filenames.
 */

export { MapDecoder } from "./decoder.js";
export {
  MapDecodeError,
  HEADER_SIZE,
  ANGLE_ABSENT,
  FRAME_TYPE,
  unwrapEnvelope,
} from "./envelope.js";
export { parseMapHeader } from "./header.js";
export type { MapHeader } from "./header.js";
export { parseMapJsonTail, parseFrame, sliceTailText } from "./tail.js";
export { classifyPixelFsm1, decodePixelGridFsm1 } from "./pixel-grid.js";
export type { PixelClass } from "./pixel-grid.js";
export { parsePathTr } from "./path.js";
export { parseObstacles } from "./obstacles.js";
export {
  parseVirtualWalls,
  parseLowLyingAreas,
  parseWallsInfo,
} from "./geometry.js";
export { parseCleanedAreaOverlay } from "./cleaned-area.js";

export type { MapTail, RawSegInf } from "./types.js";

export { requestIFrame, requestPFrame } from "./request.js";
export type { RequestIFrameOptions, RequestPFrameOptions } from "./request.js";

export { mergePFrame, mergePFrameEnvelope, OutOfOrderFrameError } from "./merge.js";

export { OssFetcher } from "./oss-fetch.js";
export type { OssFetchInput, OssFetcherOpts } from "./oss-fetch.js";

export { parsePointerJson } from "./pointer-json.js";
export type { ParsedPointerJson } from "./pointer-json.js";

export { MapManager, clientFrameRequester } from "./manager.js";
export type {
  MapManagerOpts,
  FrameRequester,
  OssInputBase,
  OssInputProvider,
} from "./manager.js";

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
  MapVirtualWall,
  MapRestrictedArea,
  MapLowLyingArea,
  MapWallsInfo,
  MapStorey,
  MapRoom,
  MapRoomWall,
  MapCleanedAreaOverlay,
  MapSaved,
  MapSavedList,
} from "./types.js";
