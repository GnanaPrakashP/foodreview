/**
 * Food doodle wallpaper for the memory room (Table/Chat) background.
 *
 * Shapes are stored as plain primitive data (no react-native-svg imports) so the
 * same source feeds both the in-app SVG <Pattern> tile and the preview script.
 * The layout is generated deterministically from a fixed seed: a jittered
 * hex-offset grid with random rotation and scale per doodle, plus wrap-around
 * copies for anything crossing a tile edge so the repeated tile is seamless.
 */

export type DoodlePrimitive =
  | { type: "path"; d: string }
  | { type: "circle"; cx: number; cy: number; r: number }
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number };

export type DoodleShape = {
  name: string;
  /** Bounding extent of the shape's own coordinates, used for centering. */
  width: number;
  height: number;
  /** Accent shapes render smaller so they read as filler between food icons. */
  accent?: boolean;
  primitives: DoodlePrimitive[];
};

export type DoodlePlacement = {
  shape: DoodleShape;
  transform: string;
  strokeWidth: number;
};

export const FOOD_WALLPAPER_TILE_SIZE = 364;
export const FOOD_WALLPAPER_LINE_COLOR = "#8FA4B8";
export const FOOD_WALLPAPER_OPACITY = 0.2;

const GRID_COLS = 8;
const GRID_ROWS = 8;
const CELL = FOOD_WALLPAPER_TILE_SIZE / GRID_COLS;
const BASE_ICON_SIZE = 26;
const ACCENT_ICON_SIZE = 15;
const SCALE_JITTER = 0.2; // 0.8x - 1.2x
const MAX_ROTATION = 25;
const POSITION_JITTER = 8;
const RENDERED_STROKE_WIDTH = 1.15;
const LAYOUT_SEED = 0x5eedf00d;

const p = (d: string): DoodlePrimitive => ({ type: "path", d });
const c = (cx: number, cy: number, r: number): DoodlePrimitive => ({ type: "circle", cx, cy, r });
const e = (cx: number, cy: number, rx: number, ry: number): DoodlePrimitive => ({ type: "ellipse", cx, cy, rx, ry });
const l = (x1: number, y1: number, x2: number, y2: number): DoodlePrimitive => ({ type: "line", x1, y1, x2, y2 });

