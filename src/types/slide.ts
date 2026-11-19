export const SLIDE_WIDTH = 960;
export const SLIDE_HEIGHT = 540;

export type ShapeKind =
  | 'rect'
  | 'roundedRect'
  | 'ellipse'
  | 'triangle'
  | 'arrowRight'
  | 'line';

export type TextAlign = 'left' | 'center' | 'right';

export interface BaseElement {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  opacity?: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  bold?: boolean;
  italic?: boolean;
  align: TextAlign;
  backgroundColor?: string;
  borderRadius?: number;
  padding?: number;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shapeKind: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text?: string;
  textColor?: string;
  fontSize?: number;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
  alt?: string;
  borderRadius?: number;
}

export interface TableElement extends BaseElement {
  type: 'table';
  rows: string[][];
  headerBg: string;
  cellBg: string;
  borderColor: string;
  textColor: string;
  fontSize: number;
}

export type SlideElement =
  | TextElement
  | ShapeElement
  | ImageElement
  | TableElement;

export interface InkPoint {
  x: number;
  y: number;
  pressure: number;
}

export interface InkStroke {
  id: string;
  points: InkPoint[];
  color: string;
  width: number;
  tool: 'pen' | 'highlighter';
}

export type SlidePattern = 'none' | 'grid' | 'dots' | 'lined';

export interface SlideBackground {
  color: string;
  gradient?: string;
  pattern?: SlidePattern;
}

export interface Slide {
  id: string;
  title: string;
  background: SlideBackground;
  elements: SlideElement[];
  strokes: InkStroke[];
  notes?: string;
}

export interface DeckDocument {
  id: string;
  title: string;
  updatedAt: number;
  slides: Slide[];
}

export type EditorTool =
  | 'select'
  | 'text'
  | 'rect'
  | 'roundedRect'
  | 'ellipse'
  | 'triangle'
  | 'arrowRight'
  | 'table'
  | 'pen'
  | 'highlighter'
  | 'eraser';

export type AiRequestMode = 'design' | 'feedback';

export type AiStreamStatus =
  | 'idle'
  | 'connecting'
  | 'retrying'
  | 'fallback'
  | 'streaming'
  | 'done'
  | 'error'
  | 'cancelled';

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  mode: AiRequestMode;
  content: string;
  appliedDesign?: boolean;
  modelUsed?: string;
  createdAt: number;
}

export type AiProvider = 'google' | 'openai' | 'anthropic';

export interface AiModelOption {
  id: string;
  provider: AiProvider;
  label: string;
  description: string;
  tokenBadge: string;
}
