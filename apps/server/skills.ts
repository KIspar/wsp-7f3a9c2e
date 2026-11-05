import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { skillSchema, type Skill } from "../../packages/contracts";

const allowedVariables = new Set([
  "user.requirements", "item.index", "item.variant", "batch.total", "target.label", "target.description",
]);

export function parseSkill(source: string) {
  const front = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!front) throw new Error("缺少 YAML frontmatter，文件必须以 --- 开始。");
  const document = parseDocument(front[1], { uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors.map((e) => e.message).join("\n"));
  const config = skillSchema.parse(document.toJS());
  if (config.executor === "workflow" && config.id !== "benchmark-agent") {
    throw new Error("当前执行器只支持已实现的一键对标流程。");
  }
  for (const [key, field] of Object.entries(config.fields)) {
    if (field.type === "select" && (!field.options?.length || !field.options.includes(String(field.default)))) {
      throw new Error(`fields.${key}：选项与默认值不一致。`);
    }
  }
  if (config.imageDesign === "detail" && config.batch.mode !== "screens") throw new Error("详情图必须按屏展开");
  if (config.batch.mode === "screens" && config.imageDesign !== "detail") throw new Error("按屏展开仅适用于详情图");
  if (config.imageDesign === "edit" && (config.batch.mode !== "per-target" || config.batch.targetRole !== "targets")) throw new Error("编辑技能必须按待编辑图展开");
  const body = source.slice(front[0].length);
  const sections: Record<string, string> = {};
  // A line-based section scan preserves complete multiline prompts, including the final section.
  let section: string | undefined;
  const collected: Record<string, string[]> = {};
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^## (.+)$/);
    if (heading) {
      section = heading[1].startsWith("prompt.") ? heading[1] : undefined;
      if (section) {
        if (collected[section]) throw new Error(`重复提示词分区：${section}`);
        collected[section] = [];
      }
    } else if (section) collected[section].push(line);
  }
  Object.assign(sections, Object.fromEntries(Object.entries(collected).map(([key, lines]) => [key, lines.join("\n").trim()])));
  const required = config.executor === "workflow"
    ? ["prompt.white-background", "prompt.replace"] : [config.promptSection];
  if (required.some((key) => !key || !sections[key])) throw new Error("缺少执行所需的提示词分区。");
  for (const text of Object.values(sections)) {
    for (const match of text.matchAll(/{{\s*([\w.]+)\s*}}/g)) {
      if (!allowedVariables.has(match[1]) && !(match[1].startsWith("fields.") && config.fields[match[1].slice(7)])) {
        throw new Error(`未声明的模板变量：${match[1]}`);
      }
    }
  }
  return { ...config, sections, hash: createHash("sha256").update(source).digest("hex") };
}

export function readSkillSources(root: string) {
  return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((entry) => {
    const file = path.join(root, entry.name, "技能提示词.md");
    if (!fs.existsSync(file)) return [];
    const source = fs.readFileSync(file, "utf8");
    return [{ ...parseSkill(source), source, revision: 1, unpublished: false } satisfies Skill];
  });
}

export function renderPrompt(template: string, variables: Record<string, unknown>) {
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_, key: string) => {
    if (!(key in variables)) throw new Error(`变量缺失：${key}`);
    return String(variables[key] ?? "");
  });
}
