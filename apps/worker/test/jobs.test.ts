import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

vi.mock("unpdf", () => ({ extractText: vi.fn() }));

import { sourceText } from "../src/jobs";
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

    await expect(sourceText(envWithFiles({ "jobs/1/input/source.docx": contents }), ["jobs/1/input/source.docx"]))
      .resolves.toBe("来自 Word 的正文");
  });

  it("keeps text files in mixed uploads", async () => {
    await expect(sourceText(envWithFiles({ "jobs/1/input/notes.txt": "普通文本" }), ["jobs/1/input/notes.txt"]))
      .resolves.toBe("普通文本");
  });
});
