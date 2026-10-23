/** Original editable photobook collection. Run: npx tsx scripts/build-theme-templates.ts.
 * Geometry and artwork are authored here; no external template or photo assets are used.
 */
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalJson } from "../packages/document/src/canonical";
import type {
  TemplateSlot,
  TemplateVersion,
} from "../packages/document/src/template";
const themes = [
  [
    "japanese",
    "日系 · 木漏れ日",
    "日常的光",
    "#f6f3e9",
    "#4d5c45",
    "#dce2cf",
    "KOMOREBI",
    "光落在平凡的日子里",
  ],
  [
    "jk",
    "JK · 放课后手记",
    "青春未完",
    "#edf2f7",
    "#253e61",
    "#d7e1ef",
    "AFTER SCHOOL",
    "把今天写进青春的扉页",
  ],
  [
    "qipao",
    "旗袍 · 海棠旧梦",
    "一袭芳华",
    "#f3e8da",
    "#733d42",
    "#dbc6b0",
    "ORIENTAL REVERIE",
    "一针一线，收藏流动的岁月",
  ],
  [
    "chinese",
    "国风 · 山水长卷",
    "山川有信",
    "#f0f0e5",
    "#3c5b50",
    "#d7dece",
    "SHAN SHUI",
    "于山水之间，遇见自己",
  ],
  [
    "wedding",
    "婚礼 · 誓言之书",
    "此刻与永远",
    "#fcf8f2",
    "#79614e",
    "#e9dfcf",
    "OUR VOWS",
    "从此每一个明天，都有你",
  ],
  [
    "couple",
    "情侣 · 双人诗集",
    "与你的每一页",
    "#f9efed",
    "#8a535a",
    "#ebd2d2",
    "YOU & ME",
    "两个人，把日常写成诗",
  ],
  [
    "family",
    "亲子 · 小小星球",
    "慢慢长大",
    "#fbf5e2",
    "#5d6944",
    "#e6e5b7",
    "LITTLE PLANET",
    "小小的你，大大的世界",
  ],
  [
    "travel",
    "旅行 · 远方邮局",
    "山海有期",
    "#f1eee2",
    "#386269",
    "#d6e2db",
    "LETTERS FROM AFAR",
    "带着好奇，走进下一站",
  ],
  [
    "korean",
    "韩系 · 素色时光",
    "自在如你",
    "#f3efec",
    "#685b55",
    "#e2d7cf",
    "SOFT DAYS",
    "留一点空白，给柔软的生活",
  ],
  [
    "hongkong",
    "港风 · 午夜放映",
    "光影留声",
    "#292f2c",
    "#efdbb5",
    "#5c3733",
    "MIDNIGHT CINEMA",
    "城市醒着，故事还在继续",
  ],
  [
    "french",
    "法式 · 午后花园",
    "浪漫日常",
    "#f4f0e7",
    "#6e5f53",
    "#ded7c7",
    "LE JARDIN",
    "把寻常的午后，过成纪念日",
  ],
  [
    "monochrome",
    "黑白 · 无声肖像",
    "关于此刻",
    "#f4f4f1",
    "#292b2c",
    "#deded9",
    "STILL / LIFE",
    "褪去色彩，留下真实的温度",
  ],
] as const;
const W = 1133.858268;
type Box = [number, number, number, number];
const rect = ([x, y, w, h]: Box) => ({
  x: +(x * W).toFixed(6),
  y: +(y * W).toFixed(6),
  width: +(w * W).toFixed(6),
  height: +(h * W).toFixed(6),
});
// Eight distinct editorial rhythms: title plate, diptych, landscape/portrait,
// triptych, contact essay, paired columns, mosaic, closing colophon.
const compositions: Box[][] = [
  [[1.12, 0.12, 0.76, 0.76]],
  [
    [0.12, 0.2, 0.74, 0.62],
    [1.2, 0.12, 0.64, 0.76],
  ],
  [
    [0.08, 0.15, 0.84, 0.49],
    [1.16, 0.26, 0.68, 0.57],
  ],
  [
    [0.12, 0.14, 0.72, 0.72],
    [1.12, 0.18, 0.35, 0.56],
    [1.53, 0.3, 0.35, 0.56],
  ],
  [
    [0.12, 0.18, 0.76, 0.3],
    [0.24, 0.54, 0.64, 0.31],
    [1.16, 0.12, 0.68, 0.74],
  ],
  [
    [0.1, 0.2, 0.37, 0.63],
    [0.53, 0.14, 0.37, 0.63],
    [1.1, 0.2, 0.37, 0.63],
    [1.53, 0.14, 0.37, 0.63],
  ],
  [
    [0.1, 0.15, 0.8, 0.32],
    [0.1, 0.53, 0.8, 0.32],
    [1.12, 0.15, 0.33, 0.7],
    [1.51, 0.15, 0.37, 0.7],
  ],
  [[0.16, 0.18, 0.68, 0.62]],
];
const roles = [
  "opening",
  "two-photo",
  "two-photo",
  "three-photo",
  "three-photo",
  "four-photo",
  "four-photo",
  "closing",
] as const;
const chapter = [
  "序 / BEGIN",
  "相遇 / ENCOUNTER",
  "片刻 / MOMENT",
  "日记 / JOURNAL",
  "回声 / ECHO",
  "同行 / TOGETHER",
  "珍藏 / KEEPSAKE",
  "终 / UNTIL NEXT TIME",
];
const templates = themes.flatMap(
  (
    [
      category,
      collectionName,
      title,
      background,
      ink,
      accent,
      english,
      caption,
    ],
    themeIndex,
  ) =>
    compositions.map((composition, index) => {
      const slots: TemplateSlot[] = [];
      const shape = (
        id: string,
        box: Box,
        fill: string,
        kind: NonNullable<TemplateSlot["shapeKind"]> = "rectangle",
        stroke = "transparent",
        strokeWidth = 0,
      ) =>
        slots.push({
          slotId: id,
          kind: "shape",
          shapeKind: kind,
          frame: rect(box),
          fill,
          stroke,
          strokeWidth,
          editableFields: ["fill", "stroke", "frame"],
        });
      const text = (
        id: string,
        box: Box,
        value: string,
        size: number,
        spacing = 0,
        align: "left" | "center" | "right" = "left",
        weight = 400,
      ) =>
        slots.push({
          slotId: id,
          kind: "text",
          frame: rect(box),
          defaultText: value,
          fontAssetId: [
            "jk",
            "family",
            "travel",
            "korean",
            "monochrome",
          ].includes(category)
            ? "noto-sans-sc"
            : "noto-serif-sc",
          fontWeight: weight,
          fontSize: size,
          fill: ink,
          letterSpacing: spacing,
          textAlign: align,
          editableFields: ["text", "fill", "fontSize", "frame"],
        });
      // Theme-specific graphic vocabularies remain fully editable native primitives.
      if (category === "japanese") {
        shape("paper_band", [0.03, 0.07, 0.055, 0.8], accent);
        shape("sun", [1.76, 0.04, 0.12, 0.12], accent, "ellipse");
        shape("quiet_rule", [1.12, 0.92, 0.5, 0.0015], ink);
      } else if (category === "jk") {
        for (let n = 0; n < 5; n++)
          shape(
            `notebook_${n}`,
            [0.04, 0.18 + n * 0.15, 0.025, 0.025],
            accent,
            "ellipse",
          );
        shape("school_ribbon", [1.08, 0.04, 0.7, 0.025], ink);
        shape("stamp", [1.82, 0.04, 0.1, 0.08], accent);
      } else if (category === "qipao") {
        shape(
          "silk_border",
          [0.035, 0.035, 1.93, 0.93],
          "transparent",
          "rectangle",
          ink,
          1.5,
        );
        for (let n = 0; n < 3; n++)
          shape(
            `pearl_${n}`,
            [0.91, 0.12 + n * 0.045, 0.014, 0.014],
            ink,
            "ellipse",
          );
        shape("silk_panel", [1.04, 0.04, 0.035, 0.92], accent);
      } else if (category === "chinese") {
        shape("mountain_far", [0.04, 0.8, 0.25, 0.13], accent, "ellipse");
        shape("mountain_near", [0.24, 0.85, 0.21, 0.1], accent, "ellipse");
        shape("vermillion_seal", [1.84, 0.9, 0.065, 0.065], "#a74436");
        shape("scroll_edge", [1.94, 0.06, 0.01, 0.88], ink);
      } else if (category === "wedding") {
        shape(
          "vow_border",
          [0.04, 0.05, 0.89, 0.89],
          "transparent",
          "rectangle",
          accent,
          2,
        );
        shape(
          "vow_border_right",
          [1.07, 0.05, 0.89, 0.89],
          "transparent",
          "rectangle",
          accent,
          2,
        );
        shape(
          "ring_left",
          [0.89, 0.055, 0.036, 0.036],
          "transparent",
          "ellipse",
          ink,
          1.4,
        );
        shape(
          "ring_right",
          [0.915, 0.055, 0.036, 0.036],
          "transparent",
          "ellipse",
          ink,
          1.4,
        );
      } else if (category === "couple") {
        shape("rose_disc", [0.035, 0.045, 0.18, 0.18], accent, "ellipse");
        shape("paired_disc", [1.78, 0.78, 0.18, 0.18], accent, "ellipse");
        shape("love_line", [1.1, 0.91, 0.34, 0.003], ink);
      } else if (category === "family") {
        shape("play_corner", [0.035, 0.035, 0.16, 0.11], accent);
        shape("little_sun", [1.8, 0.04, 0.12, 0.12], "#e7bd63", "ellipse");
        for (let n = 0; n < 4; n++)
          shape(
            `play_dot_${n}`,
            [1.7 + n * 0.055, 0.93, 0.02, 0.02],
            n % 2 ? accent : ink,
            "ellipse",
          );
      } else if (category === "travel") {
        shape(
          "postcard_edge",
          [0.035, 0.04, 1.93, 0.92],
          "transparent",
          "rectangle",
          accent,
          3,
        );
        shape(
          "postage",
          [1.81, 0.055, 0.12, 0.085],
          "transparent",
          "rectangle",
          ink,
          1.4,
        );
        for (let n = 0; n < 5; n++)
          shape(`route_${n}`, [0.11 + n * 0.13, 0.93, 0.07, 0.002], ink);
      } else if (category === "korean") {
        shape("soft_panel", [1.045, 0.04, 0.9, 0.9], accent);
        shape("soft_rule", [0.12, 0.9, 0.28, 0.002], ink);
      } else if (category === "hongkong") {
        shape("cinema_header", [0.03, 0.03, 1.94, 0.055], accent);
        shape("cinema_footer", [0.03, 0.925, 1.94, 0.045], accent);
        for (let n = 0; n < 12; n++)
          shape(`film_${n}`, [0.05 + n * 0.16, 0.94, 0.045, 0.015], background);
      } else if (category === "french") {
        shape(
          "garden_frame",
          [0.04, 0.04, 1.92, 0.92],
          "transparent",
          "rectangle",
          accent,
          2,
        );
        for (let n = 0; n < 3; n++)
          shape(
            `petal_${n}`,
            [1.82 + n * 0.024, 0.055 + n * 0.017, 0.04, 0.065],
            accent,
            "ellipse",
          );
      } else {
        shape("editorial_bar", [0.07, 0.04, 0.83, 0.014], ink);
        shape("editorial_bar_right", [1.1, 0.89, 0.82, 0.008], ink);
        shape("folio_square", [1.86, 0.925, 0.035, 0.035], ink);
      }
      // Each collection has its own geometry: modest insets, alternating page balance,
      // and a mirrored editorial reading direction for selected collections.
      const inset =
        (themeIndex % 4) * 0.009 + Math.floor(themeIndex / 4) * 0.003;
      const mirror = [2, 5, 8, 10].includes(themeIndex);
      const frames = composition.map(([x, y, w, h]): Box => {
        const b: Box = [x + inset, y + inset, w - inset * 2, h - inset * 2];
        if (mirror) b[0] = 2 - b[0] - b[2];
        return b;
      });
      // Paper mats provide deliberate negative space around every photograph.
      frames.forEach(([x, y, w, h], i) =>
        shape(
          `photo_mat_${i + 1}`,
          [x - 0.012, y - 0.012, w + 0.024, h + 0.024],
          background,
        ),
      );
      frames.forEach((box, i) =>
        slots.push({
          slotId: `photo_${i + 1}`,
          kind: "image",
          frame: rect(box),
          fitMode: "cover",
          bindingRequired: true,
        }),
      );
      const titlePage =
        index === 0
          ? mirror
            ? 1.12
            : 0.12
          : index === 7
            ? mirror
              ? 0.12
              : 1.12
            : 0.12;
      if (index === 0 || index === 7) {
        text("eyebrow", [titlePage, 0.22, 0.72, 0.055], english, 17, 3);
        text(
          "title",
          [titlePage, 0.34, 0.72, 0.14],
          index === 7 ? "未完 · 待续" : title,
          48,
          3,
        );
        text("caption", [titlePage, 0.54, 0.72, 0.07], caption, 18, 1);
        shape("title_rule", [titlePage, 0.665, 0.24, 0.002], ink);
        text(
          "dedication",
          [titlePage, 0.72, 0.7, 0.09],
          index === 0
            ? "把值得记住的故事\n留在这一册时光里"
            : "感谢每一次相遇\n愿美好在下一页继续",
          16,
          1,
        );
      } else {
        text("title", [0.12, 0.055, 0.78, 0.06], title, 26, 3);
        text("eyebrow", [1.1, 0.055, 0.77, 0.05], english, 14, 2, "right");
        text("caption", [0.12, 0.875, 0.76, 0.04], caption, 14, 1);
      }
      text(
        "chapter",
        [index === 0 || index === 7 ? titlePage : 1.1, 0.865, 0.72, 0.04],
        chapter[index],
        13,
        1,
        "right",
      );
      text(
        "folio",
        [0.12, 0.945, 0.7, 0.025],
        `${collectionName}   /   ${String(index + 1).padStart(2, "0")}`,
        10,
        1,
      );
      const payload: Omit<TemplateVersion, "sha256"> = {
        id: `theme_${category}_${index + 1}`,
        version: 1,
        category,
        themeId: category,
        collectionName,
        pageRole: roles[index],
        pageOrder: index + 1,
        name: `${collectionName} / ${String(index + 1).padStart(2, "0")} ${chapter[index]}`,
        unit: "px96",
        pageSize: { width: W, height: W },
        view: "spread",
        background,
        origin: "project-original-design",
        state: "registered",
        licenseRef: "LicenseRef-Project-Original-Templates",
        licenseText:
          "本项目原创版式与装饰，允许本产品用户编辑和导出。不包含第三方照片或模板；字体按 OFL 授权。",
        source: "scripts/build-theme-templates.ts",
        slots,
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
  "packages/document/templates/themes-v1.json",
  JSON.stringify(templates, null, 2) + "\n",
);
console.log(
  `Registered ${templates.length} original themed spreads in ${themes.length} collections.`,
);