export const FOOD_WALLPAPER_SHAPES: DoodleShape[] = [
  {
    name: "pizza",
    width: 42,
    height: 46,
    primitives: [
      p("M0 0l42 14-32 32z"),
      p("M7 8c9 4 20 8 31 10"),
      c(14, 15, 2),
      c(24, 19, 1.8),
      c(17, 27, 1.5)
    ]
  },
  {
    name: "burger",
    width: 42,
    height: 36,
    primitives: [
      p("M2 20h38"),
      p("M7 20c0-10 8-17 17-17s17 7 17 17"),
      p("M5 28h36"),
      p("M9 36h28"),
      p("M11 14h2"),
      p("M19 10h2"),
      p("M28 13h2")
    ]
  },
  {
    name: "fries",
    width: 42,
    height: 48,
    primitives: [
      p("M7 14h31l-5 34H12z"),
      p("M3 14h39"),
      l(13, 2, 12, 34),
      l(21, 0, 21, 35),
      l(30, 3, 33, 34)
    ]
  },
  {
    name: "coffee-cup",
    width: 40,
    height: 45,
    primitives: [
      p("M7 9h29l-5 36H12z"),
      p("M3 9h37"),
      p("M13 24c5 3 12 3 17 0"),
      p("M18 2c3-4 9-4 12 0")
    ]
  },
  {
    name: "bubble-tea",
    width: 44,
    height: 52,
    primitives: [
      p("M8 10h31l-5 42H13z"),
      p("M3 10h41"),
      l(28, 0, 22, 31),
      c(18, 42, 1.6),
      c(25, 43, 1.6),
      c(31, 39, 1.5),
      c(21, 35, 1.4)
    ]
  },
  {
    name: "donut",
    width: 36,
    height: 36,
    primitives: [
      c(18, 18, 16),
      c(18, 18, 7),
      c(10, 12, 1),
      c(26, 13, 1),
      c(12, 25, 1),
      c(25, 25, 1),
      p("M7 18c4-3 7-3 11 0s7 3 11 0")
    ]
  },
  {
    name: "ramen",
    width: 49,
    height: 46,
    primitives: [
      p("M0 27h48c-2 12-11 19-24 19S2 39 0 27z"),
      p("M7 22c9-7 25-7 34 0"),
      p("M9 31c4-3 7-3 11 0s7 3 11 0 7-3 10 0"),
      l(35, 2, 47, 25),
      l(42, 1, 49, 21)
    ]
  },
  {
    name: "taco",
    width: 52,
    height: 30,
    primitives: [
      p("M2 28c3-14 13-23 25-23s22 9 25 23z"),
      p("M5 29h45"),
      p("M12 23c4-4 8-4 12 0s8 4 12 0 7-4 10 0"),
      c(17, 17, 1.4),
      c(30, 15, 1.4),
      c(39, 19, 1.4)
    ]
  },
  {
    name: "sushi",
    width: 36,
    height: 26,
    primitives: [
      e(18, 14, 17, 11),
      e(18, 14, 8, 5),
      p("M8 25h20")
    ]
  },
  {
    name: "ice-cream",
    width: 42,
    height: 57,
    primitives: [
      p("M11 20c0-7 6-13 14-13s14 6 14 13c0 4-2 7-5 9H16c-3-2-5-5-5-9z"),
      p("M16 29l9 28 9-28z"),
      p("M19 37h12"),
      p("M21 45h8"),
      c(25, 4, 2)
    ]
  },
  {
    name: "cocktail",
    width: 44,
    height: 51,
    primitives: [
      p("M1 1h43L23 26z"),
      l(23, 26, 23, 51),
      p("M10 51h26"),
      c(36, 8, 5),
      l(36, 3, 36, 13)
    ]
  },
  {
    name: "cake",
    width: 39,
    height: 38,
    primitives: [
      p("M2 14l37-10v34H2z"),
      p("M2 14h37"),
      p("M2 25h37"),
      p("M13 9c2-5 8-5 10 0"),
      c(18, 6, 2)
    ]
  },
  {
    name: "croissant",
    width: 52,
    height: 32,
    primitives: [
      p("M2 23c5-13 18-21 32-17"),
      p("M34 6c10 3 16 10 18 21"),
      p("M2 23c10 8 38 8 50 4"),
      p("M15 14c3 6 3 11 0 17"),
      p("M30 8c3 8 3 16 0 24"),
      p("M43 15c-3 6-3 10 0 15")
    ]
  },
  {
    name: "cookie",
    width: 38,
    height: 44,
    primitives: [
      p("M30 12c4 3 7 8 7 14 0 10-8 18-18 18S1 36 1 26 9 8 19 8c3 0 5 1 7 2"),
      p("M29 6c-3 3-2 8 3 9"),
      c(13, 20, 1.5),
      c(22, 18, 1.4),
      c(16, 31, 1.5),
      c(27, 29, 1.3)
    ]
  },
  {
    name: "fried-egg",
    width: 41,
    height: 41,
    primitives: [
      p("M2 21c0-9 8-16 17-16 7 0 12 4 14 10 5 1 8 5 8 10 0 9-9 16-21 16S2 33 2 21z"),
      c(22, 23, 6)
    ]
  },
  {
    name: "hotdog",
    width: 48,
    height: 38,
    primitives: [
      p("M3 14c3-6 9-9 21-9s18 3 21 9"),
      p("M3 24c3 6 9 9 21 9s18-3 21-9"),
      p("M1 19h46"),
      p("M12 23l4-7 4 7 4-7 4 7 4-7")
    ]
  },
  {
    name: "soda-glass",
    width: 34,
    height: 40,
    primitives: [
      p("M4 6h28l-3 34H7z"),
      p("M7 13h22"),
      l(26, 0, 20, 13),
      c(13, 22, 1.3),
      c(19, 28, 1.3),
      c(22, 19, 1.2)
    ]
  },
  {
    name: "wine-glass",
    width: 30,
    height: 36,
    primitives: [
      p("M3 2h24c0 12-5 18-12 18S3 14 3 2z"),
      l(15, 20, 15, 34),
      p("M7 34h16"),
      p("M5 9h20")
    ]
  },
  {
    name: "beer-mug",
    width: 37,
    height: 37,
    primitives: [
      p("M6 9h24l-2 28H8z"),
      p("M4 9c-1-5 5-8 8-5 2-3 8-3 10 0 4-3 10 1 7 5"),
      p("M30 14c5 0 7 3 7 6s-2 6-7 6"),
      l(13, 15, 12, 32),
      l(22, 15, 22, 32)
    ]
  },
  {
    name: "teacup",
    width: 37,
    height: 32,
    primitives: [
      p("M4 14h28c0 9-6 15-14 15S4 23 4 14z"),
      p("M32 16c5 0 5 8 0 8"),
      p("M1 32h34"),
      p("M14 2c-2 3 2 5 0 8"),
      p("M22 2c-2 3 2 5 0 8")
    ]
  },
  {
    name: "apple",
    width: 36,
    height: 42,
    primitives: [
      p("M9 12c-5 3-8 9-8 14 0 9 6 16 13 16 2 0 3-1 4-1s2 1 4 1c7 0 13-7 13-16 0-5-3-11-8-14-3-2-6-1-9 1-3-2-6-3-9-1z"),
      p("M18 12c0-4 1-7 3-9"),
      p("M21 7c4-3 8-3 10 0-3 3-7 3-10 0z")
    ]
  },
  {
    name: "banana",
    width: 34,
    height: 38,
    primitives: [
      p("M3 6c2 14 10 24 26 28 3 1 5-1 4-4-14-3-22-11-25-25-1-3-4-3-5 1z"),
      p("M8 9c3 11 10 18 20 21")
    ]
  },
  {
    name: "strawberry",
    width: 30,
    height: 38,
    primitives: [
      p("M16 8C8 8 2 13 2 20c0 9 8 16 14 18 6-2 14-9 14-18 0-7-6-12-14-12z"),
      p("M10 8l3-5 3 4 3-4 3 5"),
      c(10, 18, 1),
      c(20, 16, 1),
      c(15, 25, 1),
      c(23, 24, 1)
    ]
  },
  {
    name: "watermelon",
    width: 48,
    height: 28,
    primitives: [
      p("M2 4h44c0 14-10 24-22 24S2 18 2 4z"),
      p("M7 4c0 11 8 19 17 19s17-8 17-19"),
      c(16, 12, 1),
      c(24, 16, 1),
      c(30, 10, 1)
    ]
  },
  {
    name: "avocado",
    width: 30,
    height: 42,
    primitives: [
      p("M16 2c-4 8-14 12-14 24 0 9 6 16 14 16s14-7 14-16C30 14 20 10 16 2z"),
      c(16, 29, 6)
    ]
  },
  {
    name: "carrot",
    width: 30,
    height: 46,
    primitives: [
      p("M8 13l22-3-13 36z"),
      p("M12 20l12-2"),
      p("M14 28l8-1"),
      l(18, 10, 14, 1),
      l(21, 10, 22, 0),
      l(24, 10, 29, 2)
    ]
  },
  {
    name: "chili",
    width: 36,
    height: 40,
    primitives: [
      p("M6 10c-2 10 2 22 12 28 8 5 16 2 18-4-8 2-16-1-20-9-3-6-4-10-3-15"),
      p("M11 10c0-5 3-8 8-8"),
      p("M6 10c2-2 6-2 9 0")
    ]
  },
  {
    name: "cherries",
    width: 32,
    height: 36,
    primitives: [
      p("M16 2c-6 8-9 16-9 24"),
      p("M16 2c6 8 9 16 9 24"),
      c(7, 30, 6),
      c(25, 30, 6),
      p("M16 2c5-2 9-1 11 2-4 2-8 1-11-2z")
    ]
  },
  {
    name: "lemon-slice",
    width: 36,
    height: 36,
    primitives: [
      c(18, 18, 16),
      c(18, 18, 12),
      l(18, 18, 18, 7),
      l(18, 18, 28, 12),
      l(18, 18, 29, 23),
      l(18, 18, 18, 29),
      l(18, 18, 8, 24),
      l(18, 18, 7, 13)
    ]
  },
  {
    name: "cupcake",
    width: 34,
    height: 36,
    primitives: [
      p("M5 22h26l-3 14H8z"),
      l(13, 23, 12, 36),
      l(23, 23, 24, 36),
      p("M5 22c-2-7 4-11 8-8 1-5 9-6 11-1 5-2 9 3 7 9"),
      c(18, 7, 2)
    ]
  },
  {
    name: "pancakes",
    width: 44,
    height: 24,
    primitives: [
      e(22, 10, 20, 6),
      p("M2 10c0 4 9 7 20 7s20-3 20-7"),
      p("M2 16c0 4 9 7 20 7s20-3 20-7"),
      p("M18 2h9v4h-9z")
    ]
  },
  {
    name: "sandwich",
    width: 46,
    height: 30,
    primitives: [
      p("M2 12l21-9 21 9-21 9z"),
      p("M2 12v6l21 9 21-9v-6"),
      p("M6 16l17 8 17-8")
    ]
  },
  {
    name: "fork-knife",
    width: 32,
    height: 40,
    primitives: [
      p("M4 2v10"),
      p("M9 2v10"),
      p("M14 2v10"),
      p("M4 12c0 5 10 5 10 0"),
      l(9, 17, 9, 40),
      p("M27 2c-5 5-5 13 0 17"),
      l(27, 2, 27, 40)
    ]
  },
  {
    name: "chef-hat",
    width: 44,
    height: 32,
    primitives: [
      p("M9 20c-5 0-7-4-5-8 2-3 5-4 8-3 1-5 7-7 11-4 4-3 10-1 11 4 3-1 6 0 8 3 2 4 0 8-5 8"),
      p("M9 20v12h26V20"),
      p("M9 26h26")
    ]
  },
  {
    name: "popsicle",
    width: 30,
    height: 40,
    primitives: [
      p("M3 30V13C3 6 9 1 16 1s13 5 13 12v17z"),
      l(16, 30, 16, 40),
      l(11, 8, 11, 26),
      l(21, 8, 21, 26)
    ]
  },
  {
    name: "popcorn",
    width: 34,
    height: 38,
    primitives: [
      p("M6 16h24l-3 22H9z"),
      l(13, 16, 12, 38),
      l(23, 16, 24, 38),
      c(9, 12, 4),
      c(18, 9, 5),
      c(27, 12, 4)
    ]
  },
  {
    name: "dumpling",
    width: 46,
    height: 30,
    primitives: [
      p("M2 26c2-12 12-20 22-20s20 8 22 20c-14 4-30 4-44 0z"),
      p("M16 9c1 4 1 7 0 10"),
      l(24, 6, 24, 20),
      p("M32 9c-1 4-1 7 0 10")
    ]
  },
  {
    name: "cheese",
    width: 44,
    height: 32,
    primitives: [
      p("M2 30c13-10 26-17 40-20v20z"),
      p("M2 30h40"),
      c(16, 25, 2.5),
      c(27, 21, 2),
      c(34, 26, 1.8)
    ]
  },
  {
    name: "pie-slice",
    width: 46,
    height: 36,
    primitives: [
      p("M2 8c14-8 28-8 42 0L23 36z"),
      p("M6 10c12-6 22-6 32 0"),
      c(23, 18, 1.2)
    ]
  },
  {
    name: "grapes",
    width: 34,
    height: 44,
    primitives: [
      l(17, 9, 17, 2),
      p("M17 4c4-3 8-2 10 1-3 2-7 2-10-1z"),
      c(12, 14, 5),
      c(22, 14, 5),
      c(7, 23, 5),
      c(17, 23, 5),
      c(27, 23, 5),
      c(12, 32, 5),
      c(22, 32, 5),
      c(17, 39, 4.5)
    ]
  },
  {
    name: "milkshake",
    width: 38,
    height: 44,
    primitives: [
      p("M6 14h26l-4 30H10z"),
      p("M6 14c-3-6 3-10 7-7 1-4 8-5 10-1 4-3 10 1 7 8"),
      l(27, 0, 22, 10),
      p("M13 26c4 2 8 2 12 0")
    ]
  },
  {
    name: "leaf",
    width: 28,
    height: 20,
    accent: true,
    primitives: [
      p("M0 10c8-8 20-8 28 0-8 8-20 8-28 0z"),
      p("M3 10h22")
    ]
  },
  {
    name: "sparkle",
    width: 20,
    height: 20,
    accent: true,
    primitives: [p("M10 0l3 7 7 3-7 3-3 7-3-7-7-3 7-3z")]
  },
  {
    name: "heart",
    width: 24,
    height: 22,
    accent: true,
    primitives: [
      p("M12 21C5 15 1 11 1 6c0-3 2-5 5-5 3 0 5 2 6 4 1-2 3-4 6-4 3 0 5 2 5 5 0 5-4 9-11 15z")
    ]
  }
];

