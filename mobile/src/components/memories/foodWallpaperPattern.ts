/**
 * Food doodle wallpaper for the memory room (Table/Chat) background.
 *
 * Shapes are stored as plain primitive data (no react-native-svg imports) so the
 * same source feeds both the in-app SVG <Pattern> tile and the preview script.
 *
 * The layout is generated deterministically from a fixed seed:
 *  1. deal size tiers to grid cells from an exact quota, biggest first;
 *  2. pick a shape each tier can carry legibly, and a rotation the shape can
 *     survive (a wine glass tilts, a donut spins freely);
 *  3. push overlapping doodles apart on the torus, then drop filler marks into
 *     whatever gaps are left;
 *  4. emit wrap-around copies for anything crossing a tile edge so the repeated
 *     tile stays seamless.
 *
 * Sizes span ~3.5x on purpose — a wallpaper of same-size icons reads as an icon
 * sheet rather than a doodle pattern.
 */

type PrimitiveGeometry =
  | { type: "path"; d: string }
  | { type: "circle"; cx: number; cy: number; r: number }
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number };

export type DoodlePrimitive = PrimitiveGeometry & {
  /**
   * Decoration rather than structure — sesame seeds, sprinkles, boba, the seeds
   * in a watermelon. Dropped below DETAIL_MIN_SIZE, where these strokes stop
   * being legible and just silt the shape up. Never tag anything that carries
   * the silhouette.
   */
  detail?: boolean;
};

/**
 * How far a doodle may rotate before it stops reading as itself.
 * - `free`: no "up" at all (donut, lemon slice, croissant) — any angle works.
 * - `upright`: things that pour or stack (glasses, cones, cakes) — a small tilt
 *   only, otherwise they look spilled.
 * Anything unannotated gets a moderate tilt.
 */
export type RotationClass = "free" | "upright";

export type DoodleShape = {
  name: string;
  /** Bounding extent of the shape's own coordinates, used for centering. */
  width: number;
  height: number;
  /** Accent shapes stay in the small tiers so they read as filler, not subject. */
  accent?: boolean;
  rotation?: RotationClass;
  primitives: DoodlePrimitive[];
};

export type DoodlePlacement = {
  shape: DoodleShape;
  /**
   * The primitives to actually draw — `shape.primitives` minus any detail
   * strokes dropped because this placement renders small. Always draw these
   * rather than reaching through to `shape.primitives`.
   */
  primitives: DoodlePrimitive[];
  transform: string;
  strokeWidth: number;
};

/**
 * Tile edge in dp. At the old 364 the pattern repeated roughly once per phone
 * width, so the same arrangement was on screen two or three times at once. 728 is
 * wider than any phone, which is what actually hides the repeat — the doodles
 * themselves stay the same size, there are simply four times as many per tile.
 */
export const FOOD_WALLPAPER_TILE_SIZE = 728;
export const FOOD_WALLPAPER_LINE_COLOR = "#D7CAB9";
/**
 * Keep in step with BAKED_LINE_OPACITY in scripts/generateFoodWallpaperTile.mjs
 * and tokens.wallpaperOpacity — this one only drives the preview scripts, so when
 * it drifts the previews quietly stop matching the shipped tile.
 */
export const FOOD_WALLPAPER_OPACITY = 0.22;

/**
 * How many of each thing to fit into a tile. These are targets, not guarantees —
 * the packer drops anything it cannot place without crowding.
 */
const FOOD_DOODLE_COUNT = 208;
const FILLER_MARK_COUNT = 256;
const LAYOUT_SEED = 0x5eedf00d;

/**
 * Size tiers, sampled per placement rather than fixed per shape — the same
 * croissant can be a hero in one spot and filler in another. The ~3.5x spread
 * between the smallest and largest tier is what stops the pattern reading as a
 * sheet of same-size icons.
 */
type SizeTier = { name: string; min: number; max: number; weight: number };
const SIZE_TIERS: SizeTier[] = [
  { name: "hero", min: 46, max: 58, weight: 0.1 },
  { name: "large", min: 34, max: 44, weight: 0.2 },
  { name: "mid", min: 24, max: 32, weight: 0.34 },
  { name: "small", min: 16, max: 24, weight: 0.36 }
];
/**
 * Tiers an `accent` shape may take. A leaf or a heart is punctuation between the
 * food, so it stays small — blown up to hero size it reads as the subject.
 */
