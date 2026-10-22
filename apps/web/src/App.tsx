import { bundledAssetUrl } from "./bundled-url";
import { LibraryPanel } from "./editor/LibraryPanel";
import { ExportPanel } from "./export/ExportPanel";
import { useEffect, useState } from "react";
import type { ResourceManifest } from "@album/assets";
import {
  IndexedDbRevisionStore,
  type SavedRevision,
  exportDraftProject,
  importProject,
} from "@album/storage";
import type { DocumentModel } from "@album/document";
import { Editor } from "./editor/Editor";
const store = new IndexedDbRevisionStore("album-local-v1");
let startup: Promise<SavedRevision> | undefined;
async function start(): Promise<SavedRevision> {
  const projects = await store.listProjects();
  if (projects.length) {
    const selected = localStorage.getItem("album-active");
    return store.load(
      projects.find((p) => p.projectId === selected)?.projectId ??
        projects[0].projectId,
    );
  }
  const response = await fetch(bundledAssetUrl("fonts/manifest.json"));
  if (!response.ok) throw new Error("本地字体目录不可用，请重新加载");
  const resources = (await response.json()) as ResourceManifest;
  for (const font of resources.fonts) {
    const files = new Map<string, Uint8Array>();
    for (const face of font.faces) {
      const response = await fetch(bundledAssetUrl(face.file));
      if (!response.ok) throw new Error(`缺少本地字体 ${face.file}`);
      files.set(face.id, new Uint8Array(await response.arrayBuffer()));
    }
    await store.putFont(font, files);
  }
  const doc: DocumentModel = {
    schemaVersion: 1,
    projectId: "prj_" + crypto.randomUUID().replaceAll("-", ""),
    revision: 1,
    unit: "px96",
    colorSpace: "srgb",
    pageSize: { width: 600, height: 600 },
    printProfile: { bleedMm: 3, safeMm: 5 },
    cover: { front: [], back: [] },
    spreads: [{ id: "spread_1", background: "#ffffff", layers: [] }],
  };
  return store.create(doc, resources);
}
export function download(
  bytes: Uint8Array,
  name: string,
  mime = "application/zip",
) {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: mime }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function App() {
  const [saved, setSaved] = useState<SavedRevision>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    startup ??= start().catch((e) => {
      startup = undefined;
      throw e;
    });
    void startup
      .then((v) => {
        if (active) setSaved(v);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  if (error)
    return (
      <main className="startup">
        <h1>无法打开本地项目</h1>
        <p role="alert">{error}</p>
        <button onClick={() => location.reload()}>重新加载</button>
        <p>浏览器存储可能不可用。请保留原浏览器数据并尝试恢复项目包。</p>
        <label className="button">
          恢复项目包
          <input
            type="file"
            accept=".zip"
            hidden
            onChange={async (e) => {
              try {
                const file = e.target.files?.[0];
                if (file) {
                  const value = await importProject(
                    new Uint8Array(await file.arrayBuffer()),
                    store,
                  );
                  setSaved(value);
                  setError("");
                }
              } catch (e) {
                setError(String(e));
              }
            }}
          />
        </label>
      </main>
    );
  if (!saved)
    return (
      <main className="startup">
        <span className="brand-mark">拾</span>
        <h1>准备你的创作空间</h1>
        <p>首次打开正在将已授权的中文字体保存至此浏览器…</p>
      </main>
    );
  return (
    <Editor
      key={saved.doc.projectId}
      initial={saved.doc}
      store={store}
      resources={saved.resources}
      port={store}
      renderLibrary={(ctx) => <LibraryPanel {...ctx} />}
      renderExport={({ save }) => <ExportPanel store={store} save={save} />}
      onCreateTemplateProject={async (pageSize, resources) => {
        const doc: DocumentModel = {
          schemaVersion: 1,
          projectId: "prj_" + crypto.randomUUID().replaceAll("-", ""),
          revision: 1,
          unit: "px96",
          colorSpace: "srgb",
          pageSize,
          printProfile: { bleedMm: 3, safeMm: 5 },
          cover: { front: [], back: [] },
          spreads: [{ id: "spread_1", background: "#ffffff", layers: [] }],
        };
        const value = await store.create(doc, resources);
        localStorage.setItem("album-active", doc.projectId);
        setSaved(value);
      }}
      onRecover={async (file) => {
        const next = await importProject(
          new Uint8Array(await file.arrayBuffer()),
          store,
        );
        localStorage.setItem("album-active", next.doc.projectId);
        setSaved(next);
      }}
      onProjectExport={async (doc, resources) =>
        download(
          await exportDraftProject(doc, resources, store),
          "拾光-可恢复项目.zip",
        )
      }
    />
  );
}