/** Tiny marks sprinkled between the food icons so gaps read as texture. */
const FILLER_MARKS: DoodleShape[] = [
  { name: "dot", width: 3, height: 3, primitives: [c(1.5, 1.5, 1.3)] },
  {
    name: "plus",
    width: 8,
    height: 8,
    primitives: [l(4, 0, 4, 8), l(0, 4, 8, 4)]
  },
  { name: "squiggle", width: 9, height: 4, primitives: [p("M0 3c2-2 5-2 7 0")] },
  {
    name: "cross",
    width: 7,
    height: 7,
    primitives: [l(0, 0, 7, 7), l(7, 0, 0, 7)]
  },
  { name: "three-dots", width: 12, height: 3, primitives: [c(1.5, 1.5, 1.2), c(6, 1.5, 1.2), c(10.5, 1.5, 1.2)] }
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const round = (value: number) => Math.round(value * 100) / 100;

export function buildFoodWallpaperPlacements(): DoodlePlacement[] {
  const tile = FOOD_WALLPAPER_TILE_SIZE;
  const rand = mulberry32(LAYOUT_SEED);
  const placements: DoodlePlacement[] = [];

  // Anything crossing a tile edge gets wrapped copies on the opposite side so
  // the repeated tile is seamless.
  const addPlacement = (shape: DoodleShape, rawX: number, rawY: number, rotation: number, scale: number) => {
    const cx = ((rawX % tile) + tile) % tile;
    const cy = ((rawY % tile) + tile) % tile;
    const radius = (Math.hypot(shape.width, shape.height) / 2) * scale;
    const xOffsets = [0];
    if (cx - radius < 0) xOffsets.push(tile);
    if (cx + radius > tile) xOffsets.push(-tile);
    const yOffsets = [0];
    if (cy - radius < 0) yOffsets.push(tile);
    if (cy + radius > tile) yOffsets.push(-tile);

    const strokeWidth = round(RENDERED_STROKE_WIDTH / scale);
    for (const dx of xOffsets) {
      for (const dy of yOffsets) {
        placements.push({
          shape,
          strokeWidth,
          transform: `translate(${round(cx + dx)} ${round(cy + dy)}) rotate(${round(rotation)}) scale(${round(scale)}) translate(${round(-shape.width / 2)} ${round(-shape.height / 2)})`
        });
      }
    }
  };

  let deck: DoodleShape[] = [];
  const nextShape = () => {
    if (deck.length === 0) deck = shuffled(FOOD_WALLPAPER_SHAPES, rand);
    return deck.pop() as DoodleShape;
  };

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const shape = nextShape();
      const targetSize = (shape.accent ? ACCENT_ICON_SIZE : BASE_ICON_SIZE) * (1 - SCALE_JITTER + rand() * SCALE_JITTER * 2);
      // Size by area rather than longest side so elongated shapes (pancakes,
      // sandwich) carry similar visual weight to square ones.
      const scale = targetSize / Math.sqrt(shape.width * shape.height);
      const rotation = -MAX_ROTATION + rand() * MAX_ROTATION * 2;
      const hexOffset = row % 2 === 1 ? CELL / 2 : 0;
      const rawX = (col + 0.5) * CELL + hexOffset + (rand() * 2 - 1) * POSITION_JITTER;
      const rawY = (row + 0.5) * CELL + (rand() * 2 - 1) * POSITION_JITTER;
      addPlacement(shape, rawX, rawY, rotation, scale);
    }
  }

  // Second pass: tiny marks at cell corners (the farthest points from the icon
  // centers) so the space between icons still reads as texture.
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const mark = FILLER_MARKS[Math.floor(rand() * FILLER_MARKS.length)];
      const scale = 0.85 + rand() * 0.45;
      const rotation = -45 + rand() * 90;
      const rawX = col * CELL + (row % 2 === 1 ? CELL / 2 : 0) + (rand() * 2 - 1) * 5;
      const rawY = row * CELL + (rand() * 2 - 1) * 5;
      addPlacement(mark, rawX, rawY, rotation, scale);
    }
  }

  return placements;
}