const ACCENT_TIERS = new Set(["mid", "small"]);

const ROTATION_LIMITS: Record<"free" | "moderate" | "upright", number> = {
  free: 180,
  moderate: 45,
  upright: 18
};

/**
 * Busy shapes turn to mush when they are small, so each one carries a floor
 * derived from how many primitives it draws: a 3-primitive sushi survives at
 * 16px, a 10-primitive bunch of grapes does not. Keep the slope gentle — the
 * small tier holds most of the doodles, and a steep floor starves it down to a
 * handful of shapes that then visibly repeat.
 */
const MIN_SIZE_BASE = 14;
const MIN_SIZE_PER_PRIMITIVE = 1.8;
const MIN_SIZE_CEILING = 36;
/**
 * Below this rendered size a doodle drops its `detail` primitives. Set just above
 * the small tier's ceiling so a tier renders consistently: small is always the
 * simplified drawing, mid and up always the full one. Doodles the packer shrinks
 * into this range simplify too, which is the point of keying off size rather than
 * off tier name.
 */
const DETAIL_MIN_SIZE = 25;

/**
 * Optical weight correction — see opticalWeightScale. 0 disables it; 1 would let
 * ink density fully dictate size, overriding the tier the doodle was dealt.
 * Measured across a sweep: 0.7 minimises the spread in per-doodle ink density
 * (CV 0.294 uncorrected -> 0.259), and past that the tiers start to blur without
 * getting any more uniform.
 *
 * The clamp caps how far a shape can move from its tier size. Loosening it beyond
 * 0.18 does not improve uniformity — the residual spread is from the legibility
 * floor and the packer's shrink-to-fit, neither of which more size can fix — it
 * only adds ink.
 */
// Annotated as `number` so the `=== 0` disable check below stays legal — a bare
// literal narrows to `0.7` and TS rejects the comparison.
const OPTICAL_WEIGHT_STRENGTH: number = 0.7;
const OPTICAL_WEIGHT_CLAMP = 0.18;

/**
 * Rendered stroke stays near-constant regardless of doodle size (WhatsApp does
 * the same), with a slight ramp so heroes don't read as thin wireframes next to
 * the small tiers. Flatten to a constant by setting the ramp to 0.
 */
const STROKE_WIDTH_BASE = 1.1;
const STROKE_WIDTH_RAMP = 0.006;

/** Separation pass: how much of a doodle's own footprint must stay clear. */
const RELAX_ITERATIONS = 14;
const RELAX_RADIUS_FACTOR = 0.45; // effective radius = size * this
const RELAX_GAP = 2;

/**
 * Best-candidate (Mitchell) packing: for each doodle, throw this many darts at
 * the tile and keep the one furthest from everything already placed. That yields
 * blue noise — evenly covered but with no repeating positions — which is the
 * thing a jittered grid cannot give you. Jitter smaller than the cell always
 * leaves the lattice legible, and jitter as large as the cell just clumps.
 */
const PACK_CANDIDATES = 48;
/** Clear space required between two doodle footprints. */
const PACK_GAP = 2.5;
/** A doodle may shrink by up to this fraction to fit a gap before being dropped. */
const PACK_MAX_SHRINK = 0.22;
/**
 * Two copies of the same doodle close together read as a repeat even when the
 * layout around them is irregular, so candidates that keep their distance from a
 * twin win over candidates that are merely in a bigger gap. Sized against the
 * phone rather than the tile: the point is that twins never share a screen.
 */
const SAME_SHAPE_MIN_DISTANCE = 200;

const p = (d: string): DoodlePrimitive => ({ type: "path", d });
const c = (cx: number, cy: number, r: number): DoodlePrimitive => ({ type: "circle", cx, cy, r });
const e = (cx: number, cy: number, rx: number, ry: number): DoodlePrimitive => ({ type: "ellipse", cx, cy, rx, ry });
const l = (x1: number, y1: number, x2: number, y2: number): DoodlePrimitive => ({ type: "line", x1, y1, x2, y2 });
/** Marks a primitive as decoration; see DoodlePrimitive.detail. */
const d = (primitive: DoodlePrimitive): DoodlePrimitive => ({ ...primitive, detail: true });

