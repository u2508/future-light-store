// Local image optimization only. Full-resolution approved upload files stay untouched.
import { execFileSync } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(import.meta.dirname, "../src/assets/collection-artwork");
const files = (await readdir(directory)).filter((name) => /^[a-z0-9-]+\.jpg$/.test(name));
for (const width of [240, 768]) {
  const output = resolve(directory, String(width));
  await mkdir(output, { recursive: true });
  let bytes = 0;
  for (const name of files) {
    const target = resolve(output, name);
    execFileSync(
      "sips",
      ["-Z", String(width), "-s", "formatOptions", "78", resolve(directory, name), "--out", target],
      { stdio: "ignore" },
    );
    bytes += (await stat(target)).size;
  }
  console.log(`${files.length} images at ${width}px: ${bytes} bytes`);
}
