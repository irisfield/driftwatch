import typescript from "@rollup/plugin-typescript";
import dts from "rollup-plugin-dts";

const tsconfig = "./tsconfig.build.json";

const subpaths = ["assert", "compare"];

const subpathBuilds = subpaths.flatMap((name) => [
  {
    input: `src/${name}.ts`,
    output: { file: `dist/${name}.mjs`, format: "esm", sourcemap: true },
    plugins: [typescript({ tsconfig, declaration: false })],
  },
  {
    input: `src/${name}.ts`,
    output: { file: `dist/${name}.d.ts`, format: "esm" },
    plugins: [dts()],
  },
]);

export default [
  {
    input: "src/index.ts",
    output: { file: "dist/index.mjs", format: "esm", sourcemap: true },
    plugins: [typescript({ tsconfig, declaration: false })],
  },
  {
    input: "src/index.ts",
    output: { file: "dist/index.d.ts", format: "esm" },
    plugins: [dts()],
  },
  ...subpathBuilds,
];
