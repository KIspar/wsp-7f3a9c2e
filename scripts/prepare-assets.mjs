import fs from "node:fs/promises";
import sharp from "sharp";
import { execFileSync } from "node:child_process";

await fs.mkdir("public/examples", { recursive: true });
const crops = [
  ["10-1", "_10", 240, 278, 189, 299, "正面穿搭"],
  ["10-2", "_10", 439, 327, 189, 239, "侧身穿搭"],
  ["10-3", "_10", 638, 278, 189, 299, "面料细节"],
  ["10-4", "_10", 837, 278, 189, 299, "室内穿搭"],
  ["6-1", "_6", 263, 300, 104, 140, "商品正面"],
  ["6-2", "_6", 376, 300, 104, 140, "商品上身"],
  ["6-3", "_6", 489, 300, 105, 140, "商品面料"],
  ["6-4", "_6", 640, 277, 72, 99, "户外对标"],
  ["6-5", "_6", 721, 277, 72, 99, "街头对标"],
  ["9-1", "_10", 439, 1145, 189, 247, "视频演示封面"],
];
const sources = [];
for (const [name, folder, left, top, width, height, description] of crops) {
  const source = `stitch_ui_prototype_generation/${folder}/screen.png`;
  await sharp(source).extract({ left, top, width, height }).jpeg({ quality: 94 }).toFile(`public/examples/${name}.jpg`);
  sources.push({ file: `${name}.jpg`, source, description, usage: "原型截图中的演示素材，非模型生成结果" });
}
await fs.writeFile("public/examples/sources.json", JSON.stringify(sources, null, 2));
console.log(`Prepared ${sources.length} local prototype examples.`);
if (process.env.FFMPEG) {
  for (const ratio of ["portrait", "landscape"]) {
    for (const duration of [4, 6, 8, 10]) {
      const size = ratio === "portrait" ? "360:640" : "640:360";
      execFileSync(process.env.FFMPEG, [
        "-y", "-loglevel", "error", "-loop", "1", "-i", "public/examples/9-1.jpg",
        "-vf", `scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2:color=0xeeeeee,setsar=1`,
        "-t", String(duration), "-r", "15", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        `public/examples/demo-${ratio}-${duration}.mp4`,
      ]);
    }
  }
  console.log("Prepared eight silent, static video fixtures (not AI-generated video).");
}
