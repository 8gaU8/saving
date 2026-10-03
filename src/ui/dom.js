export const $ = (sel, root = document) => root.querySelector(sel);
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
