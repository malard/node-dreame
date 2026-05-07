/**
 * 27-byte binary header at the start of every inflated map frame.
 * Layout per `docs/live-map-format.md` §"27-byte header".
 */

import type { MapFrameType } from "./types.js";
import { FRAME_TYPE, HEADER_SIZE, MapDecodeError } from "./envelope.js";

export interface MapHeader {
  mapId: number;
  frameId: number;
  frameType: MapFrameType;
  robotX: number;
  robotY: number;
  robotA: number;
  chargerX: number;
  chargerY: number;
  chargerA: number;
  gridSize: number;
  width: number;
  height: number;
  left: number;
  top: number;
}

export function parseMapHeader(buf: Buffer): MapHeader {
  if (buf.length < HEADER_SIZE) {
    throw new MapDecodeError(`header: need ${HEADER_SIZE} bytes, got ${buf.length}`);
  }
  return {
    mapId: buf.readInt16LE(0),
    frameId: buf.readInt16LE(2),
    frameType: frameTypeFromByte(buf[4]!),
    robotX: buf.readInt16LE(5),
    robotY: buf.readInt16LE(7),
    robotA: buf.readInt16LE(9),
    chargerX: buf.readInt16LE(11),
    chargerY: buf.readInt16LE(13),
    chargerA: buf.readInt16LE(15),
    gridSize: buf.readInt16LE(17),
    width: buf.readInt16LE(19),
    height: buf.readInt16LE(21),
    left: buf.readInt16LE(23),
    top: buf.readInt16LE(25),
  };
}

function frameTypeFromByte(b: number): MapFrameType {
  switch (b) {
    case FRAME_TYPE.I:
      return "I";
    case FRAME_TYPE.P:
      return "P";
    case FRAME_TYPE.W:
      return "W";
    default:
      throw new MapDecodeError(`header: unknown frame_type byte ${b}`);
  }
}
