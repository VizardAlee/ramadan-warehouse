import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "functions/lib/**", "coverage/**"] },
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default config;
