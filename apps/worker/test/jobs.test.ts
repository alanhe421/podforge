import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import mammoth from "mammoth";

vi.mock("unpdf", () => ({ extractText: vi.fn() }));
vi.mock("../src/minimax", () => ({ generateScript: vi.fn(), synthesizeLine: vi.fn() }));

import { generateScript, synthesizeLine } from "../src/minimax";
import { processJob, sourceText } from "../src/jobs";
import type { Env } from "../src/types";

function envWithFiles(files: Record<string, string | ArrayBuffer>): Env {
  return {
    FILES: {
      get: vi.fn(async (key: string) => {
        const value = files[key];
        if (value === undefined) return null;
        return {
          arrayBuffer: async () => typeof value === "string" ? new TextEncoder().encode(value).buffer : value,
          text: async () => typeof value === "string" ? value : new TextDecoder().decode(value)
        };
      })
    }
  } as unknown as Env;
}

describe("source text extraction", () => {
  it("extracts raw text from DOCX files", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      </Types>`);
    zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`);
    zip.folder("word")?.file("document.xml", `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p><w:r><w:t>来自 Word 的正文</w:t></w:r></w:p></w:body>
      </w:document>`);
    const contents = await zip.generateAsync({ type: "arraybuffer" });
    const extractRawText = vi.spyOn(mammoth, "extractRawText");

    await expect(sourceText(envWithFiles({ "jobs/1/input/source.docx": contents }), ["jobs/1/input/source.docx"]))
      .resolves.toBe("来自 Word 的正文");
    expect(extractRawText).toHaveBeenCalledWith(expect.objectContaining({ arrayBuffer: contents }));
  });

  it("keeps text files in mixed uploads", async () => {
    await expect(sourceText(envWithFiles({ "jobs/1/input/notes.txt": "普通文本" }), ["jobs/1/input/notes.txt"]))
      .resolves.toBe("普通文本");
  });
});

describe("job cancellation", () => {
  it("acknowledges an already canceled queued job without doing work", async () => {
    const env = {
      DB: { prepare: vi.fn(() => ({ bind: () => ({ first: async () => ({ status: "canceled" }) }) })) },
      FILES: { get: vi.fn(), put: vi.fn(), delete: vi.fn() }
    } as unknown as Env;

    await expect(processJob(env, "job-1")).resolves.toBeUndefined();
    expect(env.FILES.get).not.toHaveBeenCalled();
    expect(generateScript).not.toHaveBeenCalled();
  });

  it("stops before writing audio when canceled during an in-flight TTS request", async () => {
    let status = "queued";
    const job = {
      id: "job-2", title: "测试", language: "zh-CN", duration: 3, style: "轻松科普",
      status, progress: 5, stage: "等待处理", error: null, script: null, audio_key: null,
      input_keys: JSON.stringify(["jobs/job-2/input/source.txt"]), created_at: "", updated_at: ""
    };
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => sql.startsWith("SELECT *") ? { ...job, status } : { status }),
        run: vi.fn(async () => {
          if (sql.includes("SET status='processing'")) status = "processing";
          return { meta: { changes: 1 } };
        })
      }))
    }));
    const put = vi.fn();
    const env = {
      DB: { prepare },
      FILES: {
        get: vi.fn(async () => ({ text: async () => "一段测试资料" })),
        put,
        delete: vi.fn(async () => undefined)
      }
    } as unknown as Env;
    vi.mocked(generateScript).mockResolvedValue({ title: "测试", lines: [{ speaker: "host", text: "你好" }] });
    vi.mocked(synthesizeLine).mockImplementation(async () => {
      status = "canceled";
      return new Uint8Array([0, 0]);
    });

    await expect(processJob(env, "job-2")).resolves.toBeUndefined();
    expect(synthesizeLine).toHaveBeenCalledOnce();
    expect(put).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalledWith(expect.stringContaining("status='failed'"));
  });
});
