/** Original fixed spread compositions; regenerate with npx tsx scripts/build-style-templates.ts. */
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalJson } from "../packages/document/src/canonical";
const styles = [
  [
    "japanese",
    "日系",
    "光与日常",
    "#f6f3ea",
    "#565d48",
    "noto-serif-sc",
    "DAYLIGHT / やさしい日々",
    0,
  ],
  [
    "jk",
    "JK 校园",
    "放课后",
    "#eef2f5",
    "#293c5b",
    "noto-sans-sc",
    "AFTER SCHOOL / 青春日记",
    1,
  ],
  [
    "qipao",
    "旗袍",
    "海棠旧梦",
    "#f2e8db",
    "#723e37",
    "noto-serif-sc",
    "THE ORIENT / 一袭芳华",
    2,
  ],
  [
    "chinese",
    "国风汉服",
    "山水之间",
    "#eeeee4",
    "#455c53",
    "noto-serif-sc",
    "山 川 · 草 木 · 人 间",
    3,
  ],
  [
    "wedding",
    "婚礼",
    "誓言之书",
    "#faf6f0",
    "#7c6457",
    "noto-serif-sc",
    "OUR VOWS / 此刻与永远",
    4,
  ],
  [
    "couple",
    "情侣",
    "两个人的诗",
    "#f8efed",
    "#8b5a57",
    "noto-serif-sc",
    "TOGETHER / 与你同行",
    5,
  ],
  [
    "family",
    "亲子",
    "小小的你",
    "#f8f2df",
    "#687047",
    "noto-sans-sc",
    "LITTLE MOMENTS / 慢慢长大",
    6,
  ],
  [
    "travel",
    "旅行",
    "远方来信",
    "#f1efe7",
    "#50635c",
    "noto-sans-sc",
    "POSTCARDS / 山海有期",
    7,
  ],
  [
    "korean",
    "韩系",
    "素色时光",
    "#f1eeeb",
    "#645c58",
    "noto-sans-sc",
    "SOFT DAYS / 自在如你",
    8,
  ],
  [
    "hongkong",
    "复古港风",
    "花样年华",
    "#302c2b",
    "#eedbc0",
    "noto-serif-sc",
    "IN THE MOOD / 光影留声",
    9,
  ],
  [
    "french",
    "法式",
    "午后花园",
    "#f2efe6",
    "#766657",
    "noto-serif-sc",
    "JARDIN / 浪漫日常",
    10,
  ],
  [
    "monochrome",
    "黑白写真",
    "无声肖像",
    "#f3f3f0",
    "#303132",
    "noto-sans-sc",
    "PORTRAITS / 关于此刻",
    11,
  ],
] as const;
// Normalized [x,y,w,h]; a clear centre gutter keeps portraits away from the fold.
const frames: Record<number, number[][][]> = {
  2: [
    [
      [0.07, 0.14, 0.84, 0.7],
      [1.12, 0.22, 0.73, 0.63],
    ],
    [
      [0.14, 0.17, 0.69, 0.73],
      [1.08, 0.14, 0.84, 0.67],
    ],
    [
      [0.08, 0.25, 0.82, 0.56],
      [1.19, 0.12, 0.65, 0.77],
    ],
  ],
  3: [
    [
      [0.08, 0.14, 0.82, 0.73],
      [1.1, 0.16, 0.38, 0.54],
      [1.52, 0.3, 0.38, 0.54],
    ],
    [
      [0.08, 0.17, 0.39, 0.62],
      [0.51, 0.27, 0.39, 0.62],
      [1.13, 0.14, 0.75, 0.72],
    ],
    [
      [0.12, 0.14, 0.72, 0.73],
      [1.12, 0.14, 0.76, 0.34],
      [1.12, 0.52, 0.76, 0.35],
    ],
  ],
  4: [
    [
      [0.08, 0.15, 0.4, 0.68],
      [0.52, 0.15, 0.4, 0.68],
      [1.08, 0.15, 0.84, 0.32],
      [1.08, 0.51, 0.84, 0.32],
    ],
    [
      [0.08, 0.14, 0.84, 0.34],
      [0.08, 0.52, 0.84, 0.34],
      [1.08, 0.14, 0.4, 0.72],
      [1.52, 0.14, 0.4, 0.72],
    ],
    [
      [0.1, 0.14, 0.37, 0.66],
      [0.51, 0.23, 0.37, 0.66],
      [1.12, 0.14, 0.37, 0.66],
      [1.53, 0.23, 0.37, 0.66],
    ],
  ],
};
const W = 1133.858268,
  H = W,
  rect = ([x, y, w, h]: number[]) => ({
    x: +(x * W).toFixed(6),
    y: +(y * H).toFixed(6),
    width: +(w * W).toFixed(6),
    height: +(h * H).toFixed(6),
  });
const templates = styles.flatMap(
  ([category, label, title, background, fill, fontAssetId, subtitle, index]) =>
    [2, 3, 4].map((count) => {
      const payload = {
        id: `style_${category}_${count}`,
        version: 1,
        category,
        name: `${label} · ${title} / ${count}图`,
        unit: "px96",
        pageSize: { width: W, height: H },
        view: "spread",
        background,
        origin: "project-original-design",
        state: "registered",
        licenseRef: "LicenseRef-Project-Original-Templates",
        licenseText:
          "本项目原创固定版式，允许本产品用户用于相册编辑和导出。不包含第三方照片；字体按 OFL 授权。",
        source: "scripts/build-style-templates.ts",
        slots: [
          ...frames[count][(index + count) % 3].map((frame, i) => ({
            slotId: `photo_${i + 1}`,
            kind: "image",
            frame: rect(frame),
            fitMode: "cover",
            bindingRequired: true,
          })),
          {
            slotId: "title",
            kind: "text",
            frame: rect([0.1, 0.925, 0.83, 0.045]),
            defaultText: title,
            fontAssetId,
            fontWeight: 400,
            fontSize: 28,
            letterSpacing: 5,
            fill,
            editableFields: ["text"],
          },
          {
            slotId: "caption",
            kind: "text",
            frame: rect([1.1, 0.935, 0.8, 0.03]),
            defaultText: subtitle,
            fontAssetId: "noto-sans-sc",
            fontWeight: 400,
            fontSize: 15,
            letterSpacing: 2,
            fill,
            textAlign: "right",
            editableFields: ["text"],
          },
        ],
      };
      return {
        ...payload,
        sha256: createHash("sha256")
          .update(canonicalJson(payload))
          .digest("hex"),
      };
    }),
);
writeFileSync(
  "packages/document/templates/styles-v1.json",
  JSON.stringify(templates, null, 2) + "\n",
);
console.log(`Registered ${templates.length} original style templates.`);
