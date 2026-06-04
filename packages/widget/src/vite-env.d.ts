/// <reference types="vite/client" />

// Importing a stylesheet with `?inline` yields its processed CSS as a string.
declare module "*.css?inline" {
  const css: string;
  export default css;
}