export const FOOD_WALLPAPER_SHAPES: DoodleShape[] = [
  {
    name: "pizza",
    width: 42,
    height: 46,
    rotation: "free",
    primitives: [
      p("M0 0l42 14-32 32z"),
      p("M7 8c9 4 20 8 31 10"),
      d(c(14, 15, 2)),
      d(c(24, 19, 1.8)),
      c(17, 27, 1.5)
    ]
  },
  {
    name: "burger",
    width: 42,
    height: 36,
    rotation: "upright",
    primitives: [
      p("M2 20h38"),
      p("M7 20c0-10 8-17 17-17s17 7 17 17"),
      p("M5 28h36"),
      p("M9 36h28"),
      d(p("M11 14h2")),
      d(p("M19 10h2")),
      d(p("M28 13h2"))
    ]
  },
  {
    name: "fries",
    width: 42,
    height: 48,
    rotation: "upright",
    primitives: [
      p("M7 14h31l-5 34H12z"),
      p("M3 14h39"),
      l(13, 2, 12, 34),
      l(21, 0, 21, 35),
      d(l(30, 3, 33, 34))
    ]
  },
  {
    name: "coffee-cup",
    width: 40,
    height: 45,
    rotation: "upright",
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
    rotation: "upright",
    primitives: [
      p("M8 10h31l-5 42H13z"),
      p("M3 10h41"),
      l(28, 0, 22, 31),
      c(18, 42, 1.6),
      c(25, 43, 1.6),
      d(c(31, 39, 1.5)),
      d(c(21, 35, 1.4))
    ]
  },
  {
    name: "donut",
    width: 36,
    height: 36,
    rotation: "free",
    primitives: [
      c(18, 18, 16),
      c(18, 18, 7),
      d(c(10, 12, 1)),
      d(c(26, 13, 1)),
      d(c(12, 25, 1)),
      d(c(25, 25, 1)),
      p("M7 18c4-3 7-3 11 0s7 3 11 0")
    ]
  },
  {
    name: "ramen",
    width: 49,
    height: 46,
    rotation: "upright",
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
    rotation: "upright",
    primitives: [
      p("M2 28c3-14 13-23 25-23s22 9 25 23z"),
      p("M5 29h45"),
      p("M12 23c4-4 8-4 12 0s8 4 12 0 7-4 10 0"),
      d(c(17, 17, 1.4)),
      d(c(30, 15, 1.4)),
      d(c(39, 19, 1.4))
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
    rotation: "upright",
    primitives: [
      p("M11 20c0-7 6-13 14-13s14 6 14 13c0 4-2 7-5 9H16c-3-2-5-5-5-9z"),
      p("M16 29l9 28 9-28z"),
      d(p("M19 37h12")),
      d(p("M21 45h8")),
      c(25, 4, 2)
    ]
  },
  {
    name: "cocktail",
    width: 44,
    height: 51,
    rotation: "upright",
    primitives: [
      p("M1 1h43L23 26z"),
      l(23, 26, 23, 51),
      p("M10 51h26"),
      d(c(36, 8, 5)),
      d(l(36, 3, 36, 13))
    ]
  },
  {
    name: "cake",
    width: 39,
    height: 38,
    rotation: "upright",
    primitives: [
      p("M2 14l37-10v34H2z"),
      p("M2 14h37"),
      p("M2 25h37"),
      d(p("M13 9c2-5 8-5 10 0")),
      d(c(18, 6, 2))
    ]
  },
  {
    name: "croissant",
    width: 52,
    height: 32,
    rotation: "free",
    primitives: [
      p("M2 23c5-13 18-21 32-17"),
      p("M34 6c10 3 16 10 18 21"),
      p("M2 23c10 8 38 8 50 4"),
      p("M15 14c3 6 3 11 0 17"),
      d(p("M30 8c3 8 3 16 0 24")),
      d(p("M43 15c-3 6-3 10 0 15"))
    ]
  },
  {
    name: "cookie",
    width: 38,
    height: 44,
    rotation: "free",
    primitives: [
      p("M30 12c4 3 7 8 7 14 0 10-8 18-18 18S1 36 1 26 9 8 19 8c3 0 5 1 7 2"),
      p("M29 6c-3 3-2 8 3 9"),
      c(13, 20, 1.5),
      d(c(22, 18, 1.4)),
      d(c(16, 31, 1.5)),
      c(27, 29, 1.3)
    ]
  },
  {
    name: "fried-egg",
    width: 41,
    height: 41,
    rotation: "free",
    primitives: [
      p("M2 21c0-9 8-16 17-16 7 0 12 4 14 10 5 1 8 5 8 10 0 9-9 16-21 16S2 33 2 21z"),
      c(22, 23, 6)
    ]
  },
  {
    name: "hotdog",
    width: 48,
    height: 38,
    rotation: "free",
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
    rotation: "upright",
    primitives: [
      p("M4 6h28l-3 34H7z"),
      p("M7 13h22"),
      l(26, 0, 20, 13),
      d(c(13, 22, 1.3)),
      d(c(19, 28, 1.3)),
      d(c(22, 19, 1.2))
    ]
  },
  {
    name: "wine-glass",
    width: 30,
    height: 36,
    rotation: "upright",
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
    rotation: "upright",
    primitives: [
      p("M6 9h24l-2 28H8z"),
      p("M4 9c-1-5 5-8 8-5 2-3 8-3 10 0 4-3 10 1 7 5"),
      p("M30 14c5 0 7 3 7 6s-2 6-7 6"),
      d(l(13, 15, 12, 32)),
      d(l(22, 15, 22, 32))
    ]
  },
  {
    name: "teacup",
    width: 37,
    height: 32,
    rotation: "upright",
    primitives: [
      p("M4 14h28c0 9-6 15-14 15S4 23 4 14z"),
      p("M32 16c5 0 5 8 0 8"),
      p("M1 32h34"),
      p("M14 2c-2 3 2 5 0 8"),
      d(p("M22 2c-2 3 2 5 0 8"))
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
    rotation: "free",
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
      d(c(10, 18, 1)),
      d(c(20, 16, 1)),
      d(c(15, 25, 1)),
      d(c(23, 24, 1))
    ]
  },
  {
    name: "watermelon",
    width: 48,
    height: 28,
    rotation: "free",
    primitives: [
      p("M2 4h44c0 14-10 24-22 24S2 18 2 4z"),
      p("M7 4c0 11 8 19 17 19s17-8 17-19"),
      d(c(16, 12, 1)),
      d(c(24, 16, 1)),
      d(c(30, 10, 1))
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
    rotation: "free",
    primitives: [
      p("M8 13l22-3-13 36z"),
      d(p("M12 20l12-2")),
      d(p("M14 28l8-1")),
      l(18, 10, 14, 1),
      l(21, 10, 22, 0),
      l(24, 10, 29, 2)
    ]
  },
  {
    name: "chili",
    width: 36,
    height: 40,
    rotation: "free",
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
    rotation: "upright",
    primitives: [
      p("M16 2c-6 8-9 16-9 24"),
      p("M16 2c6 8 9 16 9 24"),
      c(7, 30, 6),
      c(25, 30, 6),
      d(p("M16 2c5-2 9-1 11 2-4 2-8 1-11-2z"))
    ]
  },
  {
    name: "lemon-slice",
    width: 36,
    height: 36,
    rotation: "free",
    primitives: [
      c(18, 18, 16),
      c(18, 18, 12),
      // Drop every other spoke so the three that remain stay evenly spaced —
      // dropping three adjacent ones leaves something that reads as a pie chart.
      l(18, 18, 18, 7),
      d(l(18, 18, 28, 12)),
      l(18, 18, 29, 23),
      d(l(18, 18, 18, 29)),
      l(18, 18, 8, 24),
      d(l(18, 18, 7, 13))
    ]
  },
  {
    name: "cupcake",
    width: 34,
    height: 36,
    rotation: "upright",
    primitives: [
      p("M5 22h26l-3 14H8z"),
      d(l(13, 23, 12, 36)),
      d(l(23, 23, 24, 36)),
      p("M5 22c-2-7 4-11 8-8 1-5 9-6 11-1 5-2 9 3 7 9"),
      c(18, 7, 2)
    ]
  },
  {
    name: "pancakes",
    width: 44,
    height: 24,
    rotation: "upright",
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
      // Two tines is still a fork; one is a spoon, so only the middle one goes.
      d(p("M9 2v10")),
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
    rotation: "upright",
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
    rotation: "upright",
    primitives: [
      p("M3 30V13C3 6 9 1 16 1s13 5 13 12v17z"),
      l(16, 30, 16, 40),
      d(l(11, 8, 11, 26)),
      d(l(21, 8, 21, 26))
    ]
  },
  {
    name: "popcorn",
    width: 34,
    height: 38,
    rotation: "upright",
    primitives: [
      p("M6 16h24l-3 22H9z"),
      d(l(13, 16, 12, 38)),
      d(l(23, 16, 24, 38)),
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
      d(p("M32 9c-1 4-1 7 0 10"))
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
      d(c(27, 21, 2)),
      d(c(34, 26, 1.8))
    ]
  },
  {
    name: "pie-slice",
    width: 46,
    height: 36,
    rotation: "free",
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
    rotation: "upright",
    primitives: [
      l(17, 9, 17, 2),
      p("M17 4c4-3 8-2 10 1-3 2-7 2-10-1z"),
      c(12, 14, 5),
      c(22, 14, 5),
      c(7, 23, 5),
      c(17, 23, 5),
      d(c(27, 23, 5)),
      d(c(12, 32, 5)),
      d(c(22, 32, 5)),
      d(c(17, 39, 4.5))
    ]
  },
  {
    name: "milkshake",
    width: 38,
    height: 44,
    rotation: "upright",
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
    rotation: "free",
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
    rotation: "free",
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

/** Chord-sampled length of a cubic bezier; 16 steps is well inside a rounding error here. */
function cubicLength(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number
): number {
  const steps = 16;
  let length = 0;
  let px = x0;
  let py = y0;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const u = 1 - t;
    const bx = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
    const by = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
    length += Math.hypot(bx - px, by - py);
    px = bx;
    py = by;
  }
  return length;
}

/**
 * Drawn length of a path's `d` string. Only the commands these doodles actually
 * use are handled — M/L/H/V/C/S/Z and their relative forms. No arcs, no
 * quadratics; add them here if a future shape needs them.
 */
function pathLength(data: string): number {
  const tokens: (string | number)[] = [];
  for (const match of data.matchAll(/([a-zA-Z])|(-?(?:\d*\.\d+|\d+))/g)) {
    tokens.push(match[1] ?? Number(match[2]));
  }
  let index = 0;
  let total = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let ctrlX = 0;
  let ctrlY = 0;
  let command = "";
  const next = () => tokens[index++] as number;
  while (index < tokens.length) {
    if (typeof tokens[index] === "string") command = tokens[index++] as string;
    const relative = command === command.toLowerCase();
    const kind = command.toUpperCase();
    if (kind === "M") {
      x = relative ? x + next() : next();
      y = relative ? y + next() : next();
      startX = x;
      startY = y;
      // Extra coordinate pairs after a moveto are implicit linetos.
      command = relative ? "l" : "L";
    } else if (kind === "L") {
      const nx = relative ? x + next() : next();
      const ny = relative ? y + next() : next();
      total += Math.hypot(nx - x, ny - y);
      x = nx;
      y = ny;
    } else if (kind === "H") {
      const nx = relative ? x + next() : next();
      total += Math.abs(nx - x);
      x = nx;
    } else if (kind === "V") {
      const ny = relative ? y + next() : next();
      total += Math.abs(ny - y);
      y = ny;
    } else if (kind === "C" || kind === "S") {
      // A smooth curve reflects the previous curve's second control point.
      const c1x = kind === "C" ? (relative ? x + next() : next()) : 2 * x - ctrlX;
      const c1y = kind === "C" ? (relative ? y + next() : next()) : 2 * y - ctrlY;
      const c2x = relative ? x + next() : next();
      const c2y = relative ? y + next() : next();
      const nx = relative ? x + next() : next();
      const ny = relative ? y + next() : next();
      total += cubicLength(x, y, c1x, c1y, c2x, c2y, nx, ny);
      ctrlX = c2x;
      ctrlY = c2y;
      x = nx;
      y = ny;
      continue;
    } else if (kind === "Z") {
      total += Math.hypot(startX - x, startY - y);
      x = startX;
      y = startY;
    } else {
      index += 1;
    }
    ctrlX = x;
    ctrlY = y;
  }
  return total;
}

function primitiveLength(primitive: DoodlePrimitive): number {
  switch (primitive.type) {
    case "path":
      return pathLength(primitive.d);
    case "circle":
      return 2 * Math.PI * primitive.r;
    case "ellipse":
      // Ramanujan's approximation.
      return (
        Math.PI *
        (3 * (primitive.rx + primitive.ry) -
          Math.sqrt((3 * primitive.rx + primitive.ry) * (primitive.rx + 3 * primitive.ry)))
      );
    case "line":
      return Math.hypot(primitive.x2 - primitive.x1, primitive.y2 - primitive.y1);
    default:
      return 0;
  }
}

/**
 * Ink drawn per unit of rendered size. Doodles are scaled by
 * `size / sqrt(width * height)`, so dividing total stroke length by that same
 * root gives a number that is directly comparable across shapes: how much line
 * you get when you ask for a doodle "26 across".
 */
function inkDensity(primitives: DoodlePrimitive[], width: number, height: number): number {
  const total = primitives.reduce((sum, primitive) => sum + primitiveLength(primitive), 0);
  return total / Math.sqrt(width * height);
}

const MEDIAN_INK_DENSITY = (() => {
  const densities = FOOD_WALLPAPER_SHAPES.map((shape) =>
    inkDensity(shape.primitives, shape.width, shape.height)
  ).sort((a, b) => a - b);
  return densities[Math.floor(densities.length / 2)];
})();

/**
 * Nudges size so shapes carry comparable visual weight. Stroke width is constant,
 * so a doodle's ink is its drawn length, and what the eye picks out of a texture is
 * ink per unit area — a patch darker than its surroundings. At size `s` a shape
 * draws `density * s` of line over roughly `s²` of area, so its darkness goes as
 * `density / s`: the dense shapes need to be drawn *larger* to even out, spreading
 * the same amount of line over more room. Shrinking them (the intuitive reading of
 * "too heavy") pushes darkness the wrong way and measurably worsens uniformity.
 *
 * Strength 1 equalises darkness outright, which would let ink density rather than
 * the tier decide size, so this takes a fractional power and clamps the result.
 * Set OPTICAL_WEIGHT_STRENGTH to 0 to turn the whole thing off.
 */
function opticalWeightScale(primitives: DoodlePrimitive[], width: number, height: number): number {
  if (OPTICAL_WEIGHT_STRENGTH === 0) return 1;
  const density = inkDensity(primitives, width, height);
  if (density <= 0) return 1;
  const factor = (density / MEDIAN_INK_DENSITY) ** OPTICAL_WEIGHT_STRENGTH;
  return Math.min(1 + OPTICAL_WEIGHT_CLAMP, Math.max(1 - OPTICAL_WEIGHT_CLAMP, factor));
}

/** The strokes a doodle draws at a given size — decoration only above the threshold. */
function primitivesAt(shape: DoodleShape, size: number): DoodlePrimitive[] {
  if (size >= DETAIL_MIN_SIZE) return shape.primitives;
  const simplified = shape.primitives.filter((primitive) => !primitive.detail);
  return simplified.length > 0 ? simplified : shape.primitives;
}

/**
 * Smallest size a shape still reads at, from how much detail it carries. Counts
 * the simplified drawing, since that is what renders down there — which is how
 * tagging decoration re-admits the busy shapes (grapes, lemon slice, burger) to
 * the small tier instead of leaving it to the same handful of simple ones.
 */
function minLegibleSize(shape: DoodleShape): number {
  const count = shape.primitives.filter((primitive) => !primitive.detail).length || shape.primitives.length;
  return Math.min(MIN_SIZE_CEILING, MIN_SIZE_BASE + MIN_SIZE_PER_PRIMITIVE * (count - 1));
}

function rotationLimit(shape: DoodleShape): number {
  return ROTATION_LIMITS[shape.rotation ?? "moderate"];
}

/** Shortest signed delta between two coordinates on a wrapping tile. */
function wrapDelta(delta: number, tile: number): number {
  if (delta > tile / 2) return delta - tile;
  if (delta < -tile / 2) return delta + tile;
  return delta;
}

type Node = {
  shape: DoodleShape;
  x: number;
  y: number;
  size: number;
  rotation: number;
  /** Keeps filler marks from shoving the food doodles around. */
  mobile: boolean;
  radius: number;
};

/**
 * Pushes overlapping doodles apart on the torus. Sizes now span ~3.5x, so a
 * doodle no longer fits inside its own grid cell — without this the heroes
 * collide with whatever the neighbouring cells drew. Wrapping the deltas keeps
 * the tile seamless while it relaxes.
 */
function relax(nodes: Node[], tile: number): void {
  for (let iteration = 0; iteration < RELAX_ITERATIONS; iteration += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        if (!a.mobile && !b.mobile) continue;
        const dx = wrapDelta(b.x - a.x, tile);
        const dy = wrapDelta(b.y - a.y, tile);
        const distance = Math.hypot(dx, dy) || 0.001;
        const needed = a.radius + b.radius + RELAX_GAP;
        if (distance >= needed) continue;
        // Split the correction by mobility so a pinned node absorbs none of it.
        const push = (needed - distance) / 2;
        const ux = (dx / distance) * push;
        const uy = (dy / distance) * push;
        const aShare = a.mobile ? (b.mobile ? 1 : 2) : 0;
        const bShare = b.mobile ? (a.mobile ? 1 : 2) : 0;
        a.x -= ux * aShare;
        a.y -= uy * aShare;
        b.x += ux * bShare;
        b.y += uy * bShare;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Throws PACK_CANDIDATES darts at the tile and returns the one whose distance to
 * the nearest placed footprint is greatest, along with that clearance. On an
 * empty tile the clearance is unbounded, so the first doodle lands anywhere.
 *
 * When `avoidName` is given, candidates that also keep SAME_SHAPE_MIN_DISTANCE
 * from an existing copy of that shape are preferred; the roomiest spot overall is
 * the fallback when no candidate manages both.
 */
function bestCandidate(placed: Node[], tile: number, rand: () => number, avoidName?: string) {
  let best = { x: 0, y: 0, clearance: -Infinity };
  let bestSpaced = { x: 0, y: 0, clearance: -Infinity };
  for (let attempt = 0; attempt < PACK_CANDIDATES; attempt += 1) {
    const x = rand() * tile;
    const y = rand() * tile;
    let clearance = Number.POSITIVE_INFINITY;
    let twinDistance = Number.POSITIVE_INFINITY;
    for (const node of placed) {
      const distance = Math.hypot(wrapDelta(x - node.x, tile), wrapDelta(y - node.y, tile));
      clearance = Math.min(clearance, distance - node.radius);
      if (avoidName && node.shape.name === avoidName) twinDistance = Math.min(twinDistance, distance);
    }
    if (clearance > best.clearance) best = { x, y, clearance };
    if (twinDistance >= SAME_SHAPE_MIN_DISTANCE && clearance > bestSpaced.clearance) {
      bestSpaced = { x, y, clearance };
    }
  }
  return bestSpaced.clearance > -Infinity ? bestSpaced : best;
}

export function buildFoodWallpaperPlacements(): DoodlePlacement[] {
  const tile = FOOD_WALLPAPER_TILE_SIZE;
  const rand = mulberry32(LAYOUT_SEED);

  // Per-tier decks so every tier cycles the full eligible vocabulary before
  // repeating, rather than the big sizes always landing on the same few shapes.
  const decks = new Map<string, DoodleShape[]>();
  const eligible = (tier: SizeTier) =>
    FOOD_WALLPAPER_SHAPES.filter(
      (shape) => minLegibleSize(shape) <= tier.max && (!shape.accent || ACCENT_TIERS.has(tier.name))
    );
  const nextShape = (tier: SizeTier) => {
    let deck = decks.get(tier.name);
    if (!deck || deck.length === 0) {
      deck = shuffled(eligible(tier), rand);
      decks.set(tier.name, deck);
    }
    return deck.pop() as DoodleShape;
  };

  // Deal tiers from an exact quota rather than rolling per doodle: across only
  // ~50 draws, independent rolls swing the hero count by 3x from seed to seed,
  // which makes the weights above meaningless as a tuning knob.
  const totalWeight = SIZE_TIERS.reduce((sum, tier) => sum + tier.weight, 0);
  const tierBag: SizeTier[] = [];
  SIZE_TIERS.forEach((tier, index) => {
    const quota =
      index === SIZE_TIERS.length - 1
        ? FOOD_DOODLE_COUNT - tierBag.length
        : Math.round((tier.weight / totalWeight) * FOOD_DOODLE_COUNT);
    for (let i = 0; i < quota; i += 1) tierBag.push(tier);
  });

  const wanted = shuffled(tierBag, rand).map((tier) => {
    const shape = nextShape(tier);
    const sampled = tier.min + rand() * (tier.max - tier.min);
    // Weight correction first, legibility floor second — a shape is allowed to
    // come out lighter than its tier, but never smaller than it can be read at.
    const weighted = sampled * opticalWeightScale(primitivesAt(shape, sampled), shape.width, shape.height);
    const floor = minLegibleSize(shape);
    const limit = rotationLimit(shape);
    return { shape, size: Math.max(weighted, floor), rotation: -limit + rand() * limit * 2, floor };
  });
  // Largest first: a hero thrown into an empty tile always finds room, whereas a
  // hero thrown last has to squeeze between everything else.
  wanted.sort((a, b) => b.size - a.size);

  const nodes: Node[] = [];
  for (const item of wanted) {
    const spot = bestCandidate(nodes, tile, rand, item.shape.name);
    const room = spot.clearance - PACK_GAP;
    const size = Math.min(item.size, room / RELAX_RADIUS_FACTOR);
    // Shrinking a little beats leaving a hole; shrinking a lot means this doodle
    // does not belong here at all.
    if (size < Math.max(item.floor, item.size * (1 - PACK_MAX_SHRINK))) continue;
    nodes.push({
      shape: item.shape,
      size,
      rotation: item.rotation,
      x: spot.x,
      y: spot.y,
      mobile: true,
      radius: size * RELAX_RADIUS_FACTOR
    });
  }

  relax(nodes, tile);

  // Tiny marks go in once the food has settled, and the food is pinned for this
  // pass. Because best-candidate always returns the emptiest spot it found, each
  // mark lands in the largest hole left — which is what makes the gaps between
  // doodles read as texture instead of as dead space.
  for (const node of nodes) node.mobile = false;
  const markNodes: Node[] = [];
  for (let i = 0; i < FILLER_MARK_COUNT; i += 1) {
    const mark = FILLER_MARKS[Math.floor(rand() * FILLER_MARKS.length)];
    const size = (0.85 + rand() * 0.45) * Math.sqrt(mark.width * mark.height);
    const spot = bestCandidate([...nodes, ...markNodes], tile, rand);
    markNodes.push({
      shape: mark,
      size,
      rotation: -45 + rand() * 90,
      x: spot.x,
      y: spot.y,
      mobile: true,
      radius: Math.max(size, 6) * RELAX_RADIUS_FACTOR
    });
  }
  relax([...nodes, ...markNodes], tile);

  const placements: DoodlePlacement[] = [];
  // Anything crossing a tile edge gets wrapped copies on the opposite side so
  // the repeated tile is seamless.
  for (const node of [...nodes, ...markNodes]) {
    const { shape } = node;
    // Size by area rather than longest side so elongated shapes (pancakes,
    // sandwich) carry similar visual weight to square ones.
    const scale = node.size / Math.sqrt(shape.width * shape.height);
    const cx = ((node.x % tile) + tile) % tile;
    const cy = ((node.y % tile) + tile) % tile;
    const radius = (Math.hypot(shape.width, shape.height) / 2) * scale;
    const xOffsets = [0];
    if (cx - radius < 0) xOffsets.push(tile);
    if (cx + radius > tile) xOffsets.push(-tile);
    const yOffsets = [0];
    if (cy - radius < 0) yOffsets.push(tile);
    if (cy + radius > tile) yOffsets.push(-tile);

    const rendered = STROKE_WIDTH_BASE + STROKE_WIDTH_RAMP * Math.max(0, node.size - SIZE_TIERS[SIZE_TIERS.length - 1].min);
    const strokeWidth = round(rendered / scale);
    const primitives = primitivesAt(shape, node.size);
    for (const dx of xOffsets) {
      for (const dy of yOffsets) {
        placements.push({
          shape,
          primitives,
          strokeWidth,
          transform: `translate(${round(cx + dx)} ${round(cy + dy)}) rotate(${round(node.rotation)}) scale(${round(scale)}) translate(${round(-shape.width / 2)} ${round(-shape.height / 2)})`
        });
      }
    }
  }

  return placements;
}
