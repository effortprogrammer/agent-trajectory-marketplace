export const DESIGN_MODE_PROTOCOL = "higgsfield.supercomputer.design-mode";
export const DESIGN_MODE_PROTOCOL_VERSION = 1;

export type DesignModeSetMessage = {
  protocol: typeof DESIGN_MODE_PROTOCOL;
  version: typeof DESIGN_MODE_PROTOCOL_VERSION;
  type: "HF_DESIGN_MODE_SET";
  sessionId: string;
  appId?: string;
  enabled: boolean;
};

export type DesignModePreviewCropMessage = {
  protocol: typeof DESIGN_MODE_PROTOCOL;
  version: typeof DESIGN_MODE_PROTOCOL_VERSION;
  type: "HF_DESIGN_PREVIEW_CROP_SET";
  sessionId: string;
  appId?: string;
  selection: DesignSelectionContext;
};

export type DesignSelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesignSelectionPoint = {
  x: number;
  y: number;
};

export type DesignSelectionModifiers = {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

export type DesignSelectionElement = {
  nodeId?: string;
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  sourceColumn?: number;
  exportName?: string;
  routeFile?: string;
  tagName: string;
  role?: string;
  ariaLabel?: string;
  textSnippet?: string;
  classList?: string[];
  attributes?: Record<string, string>;
  computedStyle?: Record<string, string>;
};

export type DesignSelectionContext = {
  protocol: typeof DESIGN_MODE_PROTOCOL;
  version: typeof DESIGN_MODE_PROTOCOL_VERSION;
  sessionId: string;
  appId?: string;
  previewOrigin?: string;
  route?: string;
  path?: string;
  timestamp: number;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
  pointer?: DesignSelectionPoint;
  rect: DesignSelectionRect;
  element: DesignSelectionElement;
  ancestors: DesignSelectionElement[];
  source: "instrumented" | "heuristic";
};
