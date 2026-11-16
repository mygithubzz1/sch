// 编辑器层门面：原理图/封装编辑器、命令、吸附、命中测试与工具工厂的统一出口。
export {
  collectAnchors,
  collectPinAnchors,
  collectWireAnchors,
  collectJunctionAnchors,
  collectLabelAnchors,
  findSnapPoint,
  snapToGrid,
  dedupePoints,
  resolveSnapPoint,
  DEFAULT_GRID,
  SNAP_TOLERANCE_PX,
} from './snapping.js';
export {
  addWireCommand,
  removeEntitiesCommand,
  moveEntitiesCommand,
  rotateSymbolsCommand,
  mirrorSymbolsCommand,
  addSymbolCommand,
  addLabelCommand,
  addTextCommand,
  addJunctionCommand,
  setSymbolFieldCommand,
  setEntityFieldCommand,
  setEntityPropsCommand,
  executeCommand,
  bindCommand,
  createCommandApi,
  applySymbolField,
  applyEntityField,
} from './commands.js';
export { createSymbolResolver } from './symbol-resolver.js';
export {
  CONNECT_TOLERANCE,
  pointsEqual,
  pointOnSegment,
  pointInsideSegment,
  pointOnWire,
  pointInsideWire,
  findJunctionAt,
  findWireJunctions,
  countConductorsAt,
  pruneJunctions,
  wireSegments,
} from './wire-utils.js';
export {
  HIT_TOLERANCE,
  entityBounds,
  hitTest,
  hitTestBox,
  describeEntity,
  boundsOfIds,
} from './hit-test.js';
export { createCanvasInteraction } from './interaction.js';
export { createSchematicEditor } from './schematic-editor.js';
export { createSelectTool } from './tools/select-tool.js';
export { createWireTool } from './tools/wire-tool.js';
export { createPlaceTool } from './tools/place-tool.js';
export { createLabelTool } from './tools/label-tool.js';
export { createTextTool } from './tools/text-tool.js';
export { createEraseTool } from './tools/erase-tool.js';
export {
  createTool,
  computeMoveDelta,
  nextDesignator,
  dedupeConsecutive,
  drawScreenPolyline,
  drawWorldBox,
  drawGhostSymbol,
} from './tools/base.js';
export {
  NEW_FOOTPRINT_ID,
  prepareFootprint,
  nextPadNumber,
  createFootprintStore,
} from './footprint-store.js';
export {
  addPadCommand,
  removeFootprintEntitiesCommand,
  moveFootprintEntitiesCommand,
  updatePadCommand,
  updateGraphicCommand,
  addGraphicCommand,
  applyPadPatch,
  applyGraphicPatch,
  translateGraphic,
  bindFootprintCommand,
  executeFootprintCommand,
  createFootprintCommandApi,
} from './footprint-commands.js';
export {
  FOOTPRINT_HIT_TOLERANCE,
  padBounds,
  hitTestPad,
  graphicBounds,
  hitTestGraphic,
  hitTestFootprint,
  hitTestFootprintBox,
  describeFootprintEntity,
  footprintBoundsOfIds,
} from './footprint-hit-test.js';
export { createFootprintEditor } from './footprint-editor.js';
export { createFootprintSelectTool } from './footprint-tools/select-tool.js';
export { createPadTool } from './footprint-tools/pad-tool.js';
export { createMoveTool } from './footprint-tools/move-tool.js';
export { createGraphicTool } from './footprint-tools/graphic-tool.js';
