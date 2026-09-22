import { execFileSync } from "node:child_process";

const requiredFiles = [
    "dist/index.js",
    "dist/mcp/index.js",
    "dist/auth/cli.js",
    "LICENSE",
    "README.md",
    "README.zh-CN.md",
];
const forbiddenPaths = [
    "tsconfig.json",
    "src/",
    "test/",
    ".github/",
];

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const output = execFileSync(npmCommand, ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
});
const [pack] = JSON.parse(output);
const packedFiles = new Set(pack.files.map(({ path }) => path));
const missing = requiredFiles.filter((path) => !packedFiles.has(path));
const unexpected = [...packedFiles].filter((path) =>
    forbiddenPaths.some((forbidden) => path === forbidden || path.startsWith(forbidden)),
);

if (missing.length > 0 || unexpected.length > 0) {
    if (missing.length > 0) console.error(`Missing required package files: ${missing.join(", ")}`);
    if (unexpected.length > 0) console.error(`Unexpected package files: ${unexpected.join(", ")}`);
    process.exit(1);
}

console.log(`Package smoke check passed (${packedFiles.size} files).`);
