import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("사용법: npm run version:set -- 0.2.0");
  process.exit(1);
}

const updateJson = (path, update) => {
  const json = JSON.parse(readFileSync(path, "utf8"));
  update(json);
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
};

updateJson("package.json", (json) => { json.version = version; });
updateJson("package-lock.json", (json) => {
  json.version = version;
  if (json.packages?.[""]) json.packages[""].version = version;
});
updateJson("src-tauri/tauri.conf.json", (json) => { json.version = version; });

const cargoPath = "src-tauri/Cargo.toml";
const cargo = readFileSync(cargoPath, "utf8");
const cargoVersionPattern = /(\[package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/;
if (!cargoVersionPattern.test(cargo)) {
  console.error("Cargo.toml의 package version을 찾지 못했습니다.");
  process.exit(1);
}
const updatedCargo = cargo.replace(cargoVersionPattern, `$1"${version}"`);
writeFileSync(cargoPath, updatedCargo);

console.log(`앱 버전을 ${version}(으)로 맞췄습니다.`);
